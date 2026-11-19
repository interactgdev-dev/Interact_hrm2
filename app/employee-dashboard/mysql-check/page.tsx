"use client";

import React, { useCallback, useEffect, useState } from "react";
import styles from "./mysql-check.module.css";

type HealthRow = {
  id: number;
  employee_id?: string | null;
  employee_name?: string | null;
  note?: string;
  created_at?: string;
};

type HealthPayload = {
  ok: boolean;
  driver?: string;
  db?: string;
  table?: string;
  ping?: boolean;
  total?: number;
  rows?: HealthRow[];
  error?: string;
};

export default function MysqlCheckPage() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/mysql-health", { cache: "no-store" });
    const json = (await res.json()) as HealthPayload;
    setData(json);
    if (!json.ok) setError(json.error || "MySQL check failed");
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  const writeRow = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/mysql-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: localStorage.getItem("employeeId") || localStorage.getItem("loginId") || "",
          employee_name: localStorage.getItem("employeeName") || "Employee",
          note: "Dummy page write from employee dashboard (staging MySQL)",
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Write failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>MySQL DB check</h1>
        <p className={styles.sub}>
          Dummy page for staging (10.6). Writes go to table <code>hrm_mysql_health</code> — not
          attendance data.
        </p>

        <div className={styles.meta}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Driver</span>
            <span className={`${styles.metaValue} ${data?.driver === "mysql" ? styles.ok : styles.bad}`}>
              {data?.driver || "…"}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Ping</span>
            <span className={`${styles.metaValue} ${data?.ping ? styles.ok : styles.bad}`}>
              {data?.ping ? "OK" : data ? "FAIL" : "…"}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Database</span>
            <span className={styles.metaValue}>{data?.db || "—"}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Table</span>
            <span className={styles.metaValue}>{data?.table || "hrm_mysql_health"}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Rows</span>
            <span className={styles.metaValue}>{data?.total ?? "—"}</span>
          </div>
        </div>

        {error ? <p className={styles.err}>{error}</p> : null}

        <div className={styles.row}>
          <button type="button" className={styles.btn} onClick={writeRow} disabled={busy}>
            {busy ? "Writing…" : "Write test row"}
          </button>
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => load()} disabled={busy}>
            Refresh
          </button>
        </div>

        <div className={styles.tableWrap}>
          {!data?.rows?.length ? (
            <div className={styles.empty}>No test rows yet. Click Write test row.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Employee</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
                    <td>
                      {row.employee_name || "—"}
                      {row.employee_id ? ` (${row.employee_id})` : ""}
                    </td>
                    <td>{row.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
