"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styles from "../break-summary/break-summary.module.css";
import { EmployeeTableNameCell } from "../components/EmployeeTableNameCell";
import {
  EmployeeDetailPopup,
  type EmployeeDetailPayload,
} from "../components/EmployeeDetailPopup";
import { buildEmployeeDetailPayload } from "@/lib/employee-detail-from-row";
import { useEmployeePhotoMap } from "../components/use-employee-photo-map";
import { FaFileExcel } from "react-icons/fa";
import { getDateStringInTimeZone, getTimeStringInTimeZone, SERVER_TIMEZONE } from "../../lib/timezone";
import { toastError, toastSuccess } from "@/lib/app-toast";

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

function getSessionGroupingKey(record: any) {
  const employeeKey = (record.employee_id ?? record.employeeId ?? "").toString();
  const attendanceSessionId = record.attendance_session_id ?? record.attendanceSessionId;
  if (attendanceSessionId !== undefined && attendanceSessionId !== null && attendanceSessionId !== "") {
    return `${employeeKey}|attendance:${attendanceSessionId}`;
  }
  // Important: do NOT fallback to shift_assignment_id for totals.
  // A reused shift assignment can merge separate shifts (night-shift cross-date cases).
  return `${employeeKey}|fallback:${record.id ?? record.prayer_break_start ?? "unknown"}`;
}

export default function PrayerSummaryView() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [department, setDepartment] = useState("");
  /** Default: current day only — expand range when user picks dates */
  const today = getLocalDateString();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [prayerBreaks, setPrayerBreaks] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const importInputRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<EmployeeDetailPayload | null>(null);
  const { getPhoto } = useEmployeePhotoMap();

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setDepartments(data.departments || []);
      })
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    const effectiveFrom = fromDate || toDate || today;
    const effectiveTo = toDate || fromDate || today;
    const params = new URLSearchParams({ fromDate: effectiveFrom, toDate: effectiveTo });
    setLoading(true);
    fetch(`/api/prayer_breaks?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setPrayerBreaks(data.prayer_breaks || []);
        else setPrayerBreaks([]);
      })
      .catch(() => setPrayerBreaks([]))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, today]);

  useEffect(() => {
    const hasRunning = prayerBreaks.some((p) => p.prayer_break_start && !p.prayer_break_end);
    if (!hasRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [prayerBreaks]);

  const filteredPrayerBreaks = useMemo(() => {
    return prayerBreaks.filter((p) => {
      const term = deferredSearch.trim().toLowerCase();
      if (term) {
        const employeeName = (p.employee_name || "").toLowerCase();
        const pseudonym = (p.pseudonym || "").toLowerCase();
        const id = String(p.employee_id || "");
        if (!employeeName.includes(term) && !pseudonym.includes(term) && !id.includes(term)) {
          return false;
        }
      }
      if (department && p.department_name !== department) return false;
      return true;
    });
  }, [prayerBreaks, deferredSearch, department]);

  const staticTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filteredPrayerBreaks) {
      if (!p.prayer_break_start || !p.prayer_break_end) continue;
      const start = new Date(p.prayer_break_start).getTime();
      const end = new Date(p.prayer_break_end).getTime();
      const seconds = Math.floor((end - start) / 1000);
      const key = getSessionGroupingKey(p);
      map.set(key, (map.get(key) || 0) + Math.max(0, seconds));
    }
    return map;
  }, [filteredPrayerBreaks]);

  const rows = useMemo(() => {
    const liveTotals = new Map(staticTotals);
    for (const p of filteredPrayerBreaks) {
      if (!p.prayer_break_start || p.prayer_break_end) continue;
      const start = new Date(p.prayer_break_start).getTime();
      const seconds = Math.floor((now - start) / 1000);
      const key = getSessionGroupingKey(p);
      liveTotals.set(key, (liveTotals.get(key) || 0) + Math.max(0, seconds));
    }

    return filteredPrayerBreaks
      .map((p) => {
        const isRunning = p.prayer_break_start && !p.prayer_break_end;
        const start = p.prayer_break_start ? new Date(p.prayer_break_start).getTime() : 0;
        const end = p.prayer_break_end ? new Date(p.prayer_break_end).getTime() : now;
        const sessionSeconds = p.prayer_break_start ? Math.floor((end - start) / 1000) : 0;
        const key = getSessionGroupingKey(p);
        const dailySeconds = liveTotals.get(key) || sessionSeconds;
        const exceedToday = dailySeconds > 1800 ? dailySeconds - 1800 : 0;
        return {
          ...p,
          date_display: p.session_clock_in
            ? getDateStringInTimeZone(p.session_clock_in, SERVER_TIMEZONE)
            : p.date
            ? getDateStringInTimeZone(p.date, SERVER_TIMEZONE)
            : (p.prayer_break_start ? getDateStringInTimeZone(p.prayer_break_start, SERVER_TIMEZONE) : ""),
          prayer_start_display: p.prayer_break_start ? getTimeStringInTimeZone(p.prayer_break_start, SERVER_TIMEZONE) : "",
          prayer_end_display: p.prayer_break_end ? getTimeStringInTimeZone(p.prayer_break_end, SERVER_TIMEZONE) : (isRunning ? "Running..." : ""),
          total_prayer_time: formatDuration(sessionSeconds),
          total_prayer_time_today: formatDuration(dailySeconds),
          exceed_today: exceedToday > 0 ? formatDuration(exceedToday) : "",
        };
      })
      .sort((a, b) => new Date(b.prayer_break_start || 0).getTime() - new Date(a.prayer_break_start || 0).getTime());
  }, [filteredPrayerBreaks, staticTotals, now]);

  const downloadPrayerCSV = () => {
    const headers = [
      "Id",
      "Full Name",
      "P.Name",
      "Department",
      "Date",
      "Prayer Start",
      "Prayer End",
      "Total Prayer Time",
      "Total Prayer",
      "Exceed",
    ];
    let csv = headers.join(",") + "\n";
    rows.forEach((row) => {
      csv += [
        row.employee_id,
        row.employee_name || "",
        row.pseudonym || "-",
        row.department_name || "-",
        row.date_display,
        row.prayer_start_display,
        row.prayer_end_display,
        row.total_prayer_time,
        row.total_prayer_time_today,
        row.exceed_today,
      ]
        .map((v) => `"${v}"`)
        .join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prayer_break_summary.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleImportClick = () => importInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append("target", "prayer_breaks");
      form.append("file", file);
      const res = await fetch("/api/import-hrm-excel", { method: "POST", body: form });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Import failed");
      } else {
        toastSuccess(`Imported ${data.imported} prayer break rows`);
        const effectiveFrom = fromDate || toDate || today;
        const effectiveTo = toDate || fromDate || today;
        const params = new URLSearchParams({ fromDate: effectiveFrom, toDate: effectiveTo });
        const r = await fetch(`/api/prayer_breaks?${params.toString()}`, { cache: "no-store" });
        const refreshed = await r.json();
        setPrayerBreaks(refreshed.success ? refreshed.prayer_breaks || [] : []);
      }
    } catch (err) {
      toastError(String(err));
    } finally {
      e.target.value = "";
    }
  };

  const openEmployeeDetail = (row: any) => {
    void buildEmployeeDetailPayload(row, getPhoto).then(setDetail);
  };

  return (
    <>
      <div className={styles.breakSummaryContainer}>
        <h1 className={styles.pageTitle}>Prayer Break Summary</h1>
        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name or pseudo name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 180 }}
          />
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className={styles.breakSummaryDate} style={{ width: 180 }}>
            <option value="">All Departments</option>
            {departments.map((dept: any) => (
              <option key={dept.id} value={dept.name}>{dept.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={styles.breakSummaryDate}
            placeholder="From Date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={styles.breakSummaryDate}
            placeholder="To Date"
          />
          <button onClick={downloadPrayerCSV} className={styles.breakSummaryXLSButton} title="Download XLS">
            <FaFileExcel size={20} />
            <span>Export XLS</span>
          </button>
          <button onClick={handleImportClick} className={styles.breakSummaryXLSButton} title="Import XLS">
            <FaFileExcel size={20} />
            <span>Import XLS</span>
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
        </div>

        <div className={styles.breakSummaryTableWrapper}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", fontSize: "16px", color: "#718096" }}>
              Loading...
            </div>
          ) : (
          <table className={styles.breakSummaryTable}>
            <thead>
              <tr>
                <th>Id</th>
                <th>Full Name</th>
                <th>P.Name</th>
                <th>Department</th>
                <th>Date</th>
                <th>Prayer Start</th>
                <th>Prayer End</th>
                <th>Total Prayer Time</th>
                <th>Total Prayer</th>
                <th>Exceed</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className={styles.breakSummaryNoRecords}>No records found.</td>
                </tr>
              ) : (
                rows.map((p, idx) => (
                  <tr key={p.id || idx}>
                    <td className={styles.cellMuted}>{p.employee_id}</td>
                    <td className={styles.nameCol}>
                      <EmployeeTableNameCell
                        key={`${p.employee_id}-${getPhoto(p.employee_id) ?? "none"}`}
                        name={p.employee_name || ""}
                        employeeId={p.employee_id}
                        photo={getPhoto(p.employee_id)}
                        onOpen={() => openEmployeeDetail(p)}
                      />
                    </td>
                    <td>{p.pseudonym || "-"}</td>
                    <td>{p.department_name || "-"}</td>
                    <td>{p.date_display}</td>
                    <td>{p.prayer_start_display}</td>
                    <td>
                      {p.prayer_break_start && !p.prayer_break_end ? (
                        <span className={styles.badgeRunning}>Running</span>
                      ) : (
                        p.prayer_end_display
                      )}
                    </td>
                    <td>{p.total_prayer_time}</td>
                    <td>{p.total_prayer_time_today}</td>
                    <td className={p.exceed_today ? styles.cellExceed : undefined}>{p.exceed_today}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          )}
        </div>
      </div>
      {detail ? <EmployeeDetailPopup data={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}
