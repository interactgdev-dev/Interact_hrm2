"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import tableStyles from "../../break-summary/break-summary.module.css";
import adminStyles from "../../admin/admin-page.module.css";
import reportStyles from "./employee-report.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import {
  formatDateOnly,
  monthRangeFromMonth,
  monthStartFromDate,
} from "@/lib/attendance-display";
import {
  downloadEmployeeReportExcel,
  type EmployeeReportExcelRow,
} from "@/lib/employee-report-excel";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "@/lib/timezone";
import { FaFileExcel } from "react-icons/fa";
import { toastInfo } from "@/lib/app-toast";
import {
  buildPinProfilesFromRows,
  hrmMapFromEmployees,
  profileMapsFromApi,
  resolveZkIdentity,
} from "@/lib/zkbio-employee-resolve";
import { pairTungstenWithSessions } from "@/lib/tungsten-punch-pairing";
import { parseAttendanceDateTimeMs } from "@/lib/shift-timing";

type ReportRow = {
  source: "H" | "T";
  sortAt: string;
  date: string;
  time: string;
  employeeName: string;
  department: string;
  detail: string;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
};

type AttendanceRow = {
  employee_name?: string;
  department_name?: string;
  clock_in?: string | null;
  clock_out?: string | null;
  date?: string;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
};

type ReportTableRow = {
  key: string;
  date: string;
  employeeName: string;
  tungstenPunchIn: string;
  hrmClockIn: string;
  hrmClockOut: string;
  tungstenPunchOut: string;
  department: string;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
};
type ShiftAssignmentRow = {
  employeeName: string;
  startTime: string | null;
  endTime: string | null;
  assignedDate: string;
};

type FilterMode = "day" | "month";

type AppliedFilters = {
  name: string;
  dept: string;
  mode: FilterMode;
  date: string;
  month: string;
  fromDate: string;
  toDate: string;
};

function todayStr() {
  return getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
}

function currentMonthStr() {
  return todayStr().slice(0, 7);
}

function formatReportDate(dateStr: string) {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatMonthLabel(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  if (!y || !m) return monthStr;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function rowFromIso(
  source: "H" | "T",
  iso: string,
  employeeName: string,
  department: string,
  detail: string,
  shiftStartTime?: string | null,
  shiftEndTime?: string | null,
): ReportRow | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return {
    source,
    sortAt: at.toISOString(),
    date: getDateStringInTimeZone(at, SERVER_TIMEZONE),
    time: getTimeStringInTimeZone(at, SERVER_TIMEZONE),
    employeeName,
    department: department || "-",
    detail,
    shiftStartTime: shiftStartTime || null,
    shiftEndTime: shiftEndTime || null,
  };
}

function isDateInRange(dateKey: string, fromDate: string, toDate: string) {
  if (!dateKey) return false;
  return dateKey >= fromDate && dateKey <= toDate;
}

function rowInAppliedScope(eventDate: string, applied: AppliedFilters) {
  if (!eventDate) return false;
  if (applied.mode === "day") return eventDate === applied.date;
  return isDateInRange(eventDate, applied.fromDate, applied.toDate);
}

/** Include next/previous calendar day so overnight Tungsten punches pair with HRM sessions. */
function tungstenEventInScope(eventDate: string, applied: AppliedFilters) {
  if (!eventDate) return false;
  if (rowInAppliedScope(eventDate, applied)) return true;
  if (applied.mode !== "day") return false;
  return (
    eventDate === addDaysToDateKey(applied.date, 1) ||
    eventDate === addDaysToDateKey(applied.date, -1)
  );
}

/** Overnight shift: include row if clock-in, clock-out, or record date is in filter. */
function attendanceRecordInScope(a: AttendanceRow, applied: AppliedFilters): boolean {
  const recordDate = formatDateOnly(a.date);
  const cinDate = a.clock_in
    ? getDateStringInTimeZone(new Date(a.clock_in), SERVER_TIMEZONE)
    : recordDate;
  const coutDate = a.clock_out
    ? getDateStringInTimeZone(new Date(a.clock_out), SERVER_TIMEZONE)
    : null;
  if (rowInAppliedScope(recordDate, applied)) return true;
  if (rowInAppliedScope(cinDate, applied)) return true;
  if (coutDate && rowInAppliedScope(coutDate, applied)) return true;
  return false;
}

/** Match clock-out up to 24h after clock-in (next calendar day after midnight). */
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

function addDaysToDateKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function detectTungstenDirection(detail: string): "in" | "out" | null {
  const d = detail.toLowerCase();
  if (d.includes("out")) return "out";
  if (d.includes("in")) return "in";
  return null;
}

function parseShiftTimeToHms(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  return {
    h: Number(match[1]),
    m: Number(match[2]),
    s: Number(match[3] || "0"),
  };
}

function karachiDateTimeToEpoch(dateKey: string, timeValue: string) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const hms = parseShiftTimeToHms(timeValue);
  if (!y || !mo || !d || !hms) return null;
  // Asia/Karachi is UTC+05 without DST.
  return Date.UTC(y, mo - 1, d, hms.h - 5, hms.m, hms.s);
}

function pickNearestByTarget(
  events: { atMs: number; time: string }[],
  targetMs: number,
  maxDiffMs: number,
) {
  let best: { atMs: number; time: string } | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const e of events) {
    const diff = Math.abs(e.atMs - targetMs);
    if (diff < bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  if (!best || bestDiff > maxDiffMs) return null;
  return best;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getApplicableShift(
  employeeName: string,
  dateKey: string,
  assignmentsByName: Map<string, ShiftAssignmentRow[]>,
) {
  const list = assignmentsByName.get(normalizeName(employeeName)) || [];
  let best: ShiftAssignmentRow | null = null;
  for (const a of list) {
    if (!a.assignedDate || a.assignedDate > dateKey) continue;
    if (!best || a.assignedDate > best.assignedDate) best = a;
  }
  return best;
}

async function fetchAllZkRows(baseParams: URLSearchParams): Promise<{
  rows: Record<string, unknown>[];
  departments: string[];
}> {
  const all: Record<string, unknown>[] = [];
  const deptSet = new Set<string>();
  let page = 1;
  let total = 0;

  do {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(page));
    params.set("pageSize", "500");
    const res = await fetch(`/api/zkbio-punch-log?${params}`);
    const data = await res.json();
    if (!data.success) break;
    total = Number(data.total) || 0;
    const batch = (data.rows || []) as Record<string, unknown>[];
    all.push(...batch);
    if (Array.isArray(data.departments)) {
      data.departments.forEach((d: string) => deptSet.add(d));
    }
    if (batch.length === 0) break;
    page += 1;
  } while (all.length < total && page <= 100);

  return { rows: all, departments: [...deptSet] };
}

function buildApplied(
  mode: FilterMode,
  name: string,
  dept: string,
  date: string,
  month: string,
): AppliedFilters {
  if (mode === "month") {
    const { from, to } = monthRangeFromMonth(month);
    return { name, dept, mode, date: "", month, fromDate: from, toDate: to };
  }
  const monthStart = monthStartFromDate(date);
  return { name, dept, mode, date, month: "", fromDate: monthStart, toDate: date };
}

export default function EmployeeReportPage() {
  const initialToday = todayStr();
  const [filterMode, setFilterMode] = useState<FilterMode>("day");
  const [draftName, setDraftName] = useState("");
  const [draftDept, setDraftDept] = useState("");
  const [draftDate, setDraftDate] = useState(initialToday);
  const [draftMonth, setDraftMonth] = useState(currentMonthStr());
  const [applied, setApplied] = useState<AppliedFilters>(() =>
    buildApplied("day", "", "", initialToday, currentMonthStr()),
  );
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [hCount, setHCount] = useState(0);
  const [tCount, setTCount] = useState(0);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shiftAssignments, setShiftAssignments] = useState<ShiftAssignmentRow[]>([]);
  const [employeeIdByName, setEmployeeIdByName] = useState<Record<string, string>>({});
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const attFromDate =
        applied.mode === "day" ? addDaysToDateKey(applied.date, -1) : applied.fromDate;
      const attToDate =
        applied.mode === "day" ? addDaysToDateKey(applied.date, 1) : applied.toDate;
      const attParams = new URLSearchParams({
        fromDate: attFromDate,
        toDate: attToDate,
      });
      const zkParams = new URLSearchParams({
        dateFrom: applied.mode === "month" ? applied.fromDate : addDaysToDateKey(applied.date, -1),
        dateTo: addDaysToDateKey(applied.mode === "month" ? applied.toDate : applied.date, 1),
      });
      if (applied.name.trim()) zkParams.set("name", applied.name.trim());
      if (applied.dept) zkParams.set("dept", applied.dept);

      const [attRes, zkResult, pinProfRes, empListRes, shiftRes] = await Promise.all([
        fetch(`/api/attendance?${attParams}`),
        fetchAllZkRows(zkParams),
        fetch("/api/zkbio-pin-profiles"),
        fetch("/api/employee-list"),
        fetch("/api/shift-management"),
      ]);

      const attData = await attRes.json();
      const pinProfData = await pinProfRes.json();
      const empListData = await empListRes.json();
      const shiftData = await shiftRes.json();

      const batchPinProfiles = buildPinProfilesFromRows(zkResult.rows);
      const dbPinProfiles = pinProfData.success
        ? profileMapsFromApi(pinProfData.profiles || [])
        : new Map();
      const hrmByCode =
        empListData.success && empListData.employees
          ? hrmMapFromEmployees(empListData.employees)
          : new Map();
      const idByName: Record<string, string> = {};
      if (empListData.success && Array.isArray(empListData.employees)) {
        for (const emp of empListData.employees) {
          const name = `${String(emp.first_name || "").trim()} ${String(emp.last_name || "").trim()}`.trim();
          if (name && emp.id != null) {
            idByName[normalizeName(name)] = String(emp.id);
          }
        }
      }
      setEmployeeIdByName(idByName);
      if (shiftData.success && Array.isArray(shiftData.employees)) {
        const parsed: ShiftAssignmentRow[] = shiftData.employees
          .map((x: Record<string, unknown>) => {
            const employeeName = `${String(x.first_name || "").trim()} ${String(x.last_name || "").trim()}`.trim();
            const assignedDate = formatDateOnly(String(x.assigned_date || ""));
            return {
              employeeName,
              startTime: x.start_time ? String(x.start_time) : null,
              endTime: x.end_time ? String(x.end_time) : null,
              assignedDate,
            };
          })
          .filter((x: ShiftAssignmentRow) => x.employeeName && x.assignedDate);
        setShiftAssignments(parsed);
      } else {
        setShiftAssignments([]);
      }

      if (!attData.success && zkResult.rows.length === 0) {
        setError(attData.error || "Request failed");
        setRows([]);
        setHCount(0);
        setTCount(0);
        return;
      }

      const merged: ReportRow[] = [];
      const term = applied.name.trim().toLowerCase();

      const attendance: AttendanceRow[] = attData.success ? attData.attendance || [] : [];
      for (const a of attendance) {
        if (!attendanceRecordInScope(a, applied)) continue;

        const employeeName = (a.employee_name || "").trim() || "—";
        const department = a.department_name || "";

        if (term) {
          const n = employeeName.toLowerCase();
          if (!n.includes(term)) continue;
        }
        if (applied.dept && department !== applied.dept) continue;

        if (a.clock_in) {
          const r = rowFromIso(
            "H",
            a.clock_in,
            employeeName,
            department,
            "Clock In",
            a.shift_start_time,
            a.shift_end_time,
          );
          if (r) merged.push(r);
        }
        if (a.clock_out) {
          const r = rowFromIso(
            "H",
            a.clock_out,
            employeeName,
            department,
            "Clock Out",
            a.shift_start_time,
            a.shift_end_time,
          );
          if (r) merged.push(r);
        }
      }

      for (const z of zkResult.rows) {
        const { employeeName, department } = resolveZkIdentity(
          z,
          batchPinProfiles,
          dbPinProfiles,
          hrmByCode,
        );

        if (term) {
          const n = employeeName.toLowerCase();
          if (n === "—" || !n.includes(term)) continue;
        }
        if (applied.dept && department !== applied.dept) continue;

        const raw = z.event_time || z.imported_at;
        if (!raw) continue;
        const at = new Date(String(raw).includes("T") ? String(raw) : String(raw).replace(" ", "T"));
        if (Number.isNaN(at.getTime())) continue;
        const eventDate = getDateStringInTimeZone(at, SERVER_TIMEZONE);

        if (!tungstenEventInScope(eventDate, applied)) continue;

        const reader = String(z.reader_name || "").trim() || "-";
        const event = String(z.event_name || "").trim() || "Punch";
        merged.push({
          source: "T",
          sortAt: at.toISOString(),
          date: eventDate,
          time: getTimeStringInTimeZone(at, SERVER_TIMEZONE),
          employeeName,
          department: department || "-",
          detail: `${reader} — ${event}`,
        });
      }

      if (zkResult.departments.length) {
        setDepartments((prev) => {
          const names = [...prev, ...zkResult.departments];
          return [...new Set(names)].sort();
        });
      }

      merged.sort((a, b) => {
        const nameCmp = a.employeeName.localeCompare(b.employeeName, undefined, { sensitivity: "base" });
        if (nameCmp !== 0) return nameCmp;
        const dateCmp = a.date.localeCompare(b.date);
        if (dateCmp !== 0) return dateCmp;
        return a.sortAt.localeCompare(b.sortAt);
      });

      setRows(merged);
      setHCount(merged.filter((r) => r.source === "H").length);
      setTCount(merged.filter((r) => r.source === "T").length);
    } catch (e) {
      setError(String(e));
      setRows([]);
      setHCount(0);
      setTCount(0);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.departments?.length) {
          setDepartments((prev) => {
            const names = d.departments.map((x: { name: string }) => x.name).filter(Boolean);
            return [...new Set([...prev, ...names])].sort();
          });
        }
      })
      .catch(() => {});
  }, []);

  const applyFilters = () => {
    setApplied(buildApplied(filterMode, draftName, draftDept, draftDate, draftMonth));
  };

  const clearFilters = () => {
    const t = todayStr();
    const m = currentMonthStr();
    setFilterMode("day");
    setDraftName("");
    setDraftDept("");
    setDraftDate(t);
    setDraftMonth(m);
    setApplied(buildApplied("day", "", "", t, m));
    setRows([]);
    setHCount(0);
    setTCount(0);
    setError(null);
  };

  useEffect(() => {
    fetchReport();
  }, [applied, fetchReport]);

  const subtitle =
    applied.mode === "month"
      ? `${formatMonthLabel(applied.month)} (${applied.fromDate} → ${applied.toDate})`
      : formatReportDate(applied.date);

  const emptyMessage =
    applied.mode === "month"
      ? `No records for ${formatMonthLabel(applied.month)}`
      : `No records for ${formatReportDate(applied.date)}`;

  const tableRows = useMemo<ReportTableRow[]>(() => {
    const todayKey = todayStr();
    const nowMs = Date.now();
    const assignmentsByName = new Map<string, ShiftAssignmentRow[]>();
    for (const a of shiftAssignments) {
      const key = normalizeName(a.employeeName);
      const list = assignmentsByName.get(key) || [];
      list.push(a);
      assignmentsByName.set(key, list);
    }

    const byEmployee = new Map<
      string,
      {
        employeeName: string;
        department: string;
        hrmIns: ReportRow[];
        hrmOuts: ReportRow[];
        tungsten: { atMs: number; time: string; date: string }[];
      }
    >();

    for (const r of rows) {
      const key = normalizeName(r.employeeName);
      const bucket = byEmployee.get(key) || {
        employeeName: r.employeeName,
        department: r.department || "-",
        hrmIns: [],
        hrmOuts: [],
        tungsten: [],
      };
      if (r.source === "H") {
        if (r.detail === "Clock In") bucket.hrmIns.push(r);
        else bucket.hrmOuts.push(r);
      } else {
        const atMs = parseAttendanceDateTimeMs(r.sortAt);
        if (atMs != null) bucket.tungsten.push({ atMs, time: r.time, date: r.date });
      }
      byEmployee.set(key, bucket);
    }

    const result: ReportTableRow[] = [];
    for (const employee of byEmployee.values()) {
      const sessions = pairTungstenWithSessions(
        employee.hrmIns,
        employee.hrmOuts,
        employee.tungsten,
        todayKey,
        nowMs,
        (sessionDate) => {
          const fromAssignment = getApplicableShift(
            employee.employeeName,
            sessionDate,
            assignmentsByName,
          )?.startTime;
          if (fromAssignment) return fromAssignment;
          const cinOnDay = employee.hrmIns.find((r) => r.date === sessionDate);
          return cinOnDay?.shiftStartTime ?? null;
        },
      );

      sessions.forEach((session, i) => {
        if (!rowInAppliedScope(session.sessionDate, applied)) return;
        const shift = getApplicableShift(
          employee.employeeName,
          session.sessionDate,
          assignmentsByName,
        );
        const cinOnDay = employee.hrmIns.find((r) => r.date === session.sessionDate);
        result.push({
          key: `${normalizeName(employee.employeeName)}__${session.sessionDate}__${i + 1}`,
          date: session.sessionDate,
          employeeName: employee.employeeName,
          tungstenPunchIn: session.tungstenPunchIn,
          hrmClockIn: session.hrmClockIn,
          hrmClockOut: session.hrmClockOut,
          tungstenPunchOut: session.tungstenPunchOut,
          department: employee.department,
          shiftStartTime: shift?.startTime ?? cinOnDay?.shiftStartTime ?? null,
          shiftEndTime: shift?.endTime ?? cinOnDay?.shiftEndTime ?? null,
        });
      });
    }

    return result.sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      const n = a.employeeName.localeCompare(b.employeeName, undefined, { sensitivity: "base" });
      if (n !== 0) return n;
      return a.hrmClockIn.localeCompare(b.hrmClockIn);
    });
  }, [rows, shiftAssignments, applied]);

  async function downloadExcel() {
    if (tableRows.length === 0) {
      toastInfo("No records to export");
      return;
    }
    setExporting(true);
    try {
      const byEmployee = new Map<string, ReportTableRow[]>();
      for (const r of tableRows) {
        const key = r.employeeName;
        if (!byEmployee.has(key)) byEmployee.set(key, []);
        byEmployee.get(key)!.push(r);
      }

      const sheets = [...byEmployee.entries()]
        .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .map(([name, empRows]) => ({
          name,
          rows: empRows.map(
            (r): EmployeeReportExcelRow => ({
              cells: [
                r.date,
                r.employeeName,
                r.tungstenPunchIn,
                r.hrmClockIn,
                r.hrmClockOut,
                r.tungstenPunchOut,
                r.department,
              ],
            }),
          ),
        }));

      const rangeSuffix =
        applied.mode === "month"
          ? `-${applied.month}`
          : `-${applied.date}`;
      const deptSuffix = applied.dept ? `-${applied.dept.replace(/\s+/g, "_")}` : "";
      const fileName = `employee-report${deptSuffix}${rangeSuffix}.xlsx`;
      await downloadEmployeeReportExcel(sheets, fileName);
    } finally {
      setExporting(false);
    }
  }

  const showStats = !loading && (rows.length > 0 || hCount > 0 || tCount > 0);

  return (
    <LayoutDashboard>
      <div className={adminStyles.page}>
        <div className={tableStyles.breakSummaryContainer}>
        <div className={reportStyles.header}>
          <div>
            <h1 className={tableStyles.pageTitle}>Employee Report</h1>
            <p className={reportStyles.subtitle}>{subtitle}</p>
          </div>
          {showStats && (
            <div className={reportStyles.stats}>
              <div className={reportStyles.statChip}>
                <strong>{tableRows.length}</strong>
                <span>Total</span>
              </div>
              <div className={`${reportStyles.statChip} ${reportStyles.statH}`}>
                <strong>{hCount}</strong>
                <span>HRM</span>
              </div>
              <div className={`${reportStyles.statChip} ${reportStyles.statT}`}>
                <strong>{tCount}</strong>
                <span>Tungsten</span>
              </div>
            </div>
          )}
        </div>

        <div className={tableStyles.breakSummaryFilters}>
          <label className={reportStyles.field}>
            <span className={reportStyles.label}>View</span>
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              className={tableStyles.breakSummaryDate}
            >
              <option value="day">Single day</option>
              <option value="month">Full month</option>
            </select>
          </label>
          <label className={reportStyles.field}>
            <span className={reportStyles.label}>Employee name</span>
            <input
              type="search"
              placeholder="All employees"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              className={tableStyles.breakSummaryInput}
            />
          </label>
          <label className={reportStyles.field}>
            <span className={reportStyles.label}>Department</span>
            <select
              value={draftDept}
              onChange={(e) => setDraftDept(e.target.value)}
              className={tableStyles.breakSummaryDate}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          {filterMode === "day" ? (
            <label className={reportStyles.field}>
              <span className={reportStyles.label}>Report date</span>
              <input
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                className={tableStyles.breakSummaryDate}
              />
            </label>
          ) : (
            <label className={reportStyles.field}>
              <span className={reportStyles.label}>Month</span>
              <input
                type="month"
                value={draftMonth}
                onChange={(e) => setDraftMonth(e.target.value)}
                className={tableStyles.breakSummaryDate}
              />
            </label>
          )}
          <div className={reportStyles.actions}>
            <button
              type="button"
              onClick={downloadExcel}
              disabled={loading || exporting || tableRows.length === 0}
              className={tableStyles.breakSummaryXLSButton}
            >
              <FaFileExcel /> {exporting ? "Exporting…" : "Export XLS"}
            </button>
            <button type="button" onClick={clearFilters} disabled={loading || exporting} className={reportStyles.btnClear}>
              Clear
            </button>
            <button type="button" onClick={applyFilters} disabled={loading || exporting} className={reportStyles.btnSearch}>
              {loading ? "Loading…" : "Search"}
            </button>
          </div>
        </div>

        {error && <p className={reportStyles.error}>{error}</p>}

        <div className={tableStyles.breakSummaryTableWrapper}>
          <table className={tableStyles.breakSummaryTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th className={tableStyles.nameCol}>Employee Name</th>
                <th>Tungsten Punch In</th>
                <th>HRM Clock In</th>
                <th>HRM Clock Out</th>
                <th>Tungsten Punch Out</th>
                <th>Department</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className={reportStyles.empty}>
                    Loading records…
                  </td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className={reportStyles.empty}>
                    {emptyMessage}
                    {applied.name.trim() ? ` matching “${applied.name.trim()}”` : ""}.
                  </td>
                </tr>
              ) : (
                tableRows.map((r) => {
                  const employeeId = employeeIdByName[normalizeName(r.employeeName)] || "";
                  return (
                  <tr key={r.key}>
                    <td>{r.date}</td>
                    <td className={tableStyles.nameCol}>
                      <EmployeeTableNameCell
                        name={r.employeeName}
                        employeeId={employeeId || r.employeeName}
                        photo={getPhoto(employeeId || null)}
                        onOpen={() =>
                          openFromRow({
                            employee_id: employeeId || undefined,
                            employee_name: r.employeeName,
                            department_name: r.department,
                            shift_start_time: r.shiftStartTime,
                            shift_end_time: r.shiftEndTime,
                          })
                        }
                      />
                    </td>
                    <td>
                      {r.tungstenPunchIn !== "-" ? (
                        <span className={reportStyles.timeWithBadge}>
                          <span className={reportStyles.badgeT}>T</span>
                          {r.tungstenPunchIn}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {r.hrmClockIn !== "-" ? (
                        <span className={reportStyles.timeWithBadge}>
                          <span className={reportStyles.badgeH}>H</span>
                          {r.hrmClockIn}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {r.hrmClockOut !== "-" ? (
                        <span className={reportStyles.timeWithBadge}>
                          <span className={reportStyles.badgeH}>H</span>
                          {r.hrmClockOut}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {r.tungstenPunchOut !== "-" ? (
                        <span className={reportStyles.timeWithBadge}>
                          <span className={reportStyles.badgeT}>T</span>
                          {r.tungstenPunchOut}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{r.department}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        </div>
      </div>
      {popup}
    </LayoutDashboard>
  );
}
