"use client";

import React, { useEffect, useMemo, useState } from "react";
import leaveStyles from "../../leave/leave.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { overallLeaveStatus } from "@/lib/leave-approval";
import { leaveDeptMatches } from "@/lib/leave-dept-filter";

type SummaryRow = {
  id: number | string;
  employeeName: string;
  pseudonym: string;
  department: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  leaveTypes: string[];
  yearTrend: number[];
};

function leaveMonthIndex(dateStr: string): number | null {
  if (!dateStr) return null;
  const raw = String(dateStr).slice(0, 10);
  const parts = raw.split("-");
  if (parts.length < 2) return null;
  const m = Number(parts[1]);
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  return m - 1;
}

function titleCaseType(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function YearTrend({ values }: { values: number[] }) {
  const series = values.length === 12 ? values : Array.from({ length: 12 }, (_, i) => values[i] || 0);
  const max = Math.max(1, ...series);
  const tip = series
    .map((v, i) => `${MONTH_SHORT[i]}: ${v}`)
    .join(" · ");
  return (
    <div className={leaveStyles.trendRow} title={tip} aria-label={`Year trend: ${tip}`}>
      {series.map((v, i) => (
        <span
          key={MONTH_SHORT[i]}
          className={`${leaveStyles.trendBar}${v <= 0 ? ` ${leaveStyles.trendBarMuted}` : ""}`}
          style={{
            height: `${v <= 0 ? 3 : Math.max(4, Math.round((v / max) * 28))}px`,
          }}
        />
      ))}
    </div>
  );
}

function defaultMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

type LeaveSummaryPanelProps = {
  /** Shared month from tabs row (YYYY-MM) — syncs From/To dates */
  externalMonth?: string;
};

export default function LeaveSummaryPanel({
  externalMonth = "",
}: LeaveSummaryPanelProps) {
  const initialRange = defaultMonthRange();
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [showZeroActivity, setShowZeroActivity] = useState(false);
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [leaveData, setLeaveData] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    const monthKey = String(externalMonth || "").trim();
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return;
    const [year, monthNum] = monthKey.split("-");
    const lastDay = new Date(Number(year), Number(monthNum), 0).getDate();
    setFromDate(`${monthKey}-01`);
    setToDate(`${monthKey}-${String(lastDay).padStart(2, "0")}`);
  }, [externalMonth]);

  useEffect(() => {
    if (!fromDate && !toDate) return;
    void fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const uniqueDepartments = useMemo(() => {
    return Array.from(new Set(leaveData.map((row) => row.department).filter(Boolean))).sort();
  }, [leaveData]);

  async function fetchSummary() {
    setLoading(true);
    setError("");
    try {
      const viewerId =
        typeof window !== "undefined"
          ? String(localStorage.getItem("employeeId") || "").trim()
          : "";
      const viewerQs = viewerId ? `&viewerId=${encodeURIComponent(viewerId)}` : "";
      const viewerHeaders: HeadersInit = viewerId
        ? { "x-employee-id": viewerId, "x-hrm-employee-id": viewerId }
        : {};

      const empRes = await fetch(`/api/employee-list?ts=${Date.now()}${viewerQs}`, {
        cache: "no-store",
        headers: viewerHeaders,
      });
      const empData = await empRes.json();
      if (!empData.success) throw new Error(empData.error || "Failed to fetch employees");
      const employees = empData.employees || [];

      const rangeFrom = fromDate || toDate;
      const rangeTo = toDate || fromDate;
      const year = String(rangeFrom || rangeTo || "").slice(0, 4) || String(new Date().getFullYear());
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      const [monthLeavesRes, yearLeavesRes] = await Promise.all([
        fetch(
          `/api/leaves?fromDate=${encodeURIComponent(rangeFrom)}&toDate=${encodeURIComponent(rangeTo)}&ts=${Date.now()}${viewerQs}`,
          { cache: "no-store", headers: viewerHeaders },
        ),
        fetch(
          `/api/leaves?fromDate=${encodeURIComponent(yearStart)}&toDate=${encodeURIComponent(yearEnd)}&ts=${Date.now()}${viewerQs}`,
          { cache: "no-store", headers: viewerHeaders },
        ),
      ]);
      const monthLeavesData = await monthLeavesRes.json();
      const yearLeavesData = await yearLeavesRes.json();
      if (!monthLeavesData.success) {
        throw new Error(monthLeavesData.error || "Failed to fetch leaves");
      }
      const monthLeaves = monthLeavesData.leaves || [];
      const yearLeaves = yearLeavesData.success ? yearLeavesData.leaves || [] : monthLeaves;

      const yearByEmp = new Map<string, number[]>();
      for (const l of yearLeaves) {
        const id = String(l?.employee_id ?? "").trim();
        if (!id) continue;
        const idx = leaveMonthIndex(l.start_date || l.end_date || "");
        if (idx == null) continue;
        let arr = yearByEmp.get(id);
        if (!arr) {
          arr = Array(12).fill(0);
          yearByEmp.set(id, arr);
        }
        arr[idx] += 1;
      }

      const summary: SummaryRow[] = employees.map((emp: any) => {
        const empId = String(emp.id);
        const empLeaves = monthLeaves.filter(
          (l: any) => String(l.employee_id) === empId,
        );
        const approved = empLeaves.filter(
          (l: any) => overallLeaveStatus(l) === "approved",
        );
        const rejected = empLeaves.filter(
          (l: any) => overallLeaveStatus(l) === "rejected",
        );
        const pending = empLeaves.filter(
          (l: any) => overallLeaveStatus(l) === "pending",
        );
        const types = Array.from(
          new Set(
            empLeaves
              .map((l: any) => titleCaseType(l.leave_category))
              .filter(Boolean),
          ),
        );
        return {
          id: emp.id,
          employeeName: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
          pseudonym: emp.pseudonym || "-",
          department: String(emp.department_name || "").trim() || "-",
          total: empLeaves.length,
          approved: approved.length,
          rejected: rejected.length,
          pending: pending.length,
          leaveTypes: types,
          yearTrend: yearByEmp.get(empId) || Array(12).fill(0),
        };
      });
      setLeaveData(summary);
    } catch (e: any) {
      setError(e.message || "Failed to fetch data");
      setLeaveData([]);
    }
    setLoading(false);
  }

  const summaryFiltersActive = Boolean(
    search.trim() || departmentFilter || fromDate || toDate || showZeroActivity,
  );

  const clearSummaryFilters = () => {
    setSearch("");
    setDepartmentFilter("");
    setShowZeroActivity(false);
    const range = defaultMonthRange();
    setFromDate(range.from);
    setToDate(range.to);
  };

  const visibleRows = useMemo(() => {
    const searchLower = search.toLowerCase();
    return leaveData.filter((row) => {
      const matchesSearch =
        !search ||
        row.employeeName.toLowerCase().includes(searchLower) ||
        String(row.id).includes(searchLower) ||
        (row.pseudonym || "").toLowerCase().includes(searchLower);
      const matchesDept = leaveDeptMatches(row.department, departmentFilter);
      if (!matchesSearch || !matchesDept) return false;
      if (!showZeroActivity && (Number(row.total) || 0) === 0) return false;
      return true;
    });
  }, [leaveData, search, departmentFilter, showZeroActivity]);

  return (
    <>
      <p className={leaveStyles.subtitle} style={{ marginTop: 0 }}>
        Leave activity per employee for the selected date range. Employees with
        zero activity are hidden by default so the table isn&apos;t dominated by
        empty rows.
      </p>

      <div className={leaveStyles.infoNote} role="status">
        <svg
          className={leaveStyles.infoNoteIcon}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
        <span>
          Rows with no leave activity and no pseudo name assigned are collapsed
          out of the default view — toggle <b>Show zero-activity</b> to bring
          them back.
        </span>
      </div>

      <div className={leaveStyles.toolbar}>
        <div className={leaveStyles.filterField}>
          <label htmlFor="sum-filter-from">From date</label>
          <input
            id="sum-filter-from"
            type="date"
            className={leaveStyles.toolbarSelect}
            value={fromDate}
            onChange={(e) => {
              const v = e.target.value;
              setFromDate(v);
              if (v && toDate && toDate < v) setToDate(v);
            }}
            aria-label="From date"
          />
        </div>
        <div className={leaveStyles.filterField}>
          <label htmlFor="sum-filter-to">To date</label>
          <input
            id="sum-filter-to"
            type="date"
            className={leaveStyles.toolbarSelect}
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </div>
        <div className={leaveStyles.searchWrap}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className={leaveStyles.toolbarSearch}
            placeholder="Search by name, ID, or pseudo name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className={leaveStyles.filterField}>
          <label htmlFor="sum-filter-dept">Department</label>
          <select
            id="sum-filter-dept"
            className={leaveStyles.toolbarSelect}
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="">All departments</option>
            {uniqueDepartments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </div>
        <label
          className={`${leaveStyles.toggleChip}${showZeroActivity ? ` ${leaveStyles.toggleChipOn}` : ""}`}
        >
          <input
            type="checkbox"
            checked={showZeroActivity}
            onChange={(e) => setShowZeroActivity(e.target.checked)}
          />
          Show zero-activity
        </label>
        {summaryFiltersActive ? (
          <button
            type="button"
            className={leaveStyles.clearFilters}
            onClick={clearSummaryFilters}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <div className={`${leaveStyles.reqTableShell} ${leaveStyles.sumTableShell}`}>
        <div className={leaveStyles.reqTableScroll}>
          <table className={`${leaveStyles.reqTable} ${leaveStyles.sumTable}`}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Total</th>
                <th>Approved</th>
                <th>Rejected</th>
                <th>Pending</th>
                <th>Leave type</th>
                <th>Year trend</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className={leaveStyles.reqEmpty}>
                    Loading…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td
                    colSpan={9}
                    className={leaveStyles.reqEmpty}
                    style={{ color: "#bc3a3a" }}
                  >
                    {error}
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className={leaveStyles.reqEmpty}>
                    No employees match these filters.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td className={leaveStyles.reqId}>{row.id}</td>
                    <td>
                      <div className={leaveStyles.personCell}>
                        <EmployeeTableNameCell
                          name={row.employeeName}
                          employeeId={row.id}
                          photo={getPhoto(row.id)}
                          onOpen={() =>
                            openFromRow({
                              employee_id: row.id,
                              employee_name: row.employeeName,
                              pseudonym: row.pseudonym,
                              department_name: row.department,
                            })
                          }
                        />
                        {row.pseudonym && row.pseudonym !== "-" ? (
                          <div className={leaveStyles.pseudoLine}>
                            {row.pseudonym}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className={leaveStyles.sumDeptCell} title={row.department}>
                      {row.department}
                    </td>
                    <td className={leaveStyles.sumTotal}>{row.total}</td>
                    <td className={leaveStyles.sumOk}>{row.approved}</td>
                    <td className={leaveStyles.sumBad}>{row.rejected}</td>
                    <td className={leaveStyles.sumWarn}>{row.pending}</td>
                    <td>
                      {row.leaveTypes.length > 0 ? (
                        <div className={leaveStyles.typePills}>
                          {row.leaveTypes.map((t) => (
                            <span
                              key={t}
                              className={`${leaveStyles.badge} ${leaveStyles.badgeType}`}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <YearTrend values={row.yearTrend} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {popup}
    </>
  );
}
