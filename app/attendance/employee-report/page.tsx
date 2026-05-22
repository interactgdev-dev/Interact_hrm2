"use client";

import React, { useCallback, useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import summaryStyles from "../../attendance-summary/attendance-summary.module.css";
import reportStyles from "./employee-report.module.css";
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
import {
  buildPinProfilesFromRows,
  hrmMapFromEmployees,
  profileMapsFromApi,
  resolveZkIdentity,
} from "@/lib/zkbio-employee-resolve";

type ReportRow = {
  source: "H" | "T";
  sortAt: string;
  date: string;
  time: string;
  employeeName: string;
  department: string;
  detail: string;
};

type AttendanceRow = {
  employee_name?: string;
  department_name?: string;
  clock_in?: string | null;
  clock_out?: string | null;
  date?: string;
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

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const attParams = new URLSearchParams({
        fromDate: applied.fromDate,
        toDate: applied.toDate,
      });
      const zkParams = new URLSearchParams({
        dateFrom: applied.mode === "month" ? applied.fromDate : applied.date,
        dateTo: applied.toDate,
      });
      if (applied.name.trim()) zkParams.set("name", applied.name.trim());
      if (applied.dept) zkParams.set("dept", applied.dept);

      const [attRes, zkResult, pinProfRes, empListRes] = await Promise.all([
        fetch(`/api/attendance?${attParams}`),
        fetchAllZkRows(zkParams),
        fetch("/api/zkbio-pin-profiles"),
        fetch("/api/employee-list"),
      ]);

      const attData = await attRes.json();
      const pinProfData = await pinProfRes.json();
      const empListData = await empListRes.json();

      const batchPinProfiles = buildPinProfilesFromRows(zkResult.rows);
      const dbPinProfiles = pinProfData.success
        ? profileMapsFromApi(pinProfData.profiles || [])
        : new Map();
      const hrmByCode =
        empListData.success && empListData.employees
          ? hrmMapFromEmployees(empListData.employees)
          : new Map();

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
        const visibleDate = formatDateOnly(a.clock_in || a.clock_out || a.date);
        if (!rowInAppliedScope(visibleDate, applied)) continue;

        const employeeName = (a.employee_name || "").trim() || "—";
        const department = a.department_name || "";

        if (term) {
          const n = employeeName.toLowerCase();
          if (!n.includes(term)) continue;
        }
        if (applied.dept && department !== applied.dept) continue;

        if (a.clock_in) {
          const r = rowFromIso("H", a.clock_in, employeeName, department, "Clock In");
          if (r && rowInAppliedScope(r.date, applied)) merged.push(r);
        }
        if (a.clock_out) {
          const r = rowFromIso("H", a.clock_out, employeeName, department, "Clock Out");
          if (r && rowInAppliedScope(r.date, applied)) merged.push(r);
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

        if (!rowInAppliedScope(eventDate, applied)) continue;

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

  async function downloadExcel() {
    if (rows.length === 0) {
      alert("No records to export");
      return;
    }
    setExporting(true);
    try {
      const byEmployee = new Map<string, ReportRow[]>();
      for (const r of rows) {
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
              source: r.source,
              cells: [r.source, r.date, r.time, r.department, r.detail],
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
      <div className={reportStyles.page}>
        <div className={reportStyles.header}>
          <div>
            <h1 className={reportStyles.title}>Employee Report</h1>
            <p className={reportStyles.subtitle}>{subtitle}</p>
          </div>
          {showStats && (
            <div className={reportStyles.stats}>
              <div className={reportStyles.statChip}>
                <strong>{rows.length}</strong>
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

        <div className={reportStyles.filters}>
          <label className={reportStyles.field}>
            <span className={reportStyles.label}>View</span>
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              className={summaryStyles.attendanceSummaryDate}
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
              className={summaryStyles.attendanceSummaryInput}
            />
          </label>
          <label className={reportStyles.field}>
            <span className={reportStyles.label}>Department</span>
            <select
              value={draftDept}
              onChange={(e) => setDraftDept(e.target.value)}
              className={summaryStyles.attendanceSummaryDate}
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
                className={summaryStyles.attendanceSummaryDate}
              />
            </label>
          ) : (
            <label className={reportStyles.field}>
              <span className={reportStyles.label}>Month</span>
              <input
                type="month"
                value={draftMonth}
                onChange={(e) => setDraftMonth(e.target.value)}
                className={summaryStyles.attendanceSummaryDate}
              />
            </label>
          )}
          <div className={reportStyles.actions}>
            <button
              type="button"
              onClick={downloadExcel}
              disabled={loading || exporting || rows.length === 0}
              className={reportStyles.btnExport}
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

        <div className={reportStyles.tableWrap}>
          <table className={reportStyles.table}>
            <thead>
              <tr>
                <th>Source</th>
                <th>Date</th>
                <th>Time</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className={reportStyles.empty}>
                    Loading records…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className={reportStyles.empty}>
                    {emptyMessage}
                    {applied.name.trim() ? ` matching “${applied.name.trim()}”` : ""}.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr
                    key={`${r.source}-${r.sortAt}-${idx}`}
                    className={r.source === "H" ? reportStyles.rowH : reportStyles.rowT}
                  >
                    <td>
                      <span className={r.source === "H" ? reportStyles.badgeH : reportStyles.badgeT}>
                        {r.source}
                      </span>
                    </td>
                    <td>{r.date}</td>
                    <td>{r.time}</td>
                    <td className={reportStyles.employeeCell}>{r.employeeName}</td>
                    <td>{r.department}</td>
                    <td className={reportStyles.detailCell}>{r.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && rows.length > 0 && (
          <p className={reportStyles.footer}>
            Sorted by employee, date, then time · Export creates one Excel tab per employee
          </p>
        )}
      </div>
    </LayoutDashboard>
  );
}
