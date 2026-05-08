"use client";

import React, { useEffect, useState } from "react";
import styles from "../../break-summary/break-summary.module.css";
import attStyles from "../../attendance-summary/attendance-summary.module.css";
import { ClockBreakPrayerWidget } from "../../components/ClockBreakPrayer";
import { FaFileExcel } from "react-icons/fa";
import * as XLSX from 'xlsx';
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
  getParts
} from "../../../lib/timezone";


// Helper to format duration in hh:mm:ss
function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

// Helper to format total hours
function formatTotalHours(clockIn: string, clockOut: string) {
  if (!clockIn) return "00h 00m 00s";
  // Always use server timezone for both clockIn and now
  const clockInParts = getParts(clockIn, "Asia/Karachi");
  if (!clockInParts) return "00h 00m 00s";
  const start = new Date(Date.UTC(clockInParts.year, clockInParts.month - 1, clockInParts.day, clockInParts.hour, clockInParts.minute, clockInParts.second)).getTime();
  let end: number;
  if (clockOut) {
    const clockOutParts = getParts(clockOut, "Asia/Karachi");
    if (!clockOutParts) return "00h 00m 00s";
    end = new Date(Date.UTC(clockOutParts.year, clockOutParts.month - 1, clockOutParts.day, clockOutParts.hour, clockOutParts.minute, clockOutParts.second)).getTime();
  } else {
    const nowParts = getParts(new Date(), "Asia/Karachi");
    if (!nowParts) return "00h 00m 00s";
    end = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second)).getTime();
  }
  const totalSeconds = Math.floor((end - start) / 1000);
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

// Helper to format late minutes
function formatLateTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// Helper to format dates without timezone shift
function formatDateOnly(dateValue: string | null | undefined) {
  if (!dateValue) return "";
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.exec(dateValue);
  if (dateOnlyMatch) return dateValue;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return getDateStringInTimeZone(parsed, SERVER_TIMEZONE);
}

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function getSessionGroupingKey(
  record: any,
  startField: "break_start" | "prayer_break_start"
) {
  const attendanceSessionId =
    record.attendance_session_id ?? record.attendanceSessionId;

  if (
    attendanceSessionId !== undefined &&
    attendanceSessionId !== null &&
    attendanceSessionId !== ""
  ) {
    return `attendance:${attendanceSessionId}`;
  }

  if (
    record.shift_assignment_id !== undefined &&
    record.shift_assignment_id !== null &&
    record.shift_assignment_id !== ""
  ) {
    return `shift:${record.shift_assignment_id}`;
  }

  return `fallback:${record.id ?? record[startField] ?? "unknown"}`;
}

function toKarachiEpochMs(value: string | Date | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parts = getParts(value, SERVER_TIMEZONE);
  if (!parts) return null;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

export default function EmployeeTimePage() {
  const [activeTab, setActiveTab] = useState("break");
  const [breaks, setBreaks] = useState<any[]>([]);
  const [prayerBreaks, setPrayerBreaks] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [breakFromDate, setBreakFromDate] = useState("");
  const [breakToDate, setBreakToDate] = useState(getLocalDateString());
  const [prayerFromDate, setPrayerFromDate] = useState("");
  const [prayerToDate, setPrayerToDate] = useState(getLocalDateString());
  const [attFromDate, setAttFromDate] = useState("");
  const [attToDate, setAttToDate] = useState(getLocalDateString());
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  // For live timer
  const [now, setNow] = useState(Date.now());

  const isInRange = (dateStr: string | null | undefined, fromDate?: string, toDate?: string) => {
    if (!dateStr) return false;
    const dateOnly = getDateStringInTimeZone(dateStr, SERVER_TIMEZONE);
    if (fromDate && dateOnly < fromDate) return false;
    if (toDate && dateOnly > toDate) return false;
    return true;
  };

  // Update timer every second if any open attendance exists
  useEffect(() => {
    const hasOpen = attendance.some(a => a.clock_in && !a.clock_out);
    if (!hasOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [attendance]);

  // Get employeeId and employeeName from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const empId = localStorage.getItem("employeeId") || localStorage.getItem("loginId");
      const empName = localStorage.getItem("employeeName");
      if (empId) {
        setEmployeeId(empId);
      }
      if (empName) {
        setEmployeeName(empName);
      }
    }
  }, []);

  // Fetch breaks for current employee
  useEffect(() => {
    if (!employeeId) return;
    let url = `/api/breaks?employeeId=${employeeId}`;
    const params = new URLSearchParams();
    if (breakFromDate) params.append("fromDate", breakFromDate);
    if (breakToDate) params.append("toDate", breakToDate);
    if (params.toString()) url += `&${params.toString()}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const filtered = (data.breaks || []).filter((b: any) =>
            isInRange(b.date || b.break_start, breakFromDate, breakToDate)
          );
          setBreaks(filtered);
        }
        else setBreaks([]);
      });
  }, [employeeId, breakFromDate, breakToDate]);

  // Fetch prayer breaks for current employee
  useEffect(() => {
    if (!employeeId) return;
    let url = `/api/prayer_breaks?employeeId=${employeeId}`;
    const params = new URLSearchParams();
    if (prayerFromDate) params.append("fromDate", prayerFromDate);
    if (prayerToDate) params.append("toDate", prayerToDate);
    if (params.toString()) url += `&${params.toString()}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const filtered = (data.prayer_breaks || []).filter((p: any) =>
            isInRange(p.date || p.prayer_break_start, prayerFromDate, prayerToDate)
          );
          setPrayerBreaks(filtered);
        }
        else setPrayerBreaks([]);
      });
  }, [employeeId, prayerFromDate, prayerToDate]);

  // Fetch attendance for current employee
  useEffect(() => {
    if (!employeeId) return;
    let url = `/api/attendance?employeeId=${employeeId}`;
    const params = new URLSearchParams();
    if (attFromDate) params.append("fromDate", attFromDate);
    if (attToDate) params.append("toDate", attToDate);
    if (params.toString()) url += `&${params.toString()}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const filtered = (data.attendance || []).filter((a: any) =>
            isInRange(a.clock_in || a.date, attFromDate, attToDate)
          );
          // Separate valid and invalid clock_in records
          const valid = filtered.filter((a: any) => a.clock_in && toKarachiEpochMs(a.clock_in) !== null);
          const invalid = filtered.filter((a: any) => !a.clock_in || toKarachiEpochMs(a.clock_in) === null);
          valid.sort((a: any, b: any) => (toKarachiEpochMs(b.clock_in) || 0) - (toKarachiEpochMs(a.clock_in) || 0));
          setAttendance([...valid, ...invalid]);
        }
        else setAttendance([]);
      });
  }, [employeeId, attFromDate, attToDate]);

  // Aggregate all breaks per attendance session for this employee
  const dailyBreakTotals = (() => {
    const map = new Map<string, number>();
    for (const b of breaks) {
      if (!b.break_start) continue;
      const start = toKarachiEpochMs(b.break_start);
      const end = b.break_end ? toKarachiEpochMs(b.break_end) : toKarachiEpochMs(new Date(now));
      if (start === null || end === null) continue;
      const seconds = Math.floor((end - start) / 1000);
      const key = getSessionGroupingKey(b, "break_start");
      map.set(key, (map.get(key) || 0) + Math.max(0, seconds));
    }
    return map;
  })();

  // Map breaks data with both session and daily totals (including running breaks)
  const breakRows = breaks.map(b => {
    let sessionSeconds = 0;
    const isRunning = b.break_start && !b.break_end;
    if (b.break_start) {
      const start = toKarachiEpochMs(b.break_start);
      const end = b.break_end ? toKarachiEpochMs(b.break_end) : toKarachiEpochMs(new Date(now));
      if (start !== null && end !== null) {
        sessionSeconds = Math.floor((end - start) / 1000);
      }
    }
    const sessionExceed = sessionSeconds > 3600 ? sessionSeconds - 3600 : 0;
    const key = getSessionGroupingKey(b, "break_start");
    const dailySeconds = dailyBreakTotals.get(key) || sessionSeconds;
    const dailyExceed = dailySeconds > 3600 ? dailySeconds - 3600 : 0;
    return {
      ...b,
      break_start_display: b.break_start ? getTimeStringInTimeZone(b.break_start, SERVER_TIMEZONE) : "",
      break_end_display: b.break_end ? getTimeStringInTimeZone(b.break_end, SERVER_TIMEZONE) : (isRunning ? "🔴 Running" : ""),
      total_break_time: formatDuration(sessionSeconds),
      total_break_time_today: formatDuration(dailySeconds),
      exceed: sessionExceed > 0 ? formatDuration(sessionExceed) : "",
      exceed_today: dailyExceed > 0 ? formatDuration(dailyExceed) : "",
      // Show shift/session date for overnight readability (fallback to old behavior).
      date_display: b.session_clock_in
        ? getDateStringInTimeZone(b.session_clock_in, SERVER_TIMEZONE)
        : b.date
        ? getDateStringInTimeZone(b.date, SERVER_TIMEZONE)
        : (b.break_start ? getDateStringInTimeZone(b.break_start, SERVER_TIMEZONE) : ""),
      isRunning: isRunning
    };
  });

  const dailyPrayerTotals = (() => {
    const map = new Map<string, number>();
    for (const p of prayerBreaks) {
      if (!p.prayer_break_start) continue;
      const start = toKarachiEpochMs(p.prayer_break_start);
      const end = p.prayer_break_end ? toKarachiEpochMs(p.prayer_break_end) : toKarachiEpochMs(new Date(now));
      if (start === null || end === null) continue;
      const seconds = Math.floor((end - start) / 1000);
      const key = getSessionGroupingKey(p, "prayer_break_start");
      map.set(key, (map.get(key) || 0) + Math.max(0, seconds));
    }
    return map;
  })();

  // Map prayer breaks data with daily totals (including running prayer breaks)
  const prayerRows = prayerBreaks.map(p => {
    let sessionSeconds = 0;
    const isRunning = p.prayer_break_start && !p.prayer_break_end;
    if (p.prayer_break_start) {
      const start = toKarachiEpochMs(p.prayer_break_start);
      const end = p.prayer_break_end ? toKarachiEpochMs(p.prayer_break_end) : toKarachiEpochMs(new Date(now));
      if (start !== null && end !== null) {
        sessionSeconds = Math.floor((end - start) / 1000);
      }
    }
    const sessionExceed = sessionSeconds > 1800 ? sessionSeconds - 1800 : 0;
    const key = getSessionGroupingKey(p, "prayer_break_start");
    const dailySeconds = dailyPrayerTotals.get(key) || sessionSeconds;
    const dailyExceed = dailySeconds > 1800 ? dailySeconds - 1800 : 0;
    return {
      ...p,
      prayer_start_display: p.prayer_break_start ? getTimeStringInTimeZone(p.prayer_break_start, SERVER_TIMEZONE) : "",
      prayer_end_display: p.prayer_break_end ? getTimeStringInTimeZone(p.prayer_break_end, SERVER_TIMEZONE) : (isRunning ? "🔴 Running" : ""),
      total_prayer_time: formatDuration(sessionSeconds),
      total_prayer_time_today: formatDuration(dailySeconds),
      exceed: sessionExceed > 0 ? formatDuration(sessionExceed) : "",
      exceed_today: dailyExceed > 0 ? formatDuration(dailyExceed) : "",
      // Show shift/session date for overnight readability (fallback to old behavior).
      date_display: p.session_clock_in
        ? getDateStringInTimeZone(p.session_clock_in, SERVER_TIMEZONE)
        : p.date
        ? getDateStringInTimeZone(p.date, SERVER_TIMEZONE)
        : (p.prayer_break_start ? getDateStringInTimeZone(p.prayer_break_start, SERVER_TIMEZONE) : ""),
      isRunning: isRunning
    };
  });

  const downloadBreaksCSV = () => {
    const headers = ["Employee ID", "Name", "Pseudo Name", "Department", "Date", "Break Start", "Break End", "Total Break Time", "Total Break", "Exceed", "Exceed Today"];
    let csv = headers.join(',') + '\n';
    breakRows.forEach(row => {
      const pseudo = row.pseudonym !== undefined ? row.pseudonym : (attendance && attendance[0]?.pseudonym ? attendance[0].pseudonym : '');
      // Format date as yyyy-mm-dd for Excel compatibility
      const excelDate = row.date_display ? `${row.date_display} 00:00:00` : '';
      csv += [row.employee_id, row.employee_name || row.name, pseudo, row.department_name, excelDate, row.break_start_display, row.break_end_display, row.total_break_time, row.total_break_time_today, row.exceed, row.exceed_today].map(val => `"${val}"`).join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my_break_summary.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const downloadPrayerCSV = () => {
    const headers = ["Employee ID", "Name", "Pseudo Name", "Department", "Date", "Prayer Start", "Prayer End", "Total Prayer Time", "Total Prayer", "Exceed", "Exceed Today"];
    let csv = headers.join(',') + '\n';
    prayerRows.forEach(row => {
      const pseudo = row.pseudonym !== undefined ? row.pseudonym : (attendance && attendance[0]?.pseudonym ? attendance[0].pseudonym : '');
      csv += [row.employee_id, row.employee_name || row.name, pseudo, row.department_name, row.date_display, row.prayer_start_display, row.prayer_end_display, row.total_prayer_time, row.total_prayer_time_today, row.exceed, row.exceed_today].map(val => `"${val}"`).join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my_prayer_break_summary.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const downloadAttendanceCSV = () => {
    const data = attendance.map(row => {
      const date = row.date ? getDateStringInTimeZone(row.date, SERVER_TIMEZONE) : "";
      const clockIn = row.clock_in ? getTimeStringInTimeZone(row.clock_in, SERVER_TIMEZONE) : "";
      const clockOut = row.clock_out ? getTimeStringInTimeZone(row.clock_out, SERVER_TIMEZONE) : "";
      const totalHours = formatTotalHours(row.clock_in, row.clock_out);
      const late = row.is_late ? `Late ${formatLateTime(row.late_minutes || 0)}` : "On Time";
      return {
        "Id": row.employee_id,
        "Name": row.employee_name || row.name,
        "Pseudo Name": row.pseudonym,
        "Department": row.department_name,
        "Date": date,
        "Clock In": clockIn,
        "Clock Out": clockOut,
        "Total Hours": totalHours,
        "Late": late
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 10 }, // Employee ID
      { wch: 22 }, // Name
      { wch: 18 }, // Pseudo Name
      { wch: 18 }, // Department
      { wch: 22 }, // Date
      { wch: 18 }, // Clock In
      { wch: 18 }, // Clock Out
      { wch: 16 }, // Total Hours
      { wch: 14 }  // Late
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `my_attendance_summary_${getDateStringInTimeZone(new Date(), SERVER_TIMEZONE)}.xlsx`);
  };

  const tabStyles: React.CSSProperties = {
    display: "flex",
    gap: "12px",
    borderBottom: "2px solid #E2E8F0",
    marginBottom: "28px",
    paddingBottom: "0"
  };

  const tabButtonStyles = (isActive: boolean): React.CSSProperties => ({
    padding: "12px 24px",
    border: "none",
    background: isActive ? "linear-gradient(135deg, #0052CC 0%, #00B8A9 100%)" : "transparent",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: isActive ? "600" : "500",
    color: isActive ? "#fff" : "#4A5568",
    borderRadius: isActive ? "8px 8px 0 0" : "0",
    marginBottom: "-2px",
    transition: "all 0.3s",
    boxShadow: isActive ? "0 -2px 8px rgba(0,82,204,0.15)" : "none"
  });

  return (
    <div style={{ width: '100%', minHeight: '100vh', background: 'linear-gradient(135deg, #6a82fb 0%, #fc5c7d 100%)', padding: 0, margin: 0 }}>
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '0 16px' }}>
        {/* Shared Clock / Break / Prayer controls at the very top */}
        <div style={{ marginTop: '40px' }}>
          <ClockBreakPrayerWidget employeeId={employeeId} employeeName={employeeName} />
        </div>

        <h1 style={{ marginTop: "24px", marginBottom: "24px", color: "#fff", fontWeight: 700, fontSize: "1.75rem", letterSpacing: "0.3px" }}>My Time & Attendance</h1>

        <div style={{ ...tabStyles, borderBottom: 'none' }}>
          <button style={{ ...tabButtonStyles(activeTab === "break"), color: '#fff' }} onClick={() => setActiveTab("break")}> 
            Break Summary
          </button>
          <button style={{ ...tabButtonStyles(activeTab === "prayer"), color: '#fff' }} onClick={() => setActiveTab("prayer")}> 
            Prayer Break Summary
          </button>
          <button style={{ ...tabButtonStyles(activeTab === "attendance"), color: '#fff' }} onClick={() => setActiveTab("attendance")}> 
            Attendance Summary
          </button>
        </div>

        {activeTab === "break" && (
          <div className={styles.breakSummaryContainer} style={{ width: '100%' }}>
            <div className={styles.breakSummaryFilters}>
              <input
                type="date"
                value={breakFromDate}
                onChange={e => setBreakFromDate(e.target.value)}
                className={styles.breakSummaryDate}
                placeholder="From Date"
              />
              <input
                type="date"
                value={breakToDate}
                onChange={e => setBreakToDate(e.target.value)}
                className={styles.breakSummaryDate}
                placeholder="To Date"
              />
              <button onClick={downloadBreaksCSV} className={styles.breakSummaryXLSButton} title="Download XLS">
                <FaFileExcel size={20} />
                <span>Export XLS</span>
              </button>
            </div>
            <div className={styles.breakSummaryTableWrapper} style={{
              width: '100%',
              overflowX: 'auto',
              overflowY: 'hidden',
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 2px 8px #e2e8f0',
              padding: '0',
              margin: '0',
              border: '1px solid #e2e8f0',
              scrollbarWidth: 'thin',
              WebkitOverflowScrolling: 'touch'
            }}>
              <table className={styles.breakSummaryTable} style={{ minWidth: 1400, width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
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
                {breakRows.length === 0 ? (
                  <tr>
                      <td colSpan={7} className={styles.breakSummaryNoRecords}>No records found.</td>
                  </tr>
                ) : (
                  (() => {
                    // Find last break index for each attendance session
                    const lastIndexMap = new Map();
                    breakRows.forEach((row, idx) => {
                      const key = getSessionGroupingKey(row, "break_start");
                      lastIndexMap.set(key, idx);
                    });
                    return breakRows.map((b, idx) => {
                      const key = getSessionGroupingKey(b, "break_start");
                      const isLast = lastIndexMap.get(key) === idx;
                      return (
                        <tr key={b.id || idx}>
                          <td>{employeeId}</td>
                          <td>{employeeName}</td>
                          <td>{attendance && attendance[0]?.pseudonym ? attendance[0].pseudonym : 'undefined'}</td>
                          <td>{attendance && attendance[0]?.department_name ? attendance[0].department_name : '-'}</td>
                          <td>{b.date_display}</td>
                          <td>{b.break_start_display}</td>
                          <td>{b.break_end_display}</td>
                          <td>{b.total_break_time}</td>
                          <td>{b.total_break_time_today}</td>
                          <td style={{ color: isLast && b.exceed_today ? "#e74c3c" : undefined }}>
                            {isLast ? b.exceed_today : ""}
                          </td>
                        </tr>
                      );
                    });
                  })()
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === "prayer" && (
          <div className={styles.breakSummaryContainer} style={{ width: '100%' }}>
            <div className={styles.breakSummaryFilters}>
              <input
                type="date"
                value={prayerFromDate}
                onChange={e => setPrayerFromDate(e.target.value)}
                className={styles.breakSummaryDate}
                placeholder="From Date"
              />
              <input
                type="date"
                value={prayerToDate}
                onChange={e => setPrayerToDate(e.target.value)}
                className={styles.breakSummaryDate}
                placeholder="To Date"
              />
              <button onClick={downloadPrayerCSV} className={styles.breakSummaryXLSButton} title="Download XLS">
                <FaFileExcel size={20} />
                <span>Export XLS</span>
              </button>
            </div>
            <div className={styles.breakSummaryTableWrapper} style={{
              width: '100%',
              overflowX: 'auto',
              overflowY: 'hidden',
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 2px 8px #e2e8f0',
              padding: '0',
              margin: '0',
              border: '1px solid #e2e8f0',
              scrollbarWidth: 'thin',
              WebkitOverflowScrolling: 'touch'
            }}>
              <table className={styles.breakSummaryTable} style={{ minWidth: 1400, width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
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
                {prayerRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={styles.breakSummaryNoRecords}>No records found.</td>
                  </tr>
                ) : (
                  (() => {
                    // Find last prayer break index for each attendance session
                    const lastIndexMap = new Map();
                    prayerRows.forEach((row, idx) => {
                      const key = getSessionGroupingKey(row, "prayer_break_start");
                      lastIndexMap.set(key, idx);
                    });
                    return prayerRows.map((p, idx) => {
                      const key = getSessionGroupingKey(p, "prayer_break_start");
                      const isLast = lastIndexMap.get(key) === idx;
                      return (
                        <tr key={p.id || idx}>
                          <td>{employeeId}</td>
                          <td>{employeeName}</td>
                          <td>{attendance && attendance[0]?.pseudonym ? attendance[0].pseudonym : 'undefined'}</td>
                          <td>{attendance && attendance[0]?.department_name ? attendance[0].department_name : '-'}</td>
                          <td>{p.date_display}</td>
                          <td>{p.prayer_start_display}</td>
                          <td>{p.prayer_end_display}</td>
                          <td>{p.total_prayer_time}</td>
                          <td>{p.total_prayer_time_today}</td>
                          <td style={{ color: isLast && p.exceed_today ? "#e74c3c" : undefined }}>
                            {isLast ? p.exceed_today : ""}
                          </td>
                        </tr>
                      );
                    });
                  })()
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === "attendance" && (
          <div className={attStyles.attendanceSummaryContainer} style={{ width: '100%' }}>
            <div className={attStyles.attendanceSummaryFilters}>
              <input
                type="date"
                value={attFromDate}
                onChange={e => setAttFromDate(e.target.value)}
                className={attStyles.attendanceSummaryDate}
                placeholder="From Date"
              />
              <input
                type="date"
                value={attToDate}
                onChange={e => setAttToDate(e.target.value)}
                className={attStyles.attendanceSummaryDate}
                placeholder="To Date"
              />
              <button onClick={downloadAttendanceCSV} className={attStyles.attendanceSummaryXLSButton} title="Download XLS">
                <FaFileExcel size={20} />
                <span>Export XLS</span>
              </button>
            </div>
            <div className={attStyles.attendanceSummaryTableWrapper} style={{
              width: '100%',
              overflowX: 'auto',
              overflowY: 'hidden',
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 2px 8px #e2e8f0',
              padding: '0',
              margin: '0',
              border: '1px solid #e2e8f0',
              scrollbarWidth: 'thin',
              WebkitOverflowScrolling: 'touch'
            }}>
              <table className={attStyles.attendanceSummaryTable} style={{ minWidth: 1400, width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
                <thead>
                <tr>
                  <th>Id</th>
                  <th>Name</th>
                  <th>Pseudo Name</th>
                  <th>Department</th>
                  <th>Date</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Total Hours</th>
                  <th>Late</th>
                </tr>
              </thead>
              <tbody>
                {attendance.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={attStyles.attendanceSummaryNoRecords}>No records found.</td>
                  </tr>
                ) : (
                  attendance
                    .sort((a, b) => {
                      // Sort by clock_in descending (latest first)
                      if (!a.clock_in && !b.clock_in) return 0;
                      if (!a.clock_in) return 1;
                      if (!b.clock_in) return -1;
                      return (toKarachiEpochMs(b.clock_in) || 0) - (toKarachiEpochMs(a.clock_in) || 0);
                    })
                    .map((a, idx) => (
                      <tr key={a.id || idx}>
                        <td>{a.employee_id || employeeId}</td>
                        <td>{employeeName}</td>
                        <td>{a.pseudonym || 'undefined'}</td>
                        <td>{a.department_name || '-'}</td>
                        <td>{formatDateOnly(a.clock_in || a.clock_out || a.date)}</td>
                        <td>{a.clock_in ? getTimeStringInTimeZone(a.clock_in, SERVER_TIMEZONE) : ""}</td>
                        <td>
                          {a.clock_out
                            ? getTimeStringInTimeZone(a.clock_out, SERVER_TIMEZONE)
                            : <span style={{color: '#e67e22', fontWeight: 600}}>Running...</span>}
                        </td>
                        <td>
                          {a.clock_in && !a.clock_out
                            ? formatTotalHours(a.clock_in, "") // will use Date.now()
                            : formatTotalHours(a.clock_in, a.clock_out)}
                        </td>
                        <td style={{ color: a.is_late ? "#e74c3c" : "#27ae60", fontWeight: "600" }}>
                          {a.is_late ? `Late ${formatLateTime(a.late_minutes || 0)}` : "On Time"}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
