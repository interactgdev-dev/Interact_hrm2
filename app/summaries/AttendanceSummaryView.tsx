"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styles from "../break-summary/break-summary.module.css";
import { EmployeeTableNameCell } from "../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../components/use-employee-detail-popup";
import { FaFileExcel } from "react-icons/fa";
import { compareAttendanceRows } from "../../lib/attendance-sort";
import {
  filterImportedRows,
  loadImportedAttendanceSummarySnapshot,
  parseAttendanceSummaryWorkbook,
  saveImportedAttendanceSummarySnapshot,
  type ImportedAttendanceSummarySnapshot,
} from "../../lib/attendance-summary-import";
import { getDateStringInTimeZone, getParts, getTimeStringInTimeZone, SERVER_TIMEZONE } from "../../lib/timezone";
import { AutoClockOutBadge } from "../components/AutoClockOutBadge";
import { isAutoClockOutRecord } from "../../lib/attendance-auto-clock-out";
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function formatDateOnly(dateValue: string | null | undefined) {
  if (!dateValue) return "";
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.exec(dateValue);
  if (dateOnlyMatch) return dateValue;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return getDateStringInTimeZone(parsed, SERVER_TIMEZONE);
}

function formatTotalHours(clockIn: string, clockOut: string, currentTime?: number) {
  if (!clockIn) return "00h 00m 00s";
  const clockInParts = getParts(clockIn, SERVER_TIMEZONE);
  if (!clockInParts) return "00h 00m 00s";
  const start = new Date(
    Date.UTC(
      clockInParts.year,
      clockInParts.month - 1,
      clockInParts.day,
      clockInParts.hour,
      clockInParts.minute,
      clockInParts.second
    )
  ).getTime();

  let end = currentTime || Date.now();
  if (clockOut) {
    const clockOutParts = getParts(clockOut, SERVER_TIMEZONE);
    if (!clockOutParts) return "00h 00m 00s";
    end = new Date(
      Date.UTC(
        clockOutParts.year,
        clockOutParts.month - 1,
        clockOutParts.day,
        clockOutParts.hour,
        clockOutParts.minute,
        clockOutParts.second
      )
    ).getTime();
  } else {
    const nowParts = getParts(new Date(end), SERVER_TIMEZONE);
    if (!nowParts) return "00h 00m 00s";
    end = new Date(
      Date.UTC(
        nowParts.year,
        nowParts.month - 1,
        nowParts.day,
        nowParts.hour,
        nowParts.minute,
        nowParts.second
      )
    ).getTime();
  }
  const totalSeconds = Math.floor((end - start) / 1000);
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

function formatLateTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function AttendanceSummaryView() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [department, setDepartment] = useState("");
  /** Default: current day only — expand range when user picks dates */
  const today = getLocalDateString();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [importedSnapshot, setImportedSnapshot] = useState<ImportedAttendanceSummarySnapshot | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const filterMonth = fromDate.slice(0, 7);
  const showingImported = Boolean(
    importedSnapshot?.month === filterMonth &&
      importedSnapshot.month === toDate.slice(0, 7) &&
      importedSnapshot.rows.length,
  );

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setDepartments(data.departments || []);
      })
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    setImportedSnapshot(loadImportedAttendanceSummarySnapshot(filterMonth));
  }, [filterMonth]);

  useEffect(() => {
    if (showingImported) return;
    const effectiveFrom = fromDate || toDate || today;
    const effectiveTo = toDate || fromDate || today;
    const params = new URLSearchParams({
      fromDate: effectiveFrom,
      toDate: effectiveTo,
      summary: "1",
    });
    setLoading(true);
    fetch(`/api/attendance?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setAttendance(data.attendance || []);
        else setAttendance([]);
      })
      .catch(() => setAttendance([]))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, showingImported, today]);

  useEffect(() => {
    const hasOpen = attendance.some((a) => a.clock_in && !a.clock_out);
    if (!hasOpen) return;
    // 5s is enough for live hours; 1s was re-rendering the whole table every tick
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [attendance]);

  const filteredLive = useMemo(() => {
    if (showingImported) return [];
    const term = deferredSearch.trim().toLowerCase();
    return attendance
      .filter((a) => {
        if (term) {
          const employeeName = (a.employee_name || "").toLowerCase();
          const pseudonym = (a.pseudonym || "").toLowerCase();
          const id = String(a.employee_id || "");
          if (!employeeName.includes(term) && !pseudonym.includes(term) && !id.includes(term)) {
            return false;
          }
        }
        if (department && a.department_name !== department) return false;
        return true;
      })
      .sort(compareAttendanceRows);
  }, [attendance, deferredSearch, department, showingImported]);

  /** Closed sessions: total hours fixed (no live clock). */
  const closedDisplay = useMemo(() => {
    const map = new Map<string | number, string>();
    for (const a of filteredLive) {
      if (!a.clock_in || !a.clock_out) continue;
      const key = a.id ?? `${a.employee_id}-${a.clock_in}`;
      map.set(key, formatTotalHours(a.clock_in, a.clock_out));
    }
    return map;
  }, [filteredLive]);

  const rows = useMemo(() => {
    if (showingImported && importedSnapshot) {
      return filterImportedRows(importedSnapshot, fromDate, toDate, deferredSearch, department);
    }
    return filteredLive;
  }, [
    showingImported,
    importedSnapshot,
    fromDate,
    toDate,
    deferredSearch,
    department,
    filteredLive,
  ]);

  const downloadAttendanceCSV = () => {
    const headers = ["Id", "Full Name", "P.Name", "Department", "Date", "Clock In", "Clock Out", "Total Hours", "Late"];
    let csv = headers.join(",") + "\n";
    rows.forEach((row: any) => {
      if (showingImported) {
        csv += [
          row.employeeId,
          row.employeeName,
          row.pseudonym,
          row.departmentName,
          row.dateDisplay,
          row.clockIn,
          row.clockOut,
          row.totalHours,
          row.late,
        ]
          .map((v) => `"${v}"`)
          .join(",") + "\n";
        return;
      }
      const date = row.date ? getDateStringInTimeZone(row.date, SERVER_TIMEZONE) : "";
      const clockIn = row.clock_in ? getTimeStringInTimeZone(row.clock_in, SERVER_TIMEZONE) : "";
      const clockOut = row.clock_out ? getTimeStringInTimeZone(row.clock_out, SERVER_TIMEZONE) : "";
      const key = row.id ?? `${row.employee_id}-${row.clock_in}`;
      const totalHours =
        row.clock_in && !row.clock_out
          ? formatTotalHours(row.clock_in, "", now)
          : closedDisplay.get(key) || formatTotalHours(row.clock_in, row.clock_out, now);
      const late = row.is_late ? `Late ${formatLateTime(row.late_minutes || 0)}` : "On Time";
      csv += [
        row.employee_id,
        row.employee_name || "",
        row.pseudonym || "-",
        row.department_name || "-",
        date,
        clockIn,
        clockOut,
        totalHours,
        late,
      ]
        .map((v) => `"${v}"`)
        .join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "attendance_summary.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const snapshot = parseAttendanceSummaryWorkbook(buffer);
      if (!snapshot.rows.length) {
        toastInfo("No rows found. Use attendance summary format (Id, Full Name, Date, Clock In, Clock Out, etc.).");
        return;
      }
      if (!snapshot.month) {
        toastError("Could not detect month from file dates.");
        return;
      }
      saveImportedAttendanceSummarySnapshot(snapshot);
      setImportedSnapshot(snapshot);
      setFromDate(snapshot.fromDate);
      setToDate(snapshot.toDate);
      toastSuccess(`Loaded ${snapshot.rows.length} rows for ${snapshot.month}. Date filter set to imported range.`);
    } catch (err) {
      toastError(String(err));
    } finally {
      e.target.value = "";
    }
  };

  return (
    <>
      <div className={styles.breakSummaryContainer}>
        <h1 className={styles.pageTitle}>Attendance Summary</h1>
        {showingImported && (
          <p style={{ color: "#611f69", fontSize: "0.85rem", marginBottom: 12, fontWeight: 600 }}>
            Showing imported Excel data for {filterMonth} (sheet values as-is)
          </p>
        )}
        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name or pseudo name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 220 }}
          />
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className={styles.breakSummaryDate} style={{ width: 200 }}>
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
          <button onClick={downloadAttendanceCSV} className={styles.breakSummaryXLSButton} title="Download XLS">
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
          {loading && !showingImported ? (
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
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Total Hours</th>
                <th>Late</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className={styles.breakSummaryNoRecords}>No records found.</td>
                </tr>
              ) : (
                rows.map((a: any, idx) => {
                  if (showingImported) {
                    const isRunning =
                      !a.clockOut ||
                      a.clockOut.toLowerCase() === "running..." ||
                      a.clockOut.toLowerCase() === "running";
                    return (
                      <tr key={a.id || idx}>
                        <td className={styles.cellMuted}>{a.employeeId}</td>
                        <td>
                          <EmployeeTableNameCell
                            name={a.employeeName || ""}
                            employeeId={a.employeeId}
                            photo={getPhoto(a.employeeId)}
                            onOpen={() =>
                              openFromRow({
                                employee_id: a.employeeId,
                                employee_name: a.employeeName,
                                pseudonym: a.pseudonym,
                                department_name: a.departmentName,
                              })
                            }
                          />
                        </td>
                        <td>{a.pseudonym}</td>
                        <td>{a.departmentName}</td>
                        <td>{a.dateDisplay}</td>
                        <td>{a.clockIn}</td>
                        <td>
                          {isRunning ? (
                            <span style={{ color: "#e67e22", fontWeight: 600 }}>Running...</span>
                          ) : (
                            a.clockOut
                          )}
                        </td>
                        <td>{a.totalHours}</td>
                        <td
                          style={{
                            color: a.lateIsNegative ? "#e74c3c" : "#27ae60",
                            fontWeight: 600,
                          }}
                        >
                          {a.late}
                        </td>
                      </tr>
                    );
                  }
                  const rowKey = a.id ?? `${a.employee_id}-${a.clock_in}`;
                  const isOpen = Boolean(a.clock_in && !a.clock_out);
                  const totalHours = isOpen
                    ? formatTotalHours(a.clock_in, "", now)
                    : closedDisplay.get(rowKey) || formatTotalHours(a.clock_in, a.clock_out);
                  return (
                    <tr key={a.id || idx}>
                      <td className={styles.cellMuted}>{a.employee_id}</td>
                      <td>
                        <EmployeeTableNameCell
                          name={a.employee_name || ""}
                          employeeId={a.employee_id}
                          photo={getPhoto(a.employee_id)}
                          onOpen={() => openFromRow(a)}
                        />
                      </td>
                      <td>{a.pseudonym || "-"}</td>
                      <td>{a.department_name || "-"}</td>
                      <td>{formatDateOnly(a.clock_in || a.clock_out || a.date)}</td>
                      <td>{a.clock_in ? getTimeStringInTimeZone(a.clock_in, SERVER_TIMEZONE) : ""}</td>
                      <td>
                        {a.clock_out ? (
                          <>
                            {getTimeStringInTimeZone(a.clock_out, SERVER_TIMEZONE)}
                            {isAutoClockOutRecord(a.auto_clock_out) ? <AutoClockOutBadge /> : null}
                          </>
                        ) : (
                          <span style={{ color: "#e67e22", fontWeight: 600 }}>Running...</span>
                        )}
                      </td>
                      <td>{totalHours}</td>
                      <td style={{ color: a.is_late ? "#e74c3c" : "#27ae60", fontWeight: 600 }}>
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
      {popup}
    </>
  );
}
