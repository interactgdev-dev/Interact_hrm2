"use client";

import React from "react";
import adminStyles from "../admin-page.module.css";
import styles from "../presence-idle/presence-idle.module.css";
import { toastError } from "@/lib/app-toast";

type Row = {
  id: number;
  employeeId: string;
  employeeName: string | null;
  pseudonym: string | null;
  machineId: string | null;
  hostname: string | null;
  windowsUser: string | null;
  appName: string;
  appPath: string | null;
  caption: string | null;
  startedAt: string;
  lastSeenAt: string;
};

function todayYmd() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmt(iso: string) {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

type Props = {
  onBack: () => void;
};

export default function GuardAppActivityPanel({ onBack }: Props) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [appFilter, setAppFilter] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState(todayYmd());
  const [dateTo, setDateTo] = React.useState(todayYmd());
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) q.set("search", search.trim());
      if (appFilter.trim()) q.set("app", appFilter.trim());
      if (dateFrom) q.set("dateFrom", dateFrom);
      if (dateTo) q.set("dateTo", dateTo);
      const res = await fetch(`/api/admin/guard-app-activity?${q}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.status === 401 || data.locked) {
        toastError("Gallery locked");
        return;
      }
      if (!data.success) {
        toastError(data.error || "Could not load activity");
        return;
      }
      setRows((data.rows || []) as Row[]);
      setTotal(Number(data.total) || 0);
    } catch {
      toastError("Network error loading activity");
    } finally {
      setLoading(false);
    }
  }, [page, search, appFilter, dateFrom, dateTo]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.galleryWrap}>
      <div className={styles.detailHeader}>
        <button
          type="button"
          className={adminStyles.btnSecondary}
          onClick={onBack}
        >
          ← Profiles
        </button>
        <div>
          <h2 className={styles.detailTitle}>App activity</h2>
          <p className={styles.detailSub}>
            Foreground app + window title only. No typed text / keystrokes.
            Needs Guard <strong>1.2.49+</strong>.
          </p>
        </div>
        <button
          type="button"
          className={adminStyles.btnSecondary}
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className={styles.profileFilterBar}>
        <div className={`${styles.field} ${styles.profileSearchField}`}>
          <label htmlFor="act-search">Search</label>
          <input
            id="act-search"
            type="text"
            className={styles.profileSearchInput}
            value={search}
            placeholder="Name, pseudo, caption, PC…"
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className={styles.field} style={{ minWidth: 140 }}>
          <label htmlFor="act-app">App</label>
          <input
            id="act-app"
            type="text"
            value={appFilter}
            placeholder="Discord, Excel…"
            onChange={(e) => {
              setPage(1);
              setAppFilter(e.target.value);
            }}
            style={{ width: "100%", minWidth: 120 }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="act-from">From</label>
          <input
            id="act-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="act-to">To</label>
          <input
            id="act-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
          />
        </div>
      </div>

      <div className={styles.activityTableWrap}>
        <table className={styles.activityTable}>
          <thead>
            <tr>
              <th>Computer</th>
              <th>User</th>
              <th>Started</th>
              <th>Last seen</th>
              <th>Application</th>
              <th>Caption</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.tip}>
                  {loading
                    ? "Loading…"
                    : "No activity for this date range. Check: agent 1.2.49+ installed, employee bound (Status), HRM URL points to this server, then switch apps (Chrome↔Discord) and Refresh. Clear From/To or widen dates if needed."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div>{r.hostname || "—"}</div>
                    <div className={styles.liveTileMeta}>
                      {r.windowsUser || r.machineId || ""}
                    </div>
                  </td>
                  <td>
                    <div>
                      {r.employeeName || `ID ${r.employeeId}`}
                    </div>
                    <div className={styles.liveTileMeta}>
                      {[r.pseudonym, `id ${r.employeeId}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td>{fmt(r.startedAt)}</td>
                  <td>{fmt(r.lastSeenAt)}</td>
                  <td>
                    <strong>{r.appName}</strong>
                  </td>
                  <td>{r.caption || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className={styles.durationRow}>
          <span className={styles.tip}>
            {total} row(s) · page {page}/{totalPages}
          </span>
          <button
            type="button"
            className={adminStyles.btnSecondary}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className={adminStyles.btnSecondary}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
