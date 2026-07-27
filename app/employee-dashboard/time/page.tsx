"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ATTENDANCE_DATA_CHANGED,
  BREAK_DATA_CHANGED,
  PRAYER_DATA_CHANGED,
} from "../../../lib/ui-sync/breakPrayerDataRefresh";
import styles from "../../break-summary/break-summary.module.css";
import { AutoClockOutBadge } from "../../components/AutoClockOutBadge";
import { isAutoClockOutRecord } from "../../../lib/attendance-auto-clock-out";
import { FaFileExcel } from "react-icons/fa";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import {
  EmployeeDetailPopup,
  type EmployeeDetailPayload,
} from "../../components/EmployeeDetailPopup";
import { buildEmployeeDetailPayload } from "@/lib/employee-detail-from-row";
import { useEmployeePhotoMap } from "../../components/use-employee-photo-map";
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
function formatTotalHours(clockIn: string, clockOut: string, currentTime?: number) {
  if (!clockIn) return "00h 00m 00s";
  const clockInParts = getParts(clockIn, SERVER_TIMEZONE);
  if (!clockInParts) return "00h 00m 00s";
  const start = new Date(Date.UTC(clockInParts.year, clockInParts.month - 1, clockInParts.day, clockInParts.hour, clockInParts.minute, clockInParts.second)).getTime();
  let end: number;
  if (clockOut) {
    const clockOutParts = getParts(clockOut, SERVER_TIMEZONE);
    if (!clockOutParts) return "00h 00m 00s";
    end = new Date(Date.UTC(clockOutParts.year, clockOutParts.month - 1, clockOutParts.day, clockOutParts.hour, clockOutParts.minute, clockOutParts.second)).getTime();
  } else {
    const nowParts = getParts(new Date(currentTime || Date.now()), SERVER_TIMEZONE);
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
  /** Default: current day only — expand range when user picks dates */
  const today = getLocalDateString();
  const [breakFromDate, setBreakFromDate] = useState(today);
  const [breakToDate, setBreakToDate] = useState(today);
  const [prayerFromDate, setPrayerFromDate] = useState(today);
  const [prayerToDate, setPrayerToDate] = useState(today);
  const [attFromDate, setAttFromDate] = useState(today);
  const [attToDate, setAttToDate] = useState(today);
  const [loadingBreaks, setLoadingBreaks] = useState(false);
  const [loadingPrayer, setLoadingPrayer] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [detail, setDetail] = useState<EmployeeDetailPayload | null>(null);
  const [now, setNow] = useState(Date.now());
  const { getPhoto } = useEmployeePhotoMap();

  // Live timer only when something is running (5s — avoids full recompute every second)
  useEffect(() => {
    const hasOpenAttendance = attendance.some((a) => a.clock_in && !a.clock_out);
    const hasOpenBreak = breaks.some((b) => b.break_start && !b.break_end);
    const hasOpenPrayer = prayerBreaks.some((p) => p.prayer_break_start && !p.prayer_break_end);
    if (!hasOpenAttendance && !hasOpenBreak && !hasOpenPrayer) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [attendance, breaks, prayerBreaks]);

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

  const fetchBreaks = useCallback(() => {
    if (!employeeId) return;
    const from = breakFromDate || breakToDate || today;
    const to = breakToDate || breakFromDate || today;
    const params = new URLSearchParams({
      employeeId,
      fromDate: from,
      toDate: to,
    });
    setLoadingBreaks(true);
    fetch(`/api/breaks?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setBreaks(data.breaks || []);
        else setBreaks([]);
      })
      .catch(() => setBreaks([]))
      .finally(() => setLoadingBreaks(false));
  }, [employeeId, breakFromDate, breakToDate, today]);

  const fetchPrayerBreaks = useCallback(() => {
    if (!employeeId) return;
    const from = prayerFromDate || prayerToDate || today;
    const to = prayerToDate || prayerFromDate || today;
    const params = new URLSearchParams({
      employeeId,
      fromDate: from,
      toDate: to,
    });
    setLoadingPrayer(true);
    fetch(`/api/prayer_breaks?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setPrayerBreaks(data.prayer_breaks || []);
        else setPrayerBreaks([]);
      })
      .catch(() => setPrayerBreaks([]))
      .finally(() => setLoadingPrayer(false));
  }, [employeeId, prayerFromDate, prayerToDate, today]);

  const fetchAttendance = useCallback(() => {
    if (!employeeId) return;
    const from = attFromDate || attToDate || today;
    const to = attToDate || attFromDate || today;
    const params = new URLSearchParams({
      employeeId,
      fromDate: from,
      toDate: to,
      summary: "1",
    });
    setLoadingAttendance(true);
    fetch(`/api/attendance?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const list = data.attendance || [];
          const valid = list.filter((a: any) => a.clock_in && toKarachiEpochMs(a.clock_in) !== null);
          const invalid = list.filter((a: any) => !a.clock_in || toKarachiEpochMs(a.clock_in) === null);
          valid.sort(
            (a: any, b: any) =>
              (toKarachiEpochMs(b.clock_in) || 0) - (toKarachiEpochMs(a.clock_in) || 0)
          );
          setAttendance([...valid, ...invalid]);
        } else setAttendance([]);
      })
      .catch(() => setAttendance([]))
      .finally(() => setLoadingAttendance(false));
  }, [employeeId, attFromDate, attToDate, today]);

  useEffect(() => {
    if (!employeeId || activeTab !== "break") return;
    fetchBreaks();
  }, [employeeId, activeTab, fetchBreaks]);

  useEffect(() => {
    if (!employeeId || activeTab !== "prayer") return;
    fetchPrayerBreaks();
  }, [employeeId, activeTab, fetchPrayerBreaks]);

  useEffect(() => {
    if (!employeeId || activeTab !== "attendance") return;
    fetchAttendance();
  }, [employeeId, activeTab, fetchAttendance]);

  useEffect(() => {
    const onBreakChanged = () => {
      if (activeTab === "break") fetchBreaks();
    };
    const onPrayerChanged = () => {
      if (activeTab === "prayer") fetchPrayerBreaks();
    };
    const onAttendanceChanged = () => {
      if (activeTab === "attendance") fetchAttendance();
    };
    window.addEventListener(BREAK_DATA_CHANGED, onBreakChanged);
    window.addEventListener(PRAYER_DATA_CHANGED, onPrayerChanged);
    window.addEventListener(ATTENDANCE_DATA_CHANGED, onAttendanceChanged);
    return () => {
      window.removeEventListener(BREAK_DATA_CHANGED, onBreakChanged);
      window.removeEventListener(PRAYER_DATA_CHANGED, onPrayerChanged);
      window.removeEventListener(ATTENDANCE_DATA_CHANGED, onAttendanceChanged);
    };
  }, [activeTab, fetchBreaks, fetchPrayerBreaks, fetchAttendance]);

  const breakRows = useMemo(() => {
    const staticTotals = new Map<string, number>();
    for (const b of breaks) {
      if (!b.break_start || !b.break_end) continue;
      const start = toKarachiEpochMs(b.break_start);
      const end = toKarachiEpochMs(b.break_end);
      if (start === null || end === null) continue;
      const key = getSessionGroupingKey(b, "break_start");
      staticTotals.set(key, (staticTotals.get(key) || 0) + Math.max(0, Math.floor((end - start) / 1000)));
    }
    const liveTotals = new Map(staticTotals);
    for (const b of breaks) {
      if (!b.break_start || b.break_end) continue;
      const start = toKarachiEpochMs(b.break_start);
      const end = toKarachiEpochMs(new Date(now));
      if (start === null || end === null) continue;
      const key = getSessionGroupingKey(b, "break_start");
      liveTotals.set(key, (liveTotals.get(key) || 0) + Math.max(0, Math.floor((end - start) / 1000)));
    }

    return breaks.map((b) => {
      let sessionSeconds = 0;
      const isRunning = b.break_start && !b.break_end;
      if (b.break_start) {
        const start = toKarachiEpochMs(b.break_start);
        const end = b.break_end ? toKarachiEpochMs(b.break_end) : toKarachiEpochMs(new Date(now));
        if (start !== null && end !== null) {
          sessionSeconds = Math.floor((end - start) / 1000);
        }
      }
      const key = getSessionGroupingKey(b, "break_start");
      const dailySeconds = liveTotals.get(key) || sessionSeconds;
      const dailyExceed = dailySeconds > 3600 ? dailySeconds - 3600 : 0;
      return {
        ...b,
        break_start_display: b.break_start ? getTimeStringInTimeZone(b.break_start, SERVER_TIMEZONE) : "",
        break_end_display: b.break_end
          ? getTimeStringInTimeZone(b.break_end, SERVER_TIMEZONE)
          : isRunning
          ? "Running"
          : "",
        total_break_time: formatDuration(sessionSeconds),
        total_break_time_today: formatDuration(dailySeconds),
        exceed_today: dailyExceed > 0 ? formatDuration(dailyExceed) : "",
        date_display: b.session_clock_in
          ? getDateStringInTimeZone(b.session_clock_in, SERVER_TIMEZONE)
          : b.date
          ? getDateStringInTimeZone(b.date, SERVER_TIMEZONE)
          : b.break_start
          ? getDateStringInTimeZone(b.break_start, SERVER_TIMEZONE)
          : "",
        isRunning,
      };
    });
  }, [breaks, now]);

  const prayerRows = useMemo(() => {
    const staticTotals = new Map<string, number>();
    for (const p of prayerBreaks) {
      if (!p.prayer_break_start || !p.prayer_break_end) continue;
      const start = toKarachiEpochMs(p.prayer_break_start);
      const end = toKarachiEpochMs(p.prayer_break_end);
      if (start === null || end === null) continue;
      const key = getSessionGroupingKey(p, "prayer_break_start");
      staticTotals.set(key, (staticTotals.get(key) || 0) + Math.max(0, Math.floor((end - start) / 1000)));
    }
    const liveTotals = new Map(staticTotals);
    for (const p of prayerBreaks) {
      if (!p.prayer_break_start || p.prayer_break_end) continue;
      const start = toKarachiEpochMs(p.prayer_break_start);
      const end = toKarachiEpochMs(new Date(now));
      if (start === null || end === null) continue;
      const key = getSessionGroupingKey(p, "prayer_break_start");
      liveTotals.set(key, (liveTotals.get(key) || 0) + Math.max(0, Math.floor((end - start) / 1000)));
    }

    return prayerBreaks.map((p) => {
      let sessionSeconds = 0;
      const isRunning = p.prayer_break_start && !p.prayer_break_end;
      if (p.prayer_break_start) {
        const start = toKarachiEpochMs(p.prayer_break_start);
        const end = p.prayer_break_end
          ? toKarachiEpochMs(p.prayer_break_end)
          : toKarachiEpochMs(new Date(now));
        if (start !== null && end !== null) {
          sessionSeconds = Math.floor((end - start) / 1000);
        }
      }
      const key = getSessionGroupingKey(p, "prayer_break_start");
      const dailySeconds = liveTotals.get(key) || sessionSeconds;
      const dailyExceed = dailySeconds > 1800 ? dailySeconds - 1800 : 0;
      return {
        ...p,
        prayer_start_display: p.prayer_break_start
          ? getTimeStringInTimeZone(p.prayer_break_start, SERVER_TIMEZONE)
          : "",
        prayer_end_display: p.prayer_break_end
          ? getTimeStringInTimeZone(p.prayer_break_end, SERVER_TIMEZONE)
          : isRunning
          ? "Running"
          : "",
        total_prayer_time: formatDuration(sessionSeconds),
        total_prayer_time_today: formatDuration(dailySeconds),
        exceed_today: dailyExceed > 0 ? formatDuration(dailyExceed) : "",
        date_display: p.session_clock_in
          ? getDateStringInTimeZone(p.session_clock_in, SERVER_TIMEZONE)
          : p.date
          ? getDateStringInTimeZone(p.date, SERVER_TIMEZONE)
          : p.prayer_break_start
          ? getDateStringInTimeZone(p.prayer_break_start, SERVER_TIMEZONE)
          : "",
        isRunning,
      };
    });
  }, [prayerBreaks, now]);

  const closedAttendanceHours = useMemo(() => {
    const map = new Map<string | number, string>();
    for (const a of attendance) {
      if (!a.clock_in || !a.clock_out) continue;
      const key = a.id ?? `${a.employee_id}-${a.clock_in}`;
      map.set(key, formatTotalHours(a.clock_in, a.clock_out));
    }
    return map;
  }, [attendance]);

  const downloadBreaksCSV = () => {
    const headers = ["Employee ID", "Name", "Pseudo Name", "Department", "Date", "Break Start", "Break End", "Total Break Time", "Total Break", "Exceed Today"];
    let csv = headers.join(',') + '\n';
    breakRows.forEach(row => {
      const pseudo = row.pseudonym !== undefined ? row.pseudonym : (attendance && attendance[0]?.pseudonym ? attendance[0].pseudonym : '');
      const excelDate = row.date_display ? `${row.date_display} 00:00:00` : '';
      csv += [row.employee_id, row.employee_name || row.name, pseudo, row.department_name, excelDate, row.break_start_display, row.break_end_display, row.total_break_time, row.total_break_time_today, row.exceed_today].map(val => `"${val}"`).join(',') + '\n';
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
    const headers = ["Employee ID", "Name", "Pseudo Name", "Department", "Date", "Prayer Start", "Prayer End", "Total Prayer Time", "Total Prayer", "Exceed Today"];
    let csv = headers.join(',') + '\n';
    prayerRows.forEach(row => {
      const pseudo = row.pseudonym !== undefined ? row.pseudonym : (attendance && attendance[0]?.pseudonym ? attendance[0].pseudonym : '');
      csv += [row.employee_id, row.employee_name || row.name, pseudo, row.department_name, row.date_display, row.prayer_start_display, row.prayer_end_display, row.total_prayer_time, row.total_prayer_time_today, row.exceed_today].map(val => `"${val}"`).join(',') + '\n';
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

  const downloadAttendanceCSV = async () => {
    const XLSX = await import("xlsx");
    const data = attendance.map(row => {
      const date = row.date ? getDateStringInTimeZone(row.date, SERVER_TIMEZONE) : "";
      const clockIn = row.clock_in ? getTimeStringInTimeZone(row.clock_in, SERVER_TIMEZONE) : "";
      const clockOut = row.clock_out ? getTimeStringInTimeZone(row.clock_out, SERVER_TIMEZONE) : "";
      const key = row.id ?? `${row.employee_id}-${row.clock_in}`;
      const totalHours =
        row.clock_in && !row.clock_out
          ? formatTotalHours(row.clock_in, "", now)
          : closedAttendanceHours.get(key) || formatTotalHours(row.clock_in, row.clock_out);
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
      { wch: 10 },
      { wch: 22 },
      { wch: 18 },
      { wch: 18 },
      { wch: 22 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 14 }
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
    padding: "12px 20px",
    border: "none",
    background: isActive ? "linear-gradient(135deg, #611f69 0%, #007a5a 100%)" : "transparent",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: isActive ? "600" : "500",
    color: isActive ? "#fff" : "#64748b",
    borderRadius: isActive ? "8px 8px 0 0" : "8px 8px 0 0",
    marginBottom: "-2px",
    transition: "background 0.15s, color 0.15s",
    boxShadow: isActive ? "0 -2px 8px rgba(97, 31, 105, 0.15)" : "none",
  });

  const employeePseudonym =
    breaks[0]?.pseudonym ||
    prayerBreaks[0]?.pseudonym ||
    attendance[0]?.pseudonym ||
    null;
  const employeeDepartment =
    breaks[0]?.department_name ||
    prayerBreaks[0]?.department_name ||
    attendance[0]?.department_name ||
    null;
  const employeeEmail = breaks[0]?.email || attendance[0]?.email || null;

  const openBreakDetail = (row: any) => {
    void buildEmployeeDetailPayload(
      {
        ...row,
        employee_id: employeeId || row.employee_id,
        employee_name: employeeName || row.employee_name,
        pseudonym: row.pseudonym || employeePseudonym,
        department_name: row.department_name || employeeDepartment,
        email: row.email || employeeEmail,
      },
      getPhoto
    ).then(setDetail);
  };

  const displayPseudonym = (row?: { pseudonym?: string | null }) =>
    row?.pseudonym || employeePseudonym || "—";

  const loadingBox = (
    <div style={{ textAlign: "center", padding: "40px", fontSize: "16px", color: "#718096" }}>
      Loading...
    </div>
  );

  return (
    <div style={{ width: '100%', minHeight: '100vh', background: 'linear-gradient(180deg, #f4f6f9 0%, #eef1f6 100%)', padding: 0, margin: 0 }}>
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '0 16px 32px' }}>
        <h1 style={{ marginTop: "24px", marginBottom: "24px", color: "#0f172a", fontWeight: 700, fontSize: "1.75rem", letterSpacing: "-0.02em" }}>My Time & Attendance</h1>

        <div style={{ ...tabStyles, borderBottom: '2px solid #e2e8f0', background: '#fff', borderRadius: '12px 12px 0 0', padding: '8px 8px 0' }}>
          <button style={tabButtonStyles(activeTab === "break")} onClick={() => setActiveTab("break")}>
            Break Summary
          </button>
          <button style={tabButtonStyles(activeTab === "prayer")} onClick={() => setActiveTab("prayer")}>
            Prayer Break Summary
          </button>
          <button style={tabButtonStyles(activeTab === "attendance")} onClick={() => setActiveTab("attendance")}>
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
            <div className={styles.breakSummaryTableWrapper}>
              {loadingBreaks ? loadingBox : (
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
                {breakRows.length === 0 ? (
                  <tr>
                      <td colSpan={10} className={styles.breakSummaryNoRecords}>No records found.</td>
                  </tr>
                ) : (
                  (() => {
                    const lastIndexMap = new Map();
                    breakRows.forEach((row, idx) => {
                      const key = getSessionGroupingKey(row, "break_start");
                      lastIndexMap.set(key, idx);
                    });
                    return breakRows.map((b, idx) => {
                      const key = getSessionGroupingKey(b, "break_start");
                      const isLast = lastIndexMap.get(key) === idx;
                      const pseudo = b.pseudonym || employeePseudonym || "—";
                      const dept = b.department_name || employeeDepartment || "—";
                      return (
                        <tr key={b.id || idx}>
                          <td className={styles.cellMuted}>{employeeId}</td>
                          <td className={styles.nameCol}>
                            <EmployeeTableNameCell
                              name={employeeName || b.employee_name || ""}
                              employeeId={employeeId}
                              photo={getPhoto(employeeId)}
                              onOpen={() => openBreakDetail(b)}
                            />
                          </td>
                          <td>{pseudo}</td>
                          <td>{dept}</td>
                          <td>{b.date_display}</td>
                          <td>{b.break_start_display}</td>
                          <td>
                            {b.isRunning ? (
                              <span className={styles.badgeRunning}>Running</span>
                            ) : (
                              b.break_end_display
                            )}
                          </td>
                          <td>{b.total_break_time}</td>
                          <td>{b.total_break_time_today}</td>
                          <td className={isLast && b.exceed_today ? styles.cellExceed : undefined}>
                            {isLast ? b.exceed_today || "—" : "—"}
                          </td>
                        </tr>
                      );
                    });
                  })()
                )}
              </tbody>
            </table>
              )}
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
            <div className={styles.breakSummaryTableWrapper}>
              {loadingPrayer ? loadingBox : (
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
                {prayerRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className={styles.breakSummaryNoRecords}>No records found.</td>
                  </tr>
                ) : (
                  (() => {
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
                          <td className={styles.cellMuted}>{employeeId}</td>
                          <td className={styles.nameCol}>
                            <EmployeeTableNameCell
                              name={employeeName}
                              employeeId={employeeId}
                              photo={getPhoto(employeeId)}
                              onOpen={() => openBreakDetail(p)}
                            />
                          </td>
                          <td>{displayPseudonym(p)}</td>
                          <td>{p.department_name || employeeDepartment || "—"}</td>
                          <td>{p.date_display}</td>
                          <td>{p.prayer_start_display}</td>
                          <td>
                            {p.isRunning ? (
                              <span className={styles.badgeRunning}>Running</span>
                            ) : (
                              p.prayer_end_display
                            )}
                          </td>
                          <td>{p.total_prayer_time}</td>
                          <td>{p.total_prayer_time_today}</td>
                          <td className={isLast && p.exceed_today ? styles.cellExceed : undefined}>
                            {isLast ? p.exceed_today || "—" : "—"}
                          </td>
                        </tr>
                      );
                    });
                  })()
                )}
              </tbody>
            </table>
              )}
          </div>
        </div>
        )}

        {activeTab === "attendance" && (
          <div className={styles.breakSummaryContainer} style={{ width: "100%" }}>
            <div className={styles.breakSummaryFilters}>
              <input
                type="date"
                value={attFromDate}
                onChange={e => setAttFromDate(e.target.value)}
                className={styles.breakSummaryDate}
                placeholder="From Date"
              />
              <input
                type="date"
                value={attToDate}
                onChange={e => setAttToDate(e.target.value)}
                className={styles.breakSummaryDate}
                placeholder="To Date"
              />
              <button onClick={downloadAttendanceCSV} className={styles.breakSummaryXLSButton} title="Download XLS">
                <FaFileExcel size={20} />
                <span>Export XLS</span>
              </button>
            </div>
            <div className={styles.breakSummaryTableWrapper}>
              {loadingAttendance ? loadingBox : (
              <table className={styles.breakSummaryTable}>
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
                    <td colSpan={9} className={styles.breakSummaryNoRecords}>No records found.</td>
                  </tr>
                ) : (
                  attendance.map((a, idx) => {
                    const rowKey = a.id ?? `${a.employee_id}-${a.clock_in}`;
                    const isOpen = Boolean(a.clock_in && !a.clock_out);
                    const totalHours = isOpen
                      ? formatTotalHours(a.clock_in, "", now)
                      : closedAttendanceHours.get(rowKey) || formatTotalHours(a.clock_in, a.clock_out);
                    return (
                      <tr key={a.id || idx}>
                        <td className={styles.cellMuted}>{a.employee_id || employeeId}</td>
                        <td className={styles.nameCol}>
                          <EmployeeTableNameCell
                            name={employeeName}
                            employeeId={employeeId}
                            photo={getPhoto(employeeId)}
                            onOpen={() => openBreakDetail(a)}
                          />
                        </td>
                        <td>{displayPseudonym(a)}</td>
                        <td>{a.department_name || employeeDepartment || "—"}</td>
                        <td>{formatDateOnly(a.clock_in || a.clock_out || a.date)}</td>
                        <td>{a.clock_in ? getTimeStringInTimeZone(a.clock_in, SERVER_TIMEZONE) : ""}</td>
                        <td>
                          {a.clock_out ? (
                            <>
                              {getTimeStringInTimeZone(a.clock_out, SERVER_TIMEZONE)}
                              {isAutoClockOutRecord(a.auto_clock_out) ? <AutoClockOutBadge /> : null}
                            </>
                          ) : (
                            <span className={styles.badgeRunning}>Running</span>
                          )}
                        </td>
                        <td>{totalHours}</td>
                        <td className={a.is_late ? styles.cellExceed : undefined} style={a.is_late ? undefined : { color: "#007a5a", fontWeight: 600 }}>
                          {a.is_late ? `Late ${formatLateTime(a.late_minutes || 0)}` : "On Time"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
              )}
          </div>
        </div>
        )}
      </div>
      {detail ? <EmployeeDetailPopup data={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
