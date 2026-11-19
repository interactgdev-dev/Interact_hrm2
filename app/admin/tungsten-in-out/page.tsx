"use client";

import React, { useCallback, useEffect, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import leaveStyles from "../../leave/leave.module.css";
import adminStyles from "../admin-page.module.css";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";

type Row = Record<string, unknown>;

type AppliedFilters = {
  name: string;
  dept: string;
  dateFrom: string;
  dateTo: string;
};

function getDefaultFilters(): AppliedFilters {
  const today = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
  return {
    name: "",
    dept: "",
    dateFrom: `${today.slice(0, 7)}-01`,
    dateTo: today,
  };
}

function parseDbDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const normalized = s.includes("T") ? s : s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt12h(v: unknown): string {
  const d = parseDbDate(v);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: SERVER_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function getRowEmployeeName(row: Row): string {
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  const direct =
    row.employee_name ?? row.employeeName ?? row.full_name ?? row.name;
  return direct != null ? String(direct).trim() : "";
}

function getRowEmployeeId(row: Row): string | number {
  return (row.pin ?? row.employee_id ?? row.employeeId ?? "") as string | number;
}

function rowString(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export default function TungstenInOutPage() {
  const fixedPageSize = 100;
  const defaultFilters = getDefaultFilters();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [applied, setApplied] = useState<AppliedFilters>(defaultFilters);
  const [draft, setDraft] = useState<AppliedFilters>(defaultFilters);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: String(fixedPageSize),
      });
      if (applied.name.trim()) q.set("name", applied.name.trim());
      if (applied.dept.trim()) q.set("dept", applied.dept.trim());
      if (applied.dateFrom.trim()) q.set("dateFrom", applied.dateFrom.trim());
      if (applied.dateTo.trim()) q.set("dateTo", applied.dateTo.trim());

      const res = await fetch(`/api/zkbio-punch-log?${q}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.hint ? `${data.error}\n${data.hint}` : data.error || "Request failed");
        setRows([]);
        setTotal(0);
        setDepartments([]);
        return;
      }
      setRows(data.rows || []);
      setTotal(data.total ?? 0);
      setDepartments(Array.isArray(data.departments) ? data.departments : []);
    } catch (e) {
      setError(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, fixedPageSize, applied, reloadTick]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / fixedPageSize));

  const applyFilters = () => {
    setApplied({ ...draft });
    setPage(1);
  };

  const clearFilters = () => {
    const resetFilters = getDefaultFilters();
    setDraft(resetFilters);
    setApplied(resetFilters);
    setPage(1);
  };

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={styles.breakSummaryContainer}>
          <div className={adminStyles.pageHeader}>
            <div>
              <h1 className={adminStyles.pageHeaderTitle}>Tungsten IN/OUT</h1>
              <p className={styles.mgmtAttMeta} style={{ marginTop: 4 }}>
                Biometric punch log · {total.toLocaleString()} record
                {total === 1 ? "" : "s"}
                {total > 0 ? ` · Page ${page} of ${totalPages}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              disabled={loading}
              className={adminStyles.btnGreen}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className={leaveStyles.toolbar}>
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
                placeholder="Search by name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                autoComplete="off"
              />
            </div>
            <select
              value={draft.dept}
              onChange={(e) => setDraft((d) => ({ ...d, dept: e.target.value }))}
              className={leaveStyles.toolbarSelect}
              aria-label="Filter by department"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={draft.dateFrom}
              onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
              className={leaveStyles.toolbarSelect}
              aria-label="From date"
            />
            <input
              type="date"
              value={draft.dateTo}
              onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
              className={leaveStyles.toolbarSelect}
              aria-label="To date"
            />
            <button
              type="button"
              onClick={clearFilters}
              disabled={loading}
              className={styles.mgmtAttGhostBtn}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              className={styles.breakSummaryXLSButton}
            >
              Apply
            </button>
          </div>

          {error ? (
            <div className={styles.tungstenError} role="alert">
              {error}
            </div>
          ) : null}

          <div className={leaveStyles.reqTableShell}>
            <div className={styles.mgmtAttScroll}>
              {loading && rows.length === 0 ? (
                <div className={leaveStyles.loading}>Loading punch log…</div>
              ) : (
                <table className={`${leaveStyles.reqTable} ${styles.tungstenTableFit}`}>
                  <thead>
                    <tr>
                      <th>PIN</th>
                      <th>Full Name</th>
                      <th>Department</th>
                      <th>Event Time</th>
                      <th>Reader</th>
                      <th>Imported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={leaveStyles.reqEmpty}>
                          No punch records found
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, idx) => {
                        const name = getRowEmployeeName(row);
                        const employeeId = getRowEmployeeId(row);
                        const dept = rowString(row, "dept_name") || "—";
                        const reader = rowString(row, "reader_name") || "—";
                        return (
                          <tr key={String(row.id ?? `${employeeId}-${idx}`)}>
                            <td className={leaveStyles.reqId}>{String(employeeId || "—")}</td>
                            <td>
                              {name ? (
                                <EmployeeTableNameCell
                                  name={name}
                                  employeeId={employeeId}
                                  photo={employeeId ? getPhoto(employeeId) : undefined}
                                  onOpen={() =>
                                    openFromRow({
                                      employee_id: employeeId,
                                      employee_name: name,
                                      first_name: rowString(row, "first_name"),
                                      last_name: rowString(row, "last_name"),
                                      department_name: rowString(row, "dept_name"),
                                    })
                                  }
                                />
                              ) : (
                                "—"
                              )}
                            </td>
                            <td title={dept}>{dept}</td>
                            <td title={fmt12h(row.event_time)}>{fmt12h(row.event_time)}</td>
                            <td title={reader}>{reader}</td>
                            <td title={fmt12h(row.imported_at)}>{fmt12h(row.imported_at)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {totalPages > 1 ? (
            <div className={styles.tungstenPager}>
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={styles.mgmtAttGhostBtn}
              >
                Previous
              </button>
              <span className={styles.tungstenPagerLabel}>
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className={styles.mgmtAttGhostBtn}
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {popup}
    </OptionalAdminShell>
  );
}
