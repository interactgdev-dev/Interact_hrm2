"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styles from "../break-summary/break-summary.module.css";
import { FaFileExcel } from "react-icons/fa";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../lib/timezone";
import { EmployeeTableNameCell } from "../components/EmployeeTableNameCell";
import { EmployeeDetailPopup } from "../components/EmployeeDetailPopup";
import type { EmployeeDetailPayload } from "../components/EmployeeDetailPopup";
import { buildEmployeeDetailPayload } from "@/lib/employee-detail-from-row";
import { useEmployeePhotoMap } from "../components/use-employee-photo-map";
import { toastError, toastSuccess } from "@/lib/app-toast";

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function getEmployeeGroupingKey(record: any) {
  return (
    (record.employee_id ?? record.employeeId ?? "").toString() ||
    record.employee_name ||
    record.name ||
    record.username ||
    ""
  );
}

function getSessionGroupingKey(record: any) {
  const employeeKey = getEmployeeGroupingKey(record);
  const attendanceSessionId = record.attendance_session_id ?? record.attendanceSessionId;

  if (
    attendanceSessionId !== undefined &&
    attendanceSessionId !== null &&
    attendanceSessionId !== ""
  ) {
    return `${employeeKey}|attendance:${attendanceSessionId}`;
  }

  // Important: do NOT fallback to shift_assignment_id for totals.
  // A reused shift assignment can merge separate shifts (night-shift cross-date cases).
  return `${employeeKey}|fallback:${record.id ?? record.break_start ?? "unknown"}`;
}

export default function BreakSummaryView() {
  const [breaks, setBreaks] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [department, setDepartment] = useState("");
  /** Default: current day only — expand range when user picks dates */
  const today = getLocalDateString();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [detail, setDetail] = useState<EmployeeDetailPayload | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
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
    fetch(`/api/breaks?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setBreaks(data.breaks || []);
        else setBreaks([]);
      })
      .catch(() => setBreaks([]))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, today]);

  useEffect(() => {
    const hasRunning = breaks.some((b) => b.break_start && !b.break_end);
    if (!hasRunning) return;
    // 5s is enough for live duration; 1s was rebuilding the whole table every tick
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [breaks]);

  const filteredBreaks = useMemo(() => {
    return breaks.filter((b) => {
      const term = deferredSearch.trim().toLowerCase();
      if (term) {
        const employeeName = (b.employee_name || "").toLowerCase();
        const pseudonym = (b.pseudonym || "").toLowerCase();
        const id = String(b.employee_id || "");
        if (!employeeName.includes(term) && !pseudonym.includes(term) && !id.includes(term)) {
          return false;
        }
      }
      if (department && b.department_name !== department) return false;
      return true;
    });
  }, [breaks, deferredSearch, department]);

  /** Static totals for ended breaks (no live clock). Running rows get live end = now below. */
  const staticTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of filteredBreaks) {
      if (!b.break_start || !b.break_end) continue;
      const start = new Date(b.break_start).getTime();
      const end = new Date(b.break_end).getTime();
      const seconds = Math.floor((end - start) / 1000);
      const key = getSessionGroupingKey(b);
      map.set(key, (map.get(key) || 0) + Math.max(0, seconds));
    }
    return map;
  }, [filteredBreaks]);

  const rows = useMemo(() => {
    const liveTotals = new Map(staticTotals);
    for (const b of filteredBreaks) {
      if (!b.break_start || b.break_end) continue;
      const start = new Date(b.break_start).getTime();
      const seconds = Math.floor((now - start) / 1000);
      const key = getSessionGroupingKey(b);
      liveTotals.set(key, (liveTotals.get(key) || 0) + Math.max(0, seconds));
    }

    return filteredBreaks
      .map((b) => {
        const isRunning = b.break_start && !b.break_end;
        const start = b.break_start ? new Date(b.break_start).getTime() : 0;
        const end = b.break_end ? new Date(b.break_end).getTime() : now;
        const sessionSeconds = b.break_start ? Math.floor((end - start) / 1000) : 0;
        const key = getSessionGroupingKey(b);
        const dailySeconds = liveTotals.get(key) || sessionSeconds;
        const exceedToday = dailySeconds > 3600 ? dailySeconds - 3600 : 0;
        return {
          ...b,
          date_display: b.session_clock_in
            ? getDateStringInTimeZone(b.session_clock_in, SERVER_TIMEZONE)
            : b.date
            ? getDateStringInTimeZone(b.date, SERVER_TIMEZONE)
            : b.break_start
            ? getDateStringInTimeZone(b.break_start, SERVER_TIMEZONE)
            : "",
          break_start_display: b.break_start ? getTimeStringInTimeZone(b.break_start, SERVER_TIMEZONE) : "",
          break_end_display: b.break_end
            ? getTimeStringInTimeZone(b.break_end, SERVER_TIMEZONE)
            : isRunning
            ? "Running..."
            : "",
          total_break_time: formatDuration(sessionSeconds),
          total_break_time_today: formatDuration(dailySeconds),
          exceed_today: exceedToday > 0 ? formatDuration(exceedToday) : "",
        };
      })
      .sort((a, b) => new Date(b.break_start || 0).getTime() - new Date(a.break_start || 0).getTime());
  }, [filteredBreaks, staticTotals, now]);

  const downloadBreakCSV = () => {
    const headers = [
      "Id",
      "Full Name",
      "P.Name",
      "Department",
      "Date",
      "Break Start",
      "Break End",
      "Total Break Time",
      "Total Break",
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
        row.break_start_display,
        row.break_end_display,
        row.total_break_time,
        row.total_break_time_today,
        row.exceed_today,
      ]
        .map((v) => `"${v}"`)
        .join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "break_summary.csv";
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
      form.append("target", "breaks");
      form.append("file", file);
      const res = await fetch("/api/import-hrm-excel", { method: "POST", body: form });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Import failed");
      } else {
        toastSuccess(`Imported ${data.imported} break rows`);
        const effectiveFrom = fromDate || toDate || today;
        const effectiveTo = toDate || fromDate || today;
        const params = new URLSearchParams({ fromDate: effectiveFrom, toDate: effectiveTo });
        const r = await fetch(`/api/breaks?${params.toString()}`, { cache: "no-store" });
        const refreshed = await r.json();
        setBreaks(refreshed.success ? refreshed.breaks || [] : []);
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
        <h1 className={styles.pageTitle}>Break Summary</h1>
        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name or pseudo name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 180 }}
          />
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={styles.breakSummaryDate}
            style={{ width: 180 }}
          >
            <option value="">All Departments</option>
            {departments.map((dept: any) => (
              <option key={dept.id} value={dept.name}>
                {dept.name}
              </option>
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
          <button onClick={downloadBreakCSV} className={styles.breakSummaryXLSButton} title="Download XLS">
            <FaFileExcel size={20} />
            <span>Export XLS</span>
          </button>
          <button onClick={handleImportClick} className={`${styles.breakSummaryXLSButton} ${styles.breakSummaryXLSButtonSecondary}`} title="Import XLS">
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
                <th>Break Start</th>
                <th>Break End</th>
                <th>Total Break Time</th>
                <th>Total Break</th>
                <th>Exceed</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className={styles.breakSummaryNoRecords}>
                    No records found.
                  </td>
                </tr>
              ) : (
                rows.map((b, idx) => (
                  <tr key={b.id || idx}>
                    <td className={styles.cellMuted}>{b.employee_id}</td>
                    <td className={styles.nameCol}>
                      <EmployeeTableNameCell
                        name={b.employee_name || ""}
                        employeeId={b.employee_id}
                        photo={getPhoto(b.employee_id)}
                        onOpen={() => openEmployeeDetail(b)}
                      />
                    </td>
                    <td>{b.pseudonym || "—"}</td>
                    <td>{b.department_name || "—"}</td>
                    <td>{b.date_display}</td>
                    <td>{b.break_start_display}</td>
                    <td>
                      {b.break_start && !b.break_end ? (
                        <span className={styles.badgeRunning}>Running</span>
                      ) : (
                        b.break_end_display
                      )}
                    </td>
                    <td>{b.total_break_time}</td>
                    <td>{b.total_break_time_today}</td>
                    <td className={b.exceed_today ? styles.cellExceed : undefined}>
                      {b.exceed_today || "—"}
                    </td>
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
