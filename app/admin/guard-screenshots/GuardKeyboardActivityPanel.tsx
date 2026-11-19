"use client";

import React from "react";
import adminStyles from "../admin-page.module.css";
import styles from "../presence-idle/presence-idle.module.css";
import { toastError } from "@/lib/app-toast";

type SimEvent = {
  ord: number;
  token: string;
  capturedAt: string;
  appName: string;
  windowTitle: string | null;
};

type Row = {
  id: number;
  batchId: string;
  employeeId: string;
  employeeName: string | null;
  pseudonym: string | null;
  machineId: string | null;
  hostname: string | null;
  windowsUser: string | null;
  appName: string;
  appPath: string | null;
  keyDownCount: number;
  typingActiveMs: number;
  keyboardIdleMs: number;
  periodStart: string;
  periodEnd: string;
  isSimulation?: boolean;
  simulationSequence?: string | null;
  simulationEvents?: SimEvent[] | null;
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

function fmtDuration(ms: number) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const sec = Math.floor(n / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
}

type Props = {
  onBack: () => void;
};

export default function GuardKeyboardActivityPanel({ onBack }: Props) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [appFilter, setAppFilter] = React.useState("");
  const [simOnly, setSimOnly] = React.useState(false);
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
      if (simOnly) q.set("simulationOnly", "1");
      const res = await fetch(`/api/admin/guard-keyboard-activity?${q}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.status === 401 || data.locked) {
        toastError("Gallery locked");
        return;
      }
      if (!data.success) {
        toastError(data.error || "Could not load keyboard activity");
        return;
      }
      setRows((data.rows || []) as Row[]);
      setTotal(Number(data.total) || 0);
    } catch {
      toastError("Network error loading keyboard activity");
    } finally {
      setLoading(false);
    }
  }, [page, search, appFilter, dateFrom, dateTo, simOnly]);

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
          <h2 className={styles.detailTitle}>Keyboard activity</h2>
          <p className={styles.detailSub}>
            Live metrics: keystroke <em>counts</em> + durations only.{" "}
            <strong>TEST/SIMULATION</strong> rows store a synthetic token
            sequence (not live OS typing) and show it under Keystrokes. Tray →{" "}
            <em>TEST: Keyboard pipeline sim…</em>
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
          <label htmlFor="kbd-search">Search</label>
          <input
            id="kbd-search"
            type="text"
            className={styles.profileSearchInput}
            value={search}
            placeholder="Name, pseudo, PC, sequence…"
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className={styles.field} style={{ minWidth: 140 }}>
          <label htmlFor="kbd-app">App</label>
          <input
            id="kbd-app"
            type="text"
            value={appFilter}
            placeholder="InteractGuard.SIMULATION…"
            onChange={(e) => {
              setPage(1);
              setAppFilter(e.target.value);
            }}
            style={{ width: "100%", minWidth: 120 }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="kbd-from">From</label>
          <input
            id="kbd-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="kbd-to">To</label>
          <input
            id="kbd-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
          />
        </div>
        <div className={styles.field} style={{ justifyContent: "flex-end" }}>
          <label
            htmlFor="kbd-sim"
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input
              id="kbd-sim"
              type="checkbox"
              checked={simOnly}
              onChange={(e) => {
                setPage(1);
                setSimOnly(e.target.checked);
              }}
            />
            TEST/SIM only
          </label>
        </div>
      </div>

      <div className={styles.activityTableWrap}>
        <table className={styles.activityTable}>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Application</th>
              <th>Keystrokes</th>
              <th>Typing active</th>
              <th>Keyboard idle</th>
              <th>Period</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.tip}>
                  {loading
                    ? "Loading…"
                    : "No rows yet. Run tray → TEST: Keyboard pipeline sim… or wait for live metrics (1.2.50+)."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const simSeq =
                  r.isSimulation &&
                  (r.simulationSequence ||
                    (r.simulationEvents?.length
                      ? [...r.simulationEvents]
                          .sort((a, b) => a.ord - b.ord)
                          .map((e) => e.token)
                          .join(" → ")
                      : ""));
                return (
                <tr key={r.id}>
                  <td>
                    <div>{r.employeeName || `ID ${r.employeeId}`}</div>
                    <div className={styles.liveTileMeta}>
                      {[r.pseudonym, `id ${r.employeeId}`, r.hostname]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {r.isSimulation ? (
                      <div className={styles.liveTileMeta}>
                        <strong>TEST / SIMULATION</strong>
                        {r.keyDownCount
                          ? ` · ${r.keyDownCount} tokens`
                          : null}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <strong>{r.appName}</strong>
                    {r.appPath ? (
                      <div className={styles.liveTileMeta}>{r.appPath}</div>
                    ) : null}
                  </td>
                  <td>
                    {simSeq ? (
                      <code style={{ fontSize: 12, whiteSpace: "normal" }}>
                        {simSeq}
                      </code>
                    ) : (
                      r.keyDownCount.toLocaleString()
                    )}
                  </td>
                  <td>{fmtDuration(r.typingActiveMs)}</td>
                  <td>{fmtDuration(r.keyboardIdleMs)}</td>
                  <td>
                    <div>{fmt(r.periodStart)}</div>
                    <div className={styles.liveTileMeta}>→ {fmt(r.periodEnd)}</div>
                  </td>
                </tr>
                );
              })
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
