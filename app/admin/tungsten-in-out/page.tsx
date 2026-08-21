"use client";

import React, { useCallback, useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../break-summary/break-summary.module.css";
import { getDateStringInTimeZone, parseToInstant, SERVER_TIMEZONE } from "@/lib/timezone";
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
  const d = parseToInstant(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt12h(v: unknown): string {
  const d = parseDbDate(v);
  if (!d) return "";
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

function fmtCell(key: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (key === "raw_json" && typeof v === "string") {
    return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  if (key === "event_time" || key === "imported_at") {
    return fmt12h(v);
  }
  return String(v);
}

function toTitleCaseHeader(col: string): string {
  return col
    .replace(/[_\-]+/g, " ")
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
  const [columns, setColumns] = useState<string[]>([]);
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
        setColumns([]);
        setTotal(0);
        setDepartments([]);
        return;
      }
      setColumns(data.columns || []);
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

  const hiddenCols = new Set(["id", "log_id", "event_name", "verify_mode", "device_name", "raw_json"]);
  const visibleColumns = columns.filter((c) => !hiddenCols.has(c));
  const totalPages = Math.max(1, Math.ceil(total / fixedPageSize));
  const nameColumnKeys = new Set(["employee_name", "full_name", "first_name"]);

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

  const renderCell = (row: Row, col: string) => {
    const raw = row[col];
    const text = fmtCell(col, raw);
    const isTimeCol = col === "event_time" || col === "imported_at";

    if (nameColumnKeys.has(col)) {
      const name = getRowEmployeeName(row);
      const employeeId = getRowEmployeeId(row);
      if (!name) return text;
      return (
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
      );
    }

    if (col === "last_name" && visibleColumns.includes("first_name")) {
      return text;
    }

    return (
      <span
        title={
          col === "raw_json" && typeof raw === "string"
            ? raw
            : isTimeCol && raw != null
              ? String(raw)
              : text
        }
        style={{
          display: "block",
          maxWidth: col === "raw_json" ? 320 : isTimeCol ? 220 : 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    );
  };

  return (
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer}>
        <h1 className={styles.pageTitle}>Tungsten IN/OUT</h1>

        <div className={styles.breakSummaryFilters} style={{ alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: "#64748b" }}>Search by name</span>
            <input
              type="search"
              placeholder="First / last name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              className={styles.breakSummaryInput}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 180px" }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: "#64748b" }}>Department</span>
            <select
              value={draft.dept}
              onChange={(e) => setDraft((d) => ({ ...d, dept: e.target.value }))}
              className={styles.breakSummaryInput}
            >
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 1 160px" }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: "#64748b" }}>From date</span>
            <input
              type="date"
              value={draft.dateFrom}
              onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
              className={styles.breakSummaryDate}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 1 160px" }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: "#64748b" }}>To date</span>
            <input
              type="date"
              value={draft.dateTo}
              onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
              className={styles.breakSummaryDate}
            />
          </label>

          <button
            type="button"
            onClick={clearFilters}
            disabled={loading}
            className={styles.breakSummaryInput}
            style={{ fontWeight: 700, cursor: loading ? "wait" : "pointer" }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            disabled={loading}
            className={styles.breakSummaryInput}
            style={{ fontWeight: 700, cursor: loading ? "wait" : "pointer" }}
          >
            Refresh
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

        {error && (
          <div style={{ padding: 14, marginBottom: 16, background: "#fef2f2", color: "#b91c1c", borderRadius: 10, whiteSpace: "pre-wrap", fontSize: 14 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12, color: "#64748b", fontSize: 14 }}>
          Total: <strong>{total.toLocaleString()}</strong>
          {total > 0 && (
            <>
              {" "}
              · Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </>
          )}
        </div>

        <div className={styles.breakSummaryTableWrapper}>
          <table className={styles.breakSummaryTable} style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                {visibleColumns.map((col) => (
                  <th key={col}>{toTitleCaseHeader(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length, 1)} className={styles.breakSummaryNoRecords}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length, 1)} className={styles.breakSummaryNoRecords}>
                    No records
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={String(row.id ?? idx)}>
                    {visibleColumns.map((col) => (
                      <td key={col} style={{ fontSize: 12 }}>
                        {renderCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className={styles.breakSummaryFilters} style={{ marginTop: 16, marginBottom: 0 }}>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={styles.breakSummaryInput}
              style={{ cursor: page <= 1 ? "not-allowed" : "pointer", fontWeight: 600 }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className={styles.breakSummaryInput}
              style={{ cursor: page >= totalPages ? "not-allowed" : "pointer", fontWeight: 600 }}
            >
              Next
            </button>
          </div>
        )}
      </div>
      {popup}
    </LayoutDashboard>
  );
}
