"use client";

import React, { useEffect, useMemo, useState } from "react";
import LayoutDashboard from "../layout-dashboard";
import styles from "../break-summary/break-summary.module.css";
import { FaFileExcel } from "react-icons/fa";
import { getDateStringInTimeZone, getTimeStringInTimeZone, SERVER_TIMEZONE } from "../../lib/timezone";

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function getMonthStartDateString(date: Date = new Date()) {
  const d = getDateStringInTimeZone(date, SERVER_TIMEZONE);
  return `${d.slice(0, 7)}-01`;
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

export default function PrayerBreakSummaryPage() {
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [fromDate, setFromDate] = useState(getMonthStartDateString());
  const [toDate, setToDate] = useState(getLocalDateString());
  const [prayerBreaks, setPrayerBreaks] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setDepartments(data.departments || []);
      })
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (fromDate) params.append("fromDate", fromDate);
    if (toDate) params.append("toDate", toDate);
    const url = `/api/prayer_breaks${params.toString() ? `?${params.toString()}` : ""}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setPrayerBreaks(data.prayer_breaks || []);
        else setPrayerBreaks([]);
      });
  }, [fromDate, toDate]);

  useEffect(() => {
    const hasRunning = prayerBreaks.some((p) => p.prayer_break_start && !p.prayer_break_end);
    if (!hasRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [prayerBreaks]);

  const filteredPrayerBreaks = useMemo(() => {
    return prayerBreaks.filter((p) => {
      const term = search.trim().toLowerCase();
      if (term) {
        const employeeName = (p.employee_name || "").toLowerCase();
        const pseudonym = (p.pseudonym || "").toLowerCase();
        if (!employeeName.includes(term) && !pseudonym.includes(term)) return false;
      }
      if (department && p.department_name !== department) return false;
      return true;
    });
  }, [prayerBreaks, search, department]);

  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filteredPrayerBreaks) {
      if (!p.prayer_break_start) continue;
      const start = new Date(p.prayer_break_start).getTime();
      const end = p.prayer_break_end ? new Date(p.prayer_break_end).getTime() : now;
      const seconds = Math.floor((end - start) / 1000);
      const key = getSessionGroupingKey(p);
      map.set(key, (map.get(key) || 0) + Math.max(0, seconds));
    }
    return map;
  }, [filteredPrayerBreaks, now]);

  const rows = useMemo(() => {
    return filteredPrayerBreaks
      .map((p) => {
        const isRunning = p.prayer_break_start && !p.prayer_break_end;
        const start = p.prayer_break_start ? new Date(p.prayer_break_start).getTime() : 0;
        const end = p.prayer_break_end ? new Date(p.prayer_break_end).getTime() : now;
        const sessionSeconds = p.prayer_break_start ? Math.floor((end - start) / 1000) : 0;
        const key = getSessionGroupingKey(p);
        const dailySeconds = dailyTotals.get(key) || sessionSeconds;
        const exceedToday = dailySeconds > 1800 ? dailySeconds - 1800 : 0;
        return {
          ...p,
          // Use attendance session clock-in date for overnight readability.
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
  }, [filteredPrayerBreaks, dailyTotals, now]);

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

  return (
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer}>
        <h1 style={{ marginBottom: 16 }}>Prayer Break Summary</h1>
        <div className={styles.breakSummaryFilters}>
          <input type="text" placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)} className={styles.breakSummaryInput} style={{ width: 180 }} />
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
        </div>

        <div className={styles.breakSummaryTableWrapper}>
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
                    <td>{p.employee_id}</td>
                    <td>{p.employee_name || ""}</td>
                    <td>{p.pseudonym || "-"}</td>
                    <td>{p.department_name || "-"}</td>
                    <td>{p.date_display}</td>
                    <td>{p.prayer_start_display}</td>
                    <td>
                      {p.prayer_break_start && !p.prayer_break_end ? (
                        <span style={{ color: "#e67e22", fontWeight: 600 }}>Running...</span>
                      ) : (
                        p.prayer_end_display
                      )}
                    </td>
                    <td>{p.total_prayer_time}</td>
                    <td>{p.total_prayer_time_today}</td>
                    <td style={{ color: p.exceed_today ? "#e74c3c" : undefined }}>{p.exceed_today}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutDashboard>
  );
}
