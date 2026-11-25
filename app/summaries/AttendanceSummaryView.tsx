"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styles from "../break-summary/break-summary.module.css";
import leaveStyles from "../leave/leave.module.css";
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
import {
  filterDepartmentsByScope,
  rowAllowedByScope,
  useViewerDataScope,
} from "@/lib/access-control/use-viewer-scope";
import {
  attendanceSessionDate,
  filterAttendanceByClockInSessionDate,
  overnightFetchRange,
} from "@/lib/break-session-date";
import {
  SortableTh,
  nextSortState,
  cmpText,
  cmpNum,
  type SortDir,
} from "../admin/manage-leaves/SortableTh";

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
  const viewerScope = useViewerDataScope();
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
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const importInputRef = useRef<HTMLInputElement>(null);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const onSort = (column: string) => {
    const next = nextSortState(sortKey, sortDir, column);
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const filterMonth = fromDate.slice(0, 7);
  const showingImported = Boolean(
    importedSnapshot?.month === filterMonth &&
      importedSnapshot.month === toDate.slice(0, 7) &&
      importedSnapshot.rows.length,
  );

  const scopedDepartments = useMemo(
    () => filterDepartmentsByScope(departments, viewerScope),
    [departments, viewerScope],
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
    if (viewerScope.mode === "all") return;
    if (
      department &&
      !scopedDepartments.some((d: any) => d.name === department)
    ) {
      setDepartment("");
    }
  }, [viewerScope.mode, scopedDepartments, department]);

  useEffect(() => {
    setImportedSnapshot(loadImportedAttendanceSummarySnapshot(filterMonth));
  }, [filterMonth]);

  useEffect(() => {
    if (showingImported) return;
    const effectiveFrom = fromDate || toDate || today;
    const effectiveTo = toDate || fromDate || today;
    // ±1 day fetch window; client keeps rows by clock-in date only (no next-day spill).
    const range = overnightFetchRange(effectiveFrom, effectiveTo);
    const params = new URLSearchParams({
      fromDate: range.fromDate,
      toDate: range.toDate,
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
    const effectiveFrom = fromDate || toDate || today;
    const effectiveTo = toDate || fromDate || today;
    const term = deferredSearch.trim().toLowerCase();
    const scoped = attendance.filter((a) => {
      if (!rowAllowedByScope(viewerScope, a.employee_id, a.department_name)) {
        return false;
      }
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
    });
    // Attribute entirely to clock-in session date (overnight stays on start day).
    return filterAttendanceByClockInSessionDate(scoped, effectiveFrom, effectiveTo).sort(
      compareAttendanceRows,
    );
  }, [attendance, deferredSearch, department, showingImported, viewerScope, fromDate, toDate, today]);

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
    const base =
      showingImported && importedSnapshot
        ? filterImportedRows(importedSnapshot, fromDate, toDate, deferredSearch, department)
        : filteredLive;
    if (!sortKey) return base;
    const sorted = [...base];
    sorted.sort((a: any, b: any) => {
      if (showingImported) {
        switch (sortKey) {
          case "id":
            return cmpNum(a.employeeId, b.employeeId, sortDir);
          case "name":
            return cmpText(a.employeeName, b.employeeName, sortDir);
          case "pname":
            return cmpText(a.pseudonym, b.pseudonym, sortDir);
          case "dept":
            return cmpText(a.departmentName, b.departmentName, sortDir);
          case "date":
            return cmpText(a.dateDisplay, b.dateDisplay, sortDir);
          case "clockIn":
            return cmpText(a.clockIn, b.clockIn, sortDir);
          case "clockOut":
            return cmpText(a.clockOut, b.clockOut, sortDir);
          case "hours":
            return cmpText(a.totalHours, b.totalHours, sortDir);
          case "late":
            return cmpText(a.late, b.late, sortDir);
          default:
            return 0;
        }
      }
      switch (sortKey) {
        case "id":
          return cmpNum(a.employee_id, b.employee_id, sortDir);
        case "name":
          return cmpText(a.employee_name, b.employee_name, sortDir);
        case "pname":
          return cmpText(a.pseudonym, b.pseudonym, sortDir);
        case "dept":
          return cmpText(a.department_name, b.department_name, sortDir);
        case "date":
          return cmpText(
            attendanceSessionDate(a) || formatDateOnly(a.clock_in || a.clock_out || a.date),
            attendanceSessionDate(b) || formatDateOnly(b.clock_in || b.clock_out || b.date),
            sortDir,
          );
        case "clockIn":
          return cmpText(a.clock_in, b.clock_in, sortDir);
        case "clockOut":
          return cmpText(a.clock_out || "Running...", b.clock_out || "Running...", sortDir);
        case "hours": {
          const keyA = a.id ?? `${a.employee_id}-${a.clock_in}`;
          const keyB = b.id ?? `${b.employee_id}-${b.clock_in}`;
          const hoursA =
            a.clock_in && !a.clock_out
              ? formatTotalHours(a.clock_in, "", now)
              : closedDisplay.get(keyA) || formatTotalHours(a.clock_in, a.clock_out);
          const hoursB =
            b.clock_in && !b.clock_out
              ? formatTotalHours(b.clock_in, "", now)
              : closedDisplay.get(keyB) || formatTotalHours(b.clock_in, b.clock_out);
          return cmpText(hoursA, hoursB, sortDir);
        }
        case "late": {
          const lateA = a.is_late ? `Late ${formatLateTime(a.late_minutes || 0)}` : "On Time";
          const lateB = b.is_late ? `Late ${formatLateTime(b.late_minutes || 0)}` : "On Time";
          return cmpText(lateA, lateB, sortDir);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [
    showingImported,
    importedSnapshot,
    fromDate,
    toDate,
    deferredSearch,
    department,
    filteredLive,
    sortKey,
    sortDir,
    closedDisplay,
    now,
  ]);

  const runningClockedIn = useMemo(() => {
    const ids = new Set<string>();
    for (const a of rows) {
      if (showingImported) {
        const out = String(a.clockOut || "").toLowerCase();
        if (!a.clockOut || out === "running..." || out === "running") {
          ids.add(String(a.employeeId ?? a.id ?? ""));
        }
      } else if (a.clock_in && !a.clock_out) {
        ids.add(String(a.employee_id ?? a.id ?? ""));
      }
    }
    ids.delete("");
    return ids.size;
  }, [rows, showingImported]);

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
      const date = attendanceSessionDate(row) || (row.date ? getDateStringInTimeZone(row.date, SERVER_TIMEZONE) : "");
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
        <div className={styles.pageTitleRow}>
          <h1 className={styles.pageTitle}>Attendance Summary</h1>
          <p className={styles.pageTitleMeta}>
            Total Clocked In: <span className={styles.pageTitleMetaStrong}>{runningClockedIn}</span>
          </p>
        </div>
        {showingImported && (
          <p className={leaveStyles.subtitle} style={{ color: "#611f69", fontWeight: 600, marginBottom: 12 }}>
            Showing imported Excel data for {filterMonth} (sheet values as-is)
          </p>
        )}
        <div className={leaveStyles.toolbar}>
          <div className={leaveStyles.searchWrap}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className={leaveStyles.toolbarSearch}
              placeholder="Search by name or pseudo name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={leaveStyles.toolbarSelect}
            aria-label="Filter by department"
          >
            <option value="">
              {viewerScope.mode === "all" ? "All Departments" : "All (your departments)"}
            </option>
            {scopedDepartments.map((dept: any) => (
              <option key={dept.id} value={dept.name}>
                {dept.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={leaveStyles.toolbarSelect}
            aria-label="From date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={leaveStyles.toolbarSelect}
            aria-label="To date"
          />
          <div className={leaveStyles.toolbarActions}>
            <button
              type="button"
              onClick={downloadAttendanceCSV}
              className={styles.breakSummaryXLSButton}
              title="Download XLS"
            >
              <FaFileExcel size={14} />
              <span>Export XLS</span>
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              className={`${styles.breakSummaryXLSButton} ${styles.breakSummaryXLSButtonSecondary}`}
              title="Import XLS"
            >
              <FaFileExcel size={14} />
              <span>Import XLS</span>
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
        </div>

        <div className={leaveStyles.reqTableShell}>
          <div className={`${leaveStyles.reqTableScroll} ${styles.attTableScroll}`}>
            {loading && !showingImported ? (
              <div className={leaveStyles.loading}>Loading attendance…</div>
            ) : (
              <table className={`${leaveStyles.reqTable} ${styles.attTableFit}`}>
                <thead>
                  <tr>
                    <SortableTh label="ID" column="id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Full Name" column="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="P.Name" column="pname" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Department" column="dept" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Date" column="date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Clock In" column="clockIn" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Clock Out" column="clockOut" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Total Hours" column="hours" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Late" column="late" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={leaveStyles.reqEmpty}>
                        No records found.
                      </td>
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
                            <td className={leaveStyles.reqId}>{a.employeeId}</td>
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
                            <td title={a.pseudonym || ""}>{a.pseudonym || "—"}</td>
                            <td title={a.departmentName || ""}>{a.departmentName || "—"}</td>
                            <td>{a.dateDisplay}</td>
                            <td>{a.clockIn}</td>
                            <td>
                              {isRunning ? (
                                <span className={styles.attRunning}>Running...</span>
                              ) : (
                                a.clockOut
                              )}
                            </td>
                            <td>{a.totalHours}</td>
                            <td className={a.lateIsNegative ? styles.attLate : styles.attOnTime}>
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
                          <td className={leaveStyles.reqId}>{a.employee_id}</td>
                          <td>
                            <EmployeeTableNameCell
                              name={a.employee_name || ""}
                              employeeId={a.employee_id}
                              photo={getPhoto(a.employee_id)}
                              onOpen={() => openFromRow(a)}
                            />
                          </td>
                          <td title={a.pseudonym || ""}>{a.pseudonym || "—"}</td>
                          <td title={a.department_name || ""}>{a.department_name || "—"}</td>
                          <td>
                            {attendanceSessionDate(a) ||
                              formatDateOnly(a.clock_in || a.clock_out || a.date)}
                          </td>
                          <td>
                            {a.clock_in
                              ? getTimeStringInTimeZone(a.clock_in, SERVER_TIMEZONE)
                              : ""}
                          </td>
                          <td>
                            {a.clock_out ? (
                              <>
                                {getTimeStringInTimeZone(a.clock_out, SERVER_TIMEZONE)}
                                {isAutoClockOutRecord(a.auto_clock_out) ? (
                                  <AutoClockOutBadge />
                                ) : null}
                              </>
                            ) : (
                              <span className={styles.attRunning}>Running...</span>
                            )}
                          </td>
                          <td>{totalHours}</td>
                          <td className={a.is_late ? styles.attLate : styles.attOnTime}>
                            {a.is_late
                              ? `Late ${formatLateTime(a.late_minutes || 0)}`
                              : "On Time"}
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
      </div>
      {popup}
    </>
  );
}
