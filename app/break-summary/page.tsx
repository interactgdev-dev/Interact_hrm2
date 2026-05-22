"use client";

import React, { useEffect, useMemo, useState } from "react";
import LayoutDashboard from "../layout-dashboard";
import styles from "./break-summary.module.css";
import { FaFileExcel } from "react-icons/fa";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../lib/timezone";

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function getMonthStartDateString(date: Date = new Date()) {
  const d = getDateStringInTimeZone(date, SERVER_TIMEZONE);
  return `${d.slice(0, 7)}-01`;
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

export default function BreakSummaryPage() {
  const [breaks, setBreaks] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [fromDate, setFromDate] = useState(getMonthStartDateString());
  const [toDate, setToDate] = useState(getLocalDateString());
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
    const url = `/api/breaks${params.toString() ? `?${params.toString()}` : ""}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setBreaks(data.breaks || []);
        else setBreaks([]);
      });
  }, [fromDate, toDate]);

  useEffect(() => {
    const hasRunning = breaks.some((b) => b.break_start && !b.break_end);
    if (!hasRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [breaks]);

  const filteredBreaks = useMemo(() => {
    return breaks.filter((b) => {
      const term = search.trim().toLowerCase();
      if (term) {
        const employeeName = (b.employee_name || "").toLowerCase();
        const pseudonym = (b.pseudonym || "").toLowerCase();
        if (!employeeName.includes(term) && !pseudonym.includes(term)) return false;
      }
      if (department && b.department_name !== department) return false;
      return true;
    });
  }, [breaks, search, department]);

  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of filteredBreaks) {
      if (!b.break_start) continue;
      const start = new Date(b.break_start).getTime();
      const end = b.break_end ? new Date(b.break_end).getTime() : now;
      const seconds = Math.floor((end - start) / 1000);
      const key = getSessionGroupingKey(b);
      map.set(key, (map.get(key) || 0) + Math.max(0, seconds));
    }
    return map;
  }, [filteredBreaks, now]);

  const rows = useMemo(() => {
    return filteredBreaks
      .map((b) => {
        const isRunning = b.break_start && !b.break_end;
        const start = b.break_start ? new Date(b.break_start).getTime() : 0;
        const end = b.break_end ? new Date(b.break_end).getTime() : now;
        const sessionSeconds = b.break_start ? Math.floor((end - start) / 1000) : 0;
        const key = getSessionGroupingKey(b);
        const dailySeconds = dailyTotals.get(key) || sessionSeconds;
        const exceedToday = dailySeconds > 3600 ? dailySeconds - 3600 : 0;
        return {
          ...b,
          // Use attendance session clock-in date for overnight readability.
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
  }, [filteredBreaks, dailyTotals, now]);

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

  return (
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer}>
        <h1 style={{ marginBottom: 16 }}>Break Summary</h1>
        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search employee..."
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
                    <td>{b.employee_id}</td>
                    <td>{b.employee_name || ""}</td>
                    <td>{b.pseudonym || "-"}</td>
                    <td>{b.department_name || "-"}</td>
                    <td>{b.date_display}</td>
                    <td>{b.break_start_display}</td>
                    <td>
                      {b.break_start && !b.break_end ? (
                        <span style={{ color: "#e67e22", fontWeight: 600 }}>Running...</span>
                      ) : (
                        b.break_end_display
                      )}
                    </td>
                    <td>{b.total_break_time}</td>
                    <td>{b.total_break_time_today}</td>
                    <td style={{ color: b.exceed_today ? "#e74c3c" : undefined }}>{b.exceed_today}</td>
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
