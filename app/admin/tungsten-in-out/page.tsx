"use client";

import React, { useCallback, useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

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

const labelStyle: React.CSSProperties = { fontWeight: 600, color: "#334155", fontSize: 12 };
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  minWidth: 0,
};

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

  // NOTE: keep `imported_at` visible (user wants it).
  const hiddenCols = new Set(["id", "log_id", "event_name", "verify_mode", "device_name", "raw_json"]);
  const visibleColumns = columns.filter((c) => !hiddenCols.has(c));
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
    <LayoutDashboard>
      <div style={{ padding: "24px 28px", maxWidth: "100%" }}>
        <h1
          style={{
            marginTop: 0,
            marginBottom: 16,
            color: "#0f1d40",
            fontWeight: 700,
            fontSize: "1.65rem",
          }}
        >
          Tungsten IN/OUT
        </h1>

        <div
          style={{
            padding: 16,
            background: "#ffffff",
            borderRadius: 14,
            border: "1px solid #e2e8f0",
            boxShadow: "0 2px 12px rgba(15, 23, 42, 0.06)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              alignItems: "end",
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Search by name</span>
              <input
                type="search"
                placeholder="First / last name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                style={{ ...inputStyle, width: "100%" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Department</span>
              <select
                value={draft.dept}
                onChange={(e) => setDraft((d) => ({ ...d, dept: e.target.value }))}
                style={{ ...inputStyle, width: "100%", height: 38 }}
              >
                <option value="">All</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>From date</span>
              <input
                type="date"
                value={draft.dateFrom}
                onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
                style={{ ...inputStyle, width: "100%", height: 38 }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>To date</span>
              <input
                type="date"
                value={draft.dateTo}
                onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
                style={{ ...inputStyle, width: "100%", height: 38 }}
              />
            </label>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 14,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={clearFilters}
              disabled={loading}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#334155",
                fontWeight: 700,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              disabled={loading}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#334155",
                fontWeight: 700,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg, #0052CC 0%, #00B8A9 100%)",
                color: "#fff",
                fontWeight: 800,
                cursor: loading ? "wait" : "pointer",
                boxShadow: "0 8px 18px rgba(0, 82, 204, 0.20)",
              }}
            >
              Apply
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: 14,
              marginBottom: 16,
              background: "#fef2f2",
              color: "#b91c1c",
              borderRadius: 8,
              whiteSpace: "pre-wrap",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12, color: "#475569", fontSize: 14 }}>
          Total: <strong>{total.toLocaleString()}</strong>
          {total > 0 && (
            <>
              {" "}
              · Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </>
          )}
        </div>

        <div
          className={`${styles.attendanceSummaryTableWrapper} ${styles.timeAttendanceTableWrapper}`}
          style={{ width: "100%" }}
        >
          <table className={`${styles.attendanceSummaryTable} ${styles.timeAttendanceStickyTable}`} style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                {visibleColumns.map((col) => (
                  <th key={col} style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {toTitleCaseHeader(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} style={{ padding: 24, textAlign: "center" }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} style={{ padding: 24, textAlign: "center" }}>
                    No records
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={String(row.id ?? idx)}>
                    {visibleColumns.map((col) => {
                      const raw = row[col];
                      const text = fmtCell(col, raw);
                      const isTimeCol = col === "event_time" || col === "imported_at";
                      return (
                        <td
                          key={col}
                          style={{
                            fontSize: 12,
                            maxWidth: col === "raw_json" ? 320 : isTimeCol ? 220 : 160,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={
                            col === "raw_json" && typeof raw === "string"
                              ? raw
                              : isTimeCol && raw != null
                                ? String(raw)
                                : text
                          }
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center" }}>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#fff",
                cursor: page <= 1 ? "not-allowed" : "pointer",
              }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#fff",
                cursor: page >= totalPages ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </LayoutDashboard>
  );
}
