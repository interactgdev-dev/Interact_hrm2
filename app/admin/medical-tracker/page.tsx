"use client";

import React from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../employee-files/employee-files.module.css";

type Col = { key: string; label: string };

type Balance = {
  employeeId: number;
  employeeName: string;
  status: string;
  medicalStartMonth: string | null;
  opdTier: string | null;
  annualOpdLimit: number | null;
  opdApproved: number;
  opdRemaining: number | null;
  ipdApproved: number;
  ipdRemaining: number | null;
  budgetExceeded: boolean;
};

type Row = Record<string, unknown> & {
  assignmentId: number;
  employeeId: number;
  employeeName: string;
  submittedAt: string | null;
  budgetExceeded?: boolean;
  budgetExceedTicket?: unknown;
};

type Tab = "balances" | "subscriptions" | "claims";

const META_KEYS = new Set([
  "assignmentId",
  "employeeId",
  "employeeName",
  "submittedAt",
  "status",
  "budgetExceeded",
  "budgetExceedTicket",
]);

const SKIP_DETAIL_KEYS = new Set([
  ...META_KEYS,
  "employee_name",
  "employee_id",
  "section_1",
  "section_2",
  "section_3",
  "section_5",
  "section_6",
  "section_2a",
  "section_2b",
  "section_4",
]);

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString();
}

function cell(v: unknown): React.ReactNode {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.file_name || o.file_path || o.documentId) {
      const name = String(o.file_name || "PDF");
      const docId = Number(o.documentId || 0);
      const path = String(o.file_path || "");
      return (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          style={{ padding: "6px 12px", fontSize: 12 }}
          onClick={() => {
            if (docId > 0) {
              window.open(
                `/api/employee-documents/${docId}?action=preview`,
                "_blank",
                "noopener,noreferrer"
              );
            } else if (path) {
              window.open(path, "_blank", "noopener,noreferrer");
            }
          }}
        >
          Open PDF — {name}
        </button>
      );
    }
    if (Array.isArray(v)) return v.map(String).filter(Boolean).join(", ") || "—";
    return JSON.stringify(v);
  }
  return String(v);
}

function labelFor(key: string, columns: Col[]) {
  return columns.find((c) => c.key === key)?.label || key.replace(/_/g, " ");
}

function summaryBits(row: Row, kind: "subscriptions" | "claims") {
  if (kind === "subscriptions") {
    return [
      { label: "OPD tier", value: row.opd_plan_tier },
      { label: "Coverage", value: row.coverage_requested },
      { label: "Dept", value: row.department },
      { label: "Mobile", value: row.mobile_number },
    ];
  }
  return [
    { label: "Patient", value: row.patient_full_name || row.patient_is },
    { label: "Type", value: row.claim_type },
    {
      label: "Amount",
      value: row.opd_total_amount || row.ipd_total_amount || "—",
    },
    { label: "Clinic / hospital", value: row.opd_doctor_clinic || row.ipd_hospital_name },
  ];
}

export default function MedicalTrackerPage() {
  const [tab, setTab] = React.useState<Tab>("balances");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [policyLabel, setPolicyLabel] = React.useState("");
  const [balances, setBalances] = React.useState<Balance[]>([]);
  const [subscriptions, setSubscriptions] = React.useState<Row[]>([]);
  const [claims, setClaims] = React.useState<Row[]>([]);
  const [subscriptionColumns, setSubscriptionColumns] = React.useState<Col[]>([]);
  const [claimColumns, setClaimColumns] = React.useState<Col[]>([]);
  const [detail, setDetail] = React.useState<{ row: Row; columns: Col[]; kind: string } | null>(
    null
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/medical-tracker", { cache: "no-store" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Load failed");
      setPolicyLabel(data.policyYear?.label || "");
      setBalances(data.balances || []);
      setSubscriptions(data.subscriptions || []);
      setClaims(data.claims || []);
      setSubscriptionColumns(data.subscriptionColumns || []);
      setClaimColumns(data.claimColumns || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const qq = q.trim().toLowerCase();

  const filteredBalances = balances.filter((b) => {
    if (!qq) return true;
    return (
      b.employeeName.toLowerCase().includes(qq) ||
      String(b.employeeId).includes(qq) ||
      String(b.opdTier || "").toLowerCase().includes(qq)
    );
  });

  const filteredSubs = subscriptions.filter((r) => {
    if (!qq) return true;
    return (
      String(r.employeeName || "").toLowerCase().includes(qq) ||
      String(r.employeeId || "").includes(qq) ||
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(qq))
    );
  });

  const filteredClaims = claims.filter((r) => {
    if (!qq) return true;
    return (
      String(r.employeeName || "").toLowerCase().includes(qq) ||
      String(r.employeeId || "").includes(qq) ||
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(qq))
    );
  });

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner} style={{ maxWidth: 1100 }}>
          <header className={styles.header}>
            <h1 className={styles.title}>Medical Tracker</h1>
            <p className={styles.subtitle}>
              Subscription + claim submissions. OPD/IPD balances vs plan limits
              {policyLabel ? ` · Policy year ${policyLabel}` : ""}. Budget exceed rows are marked
              red and open an HR ticket.
            </p>
          </header>

          <div className={styles.tabs}>
            {(
              [
                ["balances", "OPD/IPD by Employees"],
                ["subscriptions", "Subscriptions"],
                ["claims", "Claim Responses"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${styles.tab} ${tab === id ? styles.tabActive : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
            <button type="button" className={styles.btn} onClick={() => void load()} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className={styles.toolbar}>
            <input
              className={styles.search}
              placeholder="Search employee, ID, plan…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {error ? <div className={`${styles.alert} ${styles.alertError}`}>{error}</div> : null}

          {loading ? (
            <div className={styles.empty}>Loading medical data…</div>
          ) : tab === "balances" ? (
            <BalancesTable rows={filteredBalances} />
          ) : tab === "subscriptions" ? (
            <ResponseList
              rows={filteredSubs}
              columns={subscriptionColumns}
              kind="subscriptions"
              empty="No subscription submissions yet."
              onOpen={(row) =>
                setDetail({ row, columns: subscriptionColumns, kind: "Subscription" })
              }
            />
          ) : (
            <ResponseList
              rows={filteredClaims}
              columns={claimColumns}
              kind="claims"
              empty="No claim submissions yet."
              highlightExceed
              onOpen={(row) => setDetail({ row, columns: claimColumns, kind: "Claim" })}
            />
          )}
        </div>
      </div>

      {detail ? (
        <div
          className={styles.modalBackdrop}
          onClick={() => setDetail(null)}
          role="presentation"
        >
          <div
            className={styles.modal}
            style={{ maxWidth: 640, maxHeight: "88vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <h2 className={styles.modalTitle}>
              {detail.kind}: {detail.row.employeeName}
            </h2>
            <p className={styles.modalMeta}>
              Emp ID {detail.row.employeeId} · #{detail.row.assignmentId} · Submitted{" "}
              {detail.row.submittedAt
                ? new Date(String(detail.row.submittedAt)).toLocaleString()
                : "—"}
              {detail.row.budgetExceeded ? " · BUDGET EXCEED" : ""}
            </p>

            <div className={styles.responseList}>
              {detail.columns
                .filter((c) => c.key && !SKIP_DETAIL_KEYS.has(c.key) && !/^section_/i.test(c.key))
                .map((c) => {
                  const raw = detail.row[c.key];
                  if (raw == null || raw === "") return null;
                  return (
                    <div key={c.key} className={styles.responseRow}>
                      <div className={styles.responseLabel}>{c.label || c.key}</div>
                      <div className={styles.responseValue}>{cell(raw)}</div>
                    </div>
                  );
                })}
              {/* Any leftover non-empty keys not in schema columns */}
              {Object.entries(detail.row)
                .filter(([k, v]) => {
                  if (SKIP_DETAIL_KEYS.has(k) || /^section_/i.test(k) || /^family_\d+_add_another$/i.test(k)) {
                    return false;
                  }
                  if (detail.columns.some((c) => c.key === k)) return false;
                  return v != null && v !== "";
                })
                .map(([k, v]) => (
                  <div key={k} className={styles.responseRow}>
                    <div className={styles.responseLabel}>{labelFor(k, detail.columns)}</div>
                    <div className={styles.responseValue}>{cell(v)}</div>
                  </div>
                ))}
            </div>

            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </OptionalAdminShell>
  );
}

function BalancesTable({ rows }: { rows: Balance[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.tableWrap} style={{ overflowX: "auto" }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Employee</th>
              <th>OPD tier</th>
              <th>OPD limit</th>
              <th>OPD used</th>
              <th>OPD left</th>
              <th>IPD used</th>
              <th>IPD left</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  No subscribed employees yet.
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const over =
                  b.budgetExceeded ||
                  (b.opdRemaining != null && b.opdRemaining < 0) ||
                  (b.ipdRemaining != null && b.ipdRemaining < 0);
                return (
                  <tr
                    key={b.employeeId}
                    style={
                      over
                        ? { background: "#fee2e2", color: "#991b1b", fontWeight: 600 }
                        : undefined
                    }
                  >
                    <td>
                      <div style={{ fontWeight: 700 }}>{b.employeeName}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        ID {b.employeeId}
                        {b.medicalStartMonth ? ` · start ${b.medicalStartMonth}` : ""}
                      </div>
                    </td>
                    <td>{b.opdTier || "—"}</td>
                    <td>{money(b.annualOpdLimit)}</td>
                    <td>{money(b.opdApproved)}</td>
                    <td>{money(b.opdRemaining)}</td>
                    <td>{money(b.ipdApproved)}</td>
                    <td>{money(b.ipdRemaining)}</td>
                    <td>{over ? "BUDGET EXCEED" : "OK"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResponseList({
  rows,
  columns,
  kind,
  empty,
  onOpen,
  highlightExceed,
}: {
  rows: Row[];
  columns: Col[];
  kind: "subscriptions" | "claims";
  empty: string;
  onOpen: (r: Row) => void;
  highlightExceed?: boolean;
}) {
  if (rows.length === 0) {
    return <div className={styles.empty}>{empty}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) => {
        const over = Boolean(r.budgetExceeded);
        const bits = summaryBits(r, kind);
        return (
          <div
            key={r.assignmentId}
            className={styles.panel}
            style={{
              padding: "16px 18px",
              borderColor: highlightExceed && over ? "#fecaca" : undefined,
              background: highlightExceed && over ? "#fef2f2" : undefined,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "flex-start",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 750, color: "#0f172a" }}>
                  {r.employeeName}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>
                  Emp ID {r.employeeId} · #{r.assignmentId} ·{" "}
                  {r.submittedAt
                    ? new Date(String(r.submittedAt)).toLocaleString()
                    : "No submit time"}
                  {highlightExceed && over
                    ? ` · EXCEED${r.budgetExceedTicket ? ` ${r.budgetExceedTicket}` : ""}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => onOpen(r)}
              >
                View full response
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 10,
                marginTop: 14,
              }}
            >
              {bits.map((b) => (
                <div
                  key={b.label}
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e8edf3",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "#94a3b8",
                      marginBottom: 4,
                    }}
                  >
                    {b.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", lineHeight: 1.35 }}>
                    {cell(b.value)}
                  </div>
                </div>
              ))}
            </div>

            {columns.some((c) => c.key === "documents_pdf") && r.documents_pdf ? (
              <div style={{ marginTop: 12 }}>{cell(r.documents_pdf)}</div>
            ) : null}
          </div>
        );
      })}
      <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
        {rows.length} response(s) · open a card for complete field list
      </p>
    </div>
  );
}
