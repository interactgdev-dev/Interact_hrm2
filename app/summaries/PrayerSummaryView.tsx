"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styles from "../break-summary/break-summary.module.css";
import leaveStyles from "../leave/leave.module.css";
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
import {
  filterDepartmentsByScope,
  rowAllowedByScope,
  useViewerDataScope,
} from "@/lib/access-control/use-viewer-scope";
import {
  breakSessionDate,
  filterRowsByClockInSessionDate,
  overnightFetchRange,
} from "@/lib/break-session-date";
import {
  buildAllowanceSecondsByEmployeeSession,
  exceedSecondsOverAllowance,
  resolveAllowanceSeconds,
} from "@/lib/break-prayer-allowance";
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
  const viewerScope = useViewerDataScope();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [department, setDepartment] = useState("");
  /** Default: current day only — expand range when user picks dates */
  const today = getLocalDateString();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [prayerBreaks, setPrayerBreaks] = useState<any[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const importInputRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<EmployeeDetailPayload | null>(null);
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { getPhoto } = useEmployeePhotoMap();

  const onSort = (column: string) => {
    const next = nextSortState(sortKey, sortDir, column);
    setSortKey(next.key);
    setSortDir(next.dir);
  };

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
    const effectiveFrom = fromDate || toDate || today;
    const effectiveTo = toDate || fromDate || today;
    // ±1 day so overnight clock-in sessions (pre + post midnight) load together
    const range = overnightFetchRange(effectiveFrom, effectiveTo);
    const params = new URLSearchParams({
      fromDate: range.fromDate,
      toDate: range.toDate,
    });
    setLoading(true);
    Promise.all([
      fetch(`/api/prayer_breaks?${params.toString()}`, { cache: "no-store" }).then(
        (r) => r.json(),
      ),
      fetch(`/api/attendance?${params.toString()}&summary=1`, {
        cache: "no-store",
      }).then((r) => r.json()),
    ])
      .then(([prayerData, attData]) => {
        setPrayerBreaks(
          prayerData.success ? prayerData.prayer_breaks || [] : [],
        );
        setAttendanceRows(
          attData.success && Array.isArray(attData.attendance)
            ? attData.attendance
            : [],
        );
      })
      .catch(() => {
        setPrayerBreaks([]);
        setAttendanceRows([]);
      })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, today]);

  useEffect(() => {
    const hasRunning = prayerBreaks.some((p) => p.prayer_break_start && !p.prayer_break_end);
    if (!hasRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [prayerBreaks]);

  const filteredPrayerBreaks = useMemo(() => {
    const effectiveFrom = fromDate || toDate || today;
    const effectiveTo = toDate || fromDate || today;
    const scoped = prayerBreaks.filter((p) => {
      if (!rowAllowedByScope(viewerScope, p.employee_id, p.department_name)) {
        return false;
      }
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
    // Attribute to clock-in session date (overnight: keep pre-midnight totals)
    return filterRowsByClockInSessionDate(scoped, effectiveFrom, effectiveTo);
  }, [prayerBreaks, deferredSearch, department, viewerScope, fromDate, toDate, today]);

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

  const prayerAllowanceMap = useMemo(
    () => buildAllowanceSecondsByEmployeeSession(attendanceRows, "prayer"),
    [attendanceRows],
  );

  const rows = useMemo(() => {
    const liveTotals = new Map(staticTotals);
    for (const p of filteredPrayerBreaks) {
      if (!p.prayer_break_start || p.prayer_break_end) continue;
      const start = new Date(p.prayer_break_start).getTime();
      const seconds = Math.floor((now - start) / 1000);
      const key = getSessionGroupingKey(p);
      liveTotals.set(key, (liveTotals.get(key) || 0) + Math.max(0, seconds));
    }

    const mapped = filteredPrayerBreaks.map((p) => {
      const isRunning = p.prayer_break_start && !p.prayer_break_end;
      const start = p.prayer_break_start ? new Date(p.prayer_break_start).getTime() : 0;
      const end = p.prayer_break_end ? new Date(p.prayer_break_end).getTime() : now;
      const sessionSeconds = p.prayer_break_start ? Math.floor((end - start) / 1000) : 0;
      const key = getSessionGroupingKey(p);
      const dailySeconds = liveTotals.get(key) || sessionSeconds;
      const sessionDate = breakSessionDate(p);
      const allowance = resolveAllowanceSeconds(prayerAllowanceMap, {
        employeeId: p.employee_id,
        sessionDate,
        attendanceSessionId: p.attendance_session_id,
        kind: "prayer",
      });
      const exceedToday = exceedSecondsOverAllowance(dailySeconds, allowance);
      return {
        ...p,
        date_display: sessionDate,
        prayer_start_display: p.prayer_break_start
          ? getTimeStringInTimeZone(p.prayer_break_start, SERVER_TIMEZONE)
          : "",
        prayer_end_display: p.prayer_break_end
          ? getTimeStringInTimeZone(p.prayer_break_end, SERVER_TIMEZONE)
          : isRunning
          ? "Running..."
          : "",
        total_prayer_time: formatDuration(sessionSeconds),
        total_prayer_time_today: formatDuration(dailySeconds),
        exceed_today: exceedToday > 0 ? formatDuration(exceedToday) : "",
      };
    });

    if (!sortKey) {
      return mapped.sort(
        (a, b) =>
          new Date(b.prayer_break_start || 0).getTime() -
          new Date(a.prayer_break_start || 0).getTime(),
      );
    }

    return mapped.sort((a, b) => {
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
          return cmpText(a.date_display, b.date_display, sortDir);
        case "start":
          return cmpText(a.prayer_break_start, b.prayer_break_start, sortDir);
        case "end":
          return cmpText(a.prayer_end_display, b.prayer_end_display, sortDir);
        case "session":
          return cmpText(a.total_prayer_time, b.total_prayer_time, sortDir);
        case "total":
          return cmpText(a.total_prayer_time_today, b.total_prayer_time_today, sortDir);
        case "exceed":
          return cmpText(a.exceed_today, b.exceed_today, sortDir);
        default:
          return 0;
      }
    });
  }, [filteredPrayerBreaks, staticTotals, now, prayerAllowanceMap, sortKey, sortDir]);

  const totalCount = rows.length;
  const runningOnPrayer = useMemo(() => {
    const ids = new Set<string>();
    for (const p of rows) {
      if (p.prayer_break_start && !p.prayer_break_end) {
        ids.add(String(p.employee_id ?? p.id ?? ""));
      }
    }
    ids.delete("");
    return ids.size;
  }, [rows]);

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
        const range = overnightFetchRange(effectiveFrom, effectiveTo);
        const params = new URLSearchParams({
          fromDate: range.fromDate,
          toDate: range.toDate,
        });
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
              onClick={downloadPrayerCSV}
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

        <div className={styles.summaryStatRow}>
          <div className={styles.summaryStatCard}>
            <p className={styles.summaryStatLabel}>Total</p>
            <p className={styles.summaryStatValue}>{totalCount}</p>
            <p className={styles.summaryStatSub}>records in view</p>
          </div>
          <div className={`${styles.summaryStatCard} ${styles.summaryStatCardRunning}`}>
            <p className={styles.summaryStatLabel}>On prayer</p>
            <p className={styles.summaryStatValue}>{runningOnPrayer}</p>
            <p className={styles.summaryStatSub}>running now</p>
          </div>
        </div>

        <div className={leaveStyles.reqTableShell}>
          <div className={leaveStyles.reqTableScroll}>
            {loading ? (
              <div className={leaveStyles.loading}>Loading prayer breaks…</div>
            ) : (
              <table className={`${leaveStyles.reqTable} ${styles.breakSumTableFit}`}>
                <thead>
                  <tr>
                    <SortableTh label="ID" column="id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Full Name" column="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="P.Name" column="pname" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Department" column="dept" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Date" column="date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Prayer Start" column="start" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Prayer End" column="end" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Total Prayer Time" column="session" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Total Prayer" column="total" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="Exceed" column="exceed" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className={leaveStyles.reqEmpty}>
                        No records found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((p, idx) => (
                      <tr key={p.id || idx}>
                        <td className={leaveStyles.reqId}>{p.employee_id}</td>
                        <td>
                          <EmployeeTableNameCell
                            key={`${p.employee_id}-${getPhoto(p.employee_id) ?? "none"}`}
                            name={p.employee_name || ""}
                            employeeId={p.employee_id}
                            photo={getPhoto(p.employee_id)}
                            onOpen={() => openEmployeeDetail(p)}
                          />
                        </td>
                        <td>{p.pseudonym || "—"}</td>
                        <td>{p.department_name || "—"}</td>
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
                        <td className={p.exceed_today ? styles.cellExceed : undefined}>
                          {p.exceed_today || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {detail ? <EmployeeDetailPopup data={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}
