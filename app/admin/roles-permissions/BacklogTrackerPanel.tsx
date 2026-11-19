"use client";

import React from "react";
import adminStyles from "../admin-page.module.css";
import styles from "../presence-idle/presence-idle.module.css";
import { toastError } from "@/lib/app-toast";
import { formatDateTimeInServerTz } from "@/lib/timezone";

/** Independent of Interact Guard / Screenshots UI — same unlock cookie/password only. */

type Row = {
  id: number;
  event_ts: string;
  day_key: string;
  event_type: string;
  employee_id: string | null;
  employee_name: string | null;
  pseudonym: string | null;
  employee_code: string | null;
  hostname: string | null;
  login_id: string | null;
  page_path: string | null;
  detail: string | null;
  method: string | null;
  url: string | null;
  file_name: string | null;
  file_bytes: number | null;
  saved_path: string | null;
  ip: string | null;
};

function todayYmd() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Props = {
  onBack?: () => void;
};

const EVENT_TYPES = [
  "",
  "employee_login",
  "session_ready",
  "page_view",
  "click",
  "click_delete",
  "download",
  "file_select",
  "file_upload",
  "file_backup",
  "api_call",
  "api_delete",
  "face_verify",
  "break_start",
  "break_end",
  "prayer_start",
  "prayer_end",
  "refreshment_start",
  "refreshment_end",
  "meeting_start",
  "meeting_end",
  "clock_in",
  "clock_out",
  "auto_clock_out",
  "admin_login",
  "admin_logout",
];

export default function BacklogTrackerPanel({ onBack }: Props) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [eventType, setEventType] = React.useState("");
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
      if (eventType) q.set("type", eventType);
      if (dateFrom) q.set("dateFrom", dateFrom);
      if (dateTo) q.set("dateTo", dateTo);
      const res = await fetch(`/api/admin/activity-backlog?${q}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.status === 401 || data.locked) {
        toastError("Locked — double-click System Control title and enter password");
        return;
      }
      if (!data.success) {
        toastError(data.error || "Could not load backlog");
        return;
      }
      setRows((data.rows || []) as Row[]);
      setTotal(Number(data.total) || 0);
    } catch {
      toastError("Network error loading backlog");
    } finally {
      setLoading(false);
    }
  }, [page, search, eventType, dateFrom, dateTo]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.galleryWrap}>
      <div className={styles.detailHeader}>
        {onBack ? (
          <button
            type="button"
            className={adminStyles.btnSecondary}
            onClick={onBack}
          >
            Hide
          </button>
        ) : (
          <span />
        )}
        <h2 className={adminStyles.title} style={{ margin: 0, fontSize: "1.25rem" }}>
          Backlog Tracker
        </h2>
        <button
          type="button"
          className={adminStyles.btnSecondary}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <p className={styles.tip} style={{ marginTop: 8 }}>
        Company-wide: every employee who logs into HRM is tracked — login,
        clock in/out, break/prayer/refreshment/meeting, face verify, clicks,
        page views, uploads and downloads (with file copies). Search by any
        name, code, or PC — not limited to one person.
      </p>

      <div className={styles.profileFilterBar} style={{ marginTop: 12 }}>
        <div className={`${styles.field} ${styles.profileSearchField}`}>
          <label htmlFor="bl-search">Search</label>
          <input
            id="bl-search"
            type="search"
            className={styles.profileSearchInput}
            value={search}
            placeholder="Name, pseudo, code, PC name, detail…"
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className={`${styles.field} ${styles.profileDeptField}`}>
          <label htmlFor="bl-type">Event</label>
          <select
            id="bl-type"
            value={eventType}
            onChange={(e) => {
              setPage(1);
              setEventType(e.target.value);
            }}
          >
            <option value="">All events</option>
            {EVENT_TYPES.filter(Boolean).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="bl-from">From</label>
          <input
            id="bl-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="bl-to">To</label>
          <input
            id="bl-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
          />
        </div>
      </div>

      <p className={styles.tip}>
        Showing {rows.length} of {total} event{total === 1 ? "" : "s"}
        {totalPages > 1 ? ` · page ${page}/${totalPages}` : ""}
      </p>

      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table className={adminStyles.table || undefined} style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "8px 6px" }}>Date / time</th>
              <th style={{ padding: "8px 6px" }}>Event</th>
              <th style={{ padding: "8px 6px" }}>Employee</th>
              <th style={{ padding: "8px 6px" }}>PC name</th>
              <th style={{ padding: "8px 6px" }}>Detail</th>
              <th style={{ padding: "8px 6px" }}>Page / URL</th>
              <th style={{ padding: "8px 6px" }}>Saved file</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 16 }} className={styles.tip}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 16 }} className={styles.tip}>
                  No backlog events for this filter yet. Ask any employee to
                  log in / clock in on HRM, then Refresh.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}
                >
                  <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                    {formatDateTimeInServerTz(r.event_ts)}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    <strong>{r.event_type}</strong>
                    {r.method ? ` · ${r.method}` : ""}
                    {r.file_name ? (
                      <div className={styles.tip} style={{ margin: 0 }}>
                        {r.file_name}
                        {r.file_bytes != null ? ` (${r.file_bytes} B)` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    <div>{r.employee_name || r.login_id || "—"}</div>
                    <div className={styles.tip} style={{ margin: 0 }}>
                      {[
                        r.employee_id ? `ID ${r.employee_id}` : null,
                        r.pseudonym ? `P: ${r.pseudonym}` : null,
                        r.employee_code ? `Code ${r.employee_code}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </td>
                  <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                    {r.hostname || "—"}
                    {r.ip ? (
                      <div className={styles.tip} style={{ margin: 0 }}>
                        IP {r.ip}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 6px", maxWidth: 360 }}>
                    {r.detail || "—"}
                  </td>
                  <td style={{ padding: "8px 6px", maxWidth: 280, wordBreak: "break-all" }}>
                    {r.page_path || "—"}
                    {r.url && r.url !== r.page_path ? (
                      <div className={styles.tip} style={{ margin: 0 }}>
                        {r.url}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                    {r.saved_path ? (
                      <a
                        href={`/api/admin/activity-backlog/file?id=${r.id}`}
                        className={adminStyles.btnSecondary}
                        style={{
                          display: "inline-block",
                          padding: "4px 10px",
                          fontSize: 12,
                          textDecoration: "none",
                        }}
                      >
                        Open file
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className={styles.durationRow} style={{ marginTop: 12 }}>
          <button
            type="button"
            className={adminStyles.btnSecondary}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
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
