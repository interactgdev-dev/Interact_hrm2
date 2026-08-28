"use client";

import React from "react";
import adminStyles from "../admin-page.module.css";
import styles from "./presence-idle.module.css";
import { toastError, toastSuccess } from "@/lib/app-toast";

type AgentHealth = "healthy" | "stale" | "offline";

type AgentRow = {
  id: number;
  machineId: string;
  hostname: string | null;
  windowsUser: string | null;
  hrmBaseUrl: string | null;
  localEmployeeId: string | null;
  assignedEmployeeId: string | null;
  agentVersion: string | null;
  lastIp: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  health: AgentHealth;
  assignedEmployeeName: string | null;
  assignedEmployeeCode: string | null;
};

type AgentSummary = {
  total: number;
  healthy: number;
  stale: number;
  offline: number;
  withAssignedId: number;
  withLocalId: number;
};

type EmpRow = {
  id: number;
  first_name?: string;
  last_name?: string;
  employee_code?: string | null;
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function healthLabel(h: AgentHealth) {
  if (h === "healthy") return "Active";
  if (h === "stale") return "Stale";
  return "Offline";
}

function empLabel(e: EmpRow) {
  const name =
    `${e.first_name || ""} ${e.last_name || ""}`.trim() || `Employee ${e.id}`;
  const code = e.employee_code ? ` · ${e.employee_code}` : "";
  return `${name} (ID ${e.id})${code}`;
}

type Props = {
  employees: EmpRow[];
};

export default function PresenceAgentsPanel({ employees }: Props) {
  const [agents, setAgents] = React.useState<AgentRow[]>([]);
  const [summary, setSummary] = React.useState<AgentSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/presence-agents", { cache: "no-store" });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Could not load agents");
        return;
      }
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      setSummary(data.summary ?? null);
      const next: Record<string, string> = {};
      for (const a of data.agents as AgentRow[]) {
        next[a.machineId] = a.assignedEmployeeId ?? "";
      }
      setDrafts(next);
    } catch {
      toastError("Network error loading agents");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  async function queueCommand(command: "restart" | "exit", opts?: { machineId?: string; all?: boolean }) {
    try {
      const res = await fetch("/api/admin/presence-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          all: opts?.all ?? false,
          machine_id: opts?.machineId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Command failed");
        return;
      }
      toastSuccess(data.message || "Command queued");
      await load();
    } catch {
      toastError("Network error sending command");
    }
  }

  async function saveAssignment(machineId: string) {
    setSavingId(machineId);
    try {
      const draft = drafts[machineId] ?? "";
      const res = await fetch("/api/admin/presence-agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machine_id: machineId,
          assigned_employee_id: draft.trim() || null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Save failed");
        return;
      }
      toastSuccess("Employee ID assigned — agent picks it up within ~15s.");
      await load();
    } catch {
      toastError("Network error saving assignment");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className={adminStyles.card}>
      <div className={styles.agentsHeader}>
        <div>
          <h2 className={styles.agentsTitle}>Installed agents</h2>
          <p className={styles.tip} style={{ marginTop: 4 }}>
            PCs register automatically when InteractPresence v0.5.0+ runs. Assign Employee ID
            here — no need to visit each PC. Agents self-update when you publish a newer exe.
          </p>
        </div>
        <div className={styles.agentsHeaderActions}>
          <button type="button" className={styles.chip} onClick={() => void load()}>
            Refresh
          </button>
          <button
            type="button"
            className={styles.chip}
            disabled={!summary?.total}
            onClick={() => void queueCommand("restart", { all: true })}
          >
            Restart all
          </button>
          <button
            type="button"
            className={`${styles.chip} ${styles.chipDanger}`}
            disabled={!summary?.total}
            onClick={() => void queueCommand("exit", { all: true })}
          >
            Exit all
          </button>
        </div>
      </div>

      {summary ? (
        <div className={styles.statsRow}>
          <span className={styles.stat}>
            Total <strong>{summary.total}</strong>
          </span>
          <span className={`${styles.stat} ${styles.statHealthy}`}>
            Active <strong>{summary.healthy}</strong>
          </span>
          <span className={`${styles.stat} ${styles.statStale}`}>
            Stale <strong>{summary.stale}</strong>
          </span>
          <span className={`${styles.stat} ${styles.statOffline}`}>
            Offline <strong>{summary.offline}</strong>
          </span>
          <span className={styles.stat}>
            Admin ID set <strong>{summary.withAssignedId}</strong>
          </span>
          <span className={styles.stat}>
            Local ID <strong>{summary.withLocalId}</strong>
          </span>
        </div>
      ) : null}

      {loading ? (
        <p className={styles.loading}>Loading agents…</p>
      ) : agents.length === 0 ? (
        <p className={styles.tip}>
          No agents registered yet. Publish agent <strong>0.5.0</strong> below — existing installs
          auto-update within ~15 minutes, then appear here.
        </p>
      ) : (
        <div className={styles.agentsTableWrap}>
          <table className={styles.agentsTable}>
            <thead>
              <tr>
                <th>Status</th>
                <th>PC</th>
                <th>HRM URL</th>
                <th>Local ID</th>
                <th>Assign employee</th>
                <th>Version</th>
                <th>Last seen</th>
                <th>IP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.machineId}>
                  <td>
                    <span
                      className={`${styles.healthBadge} ${styles[`health_${a.health}`]}`}
                    >
                      {healthLabel(a.health)}
                    </span>
                  </td>
                  <td>
                    <div className={styles.pcCell}>
                      <strong>{a.hostname || "Unknown PC"}</strong>
                      <span className={styles.empMeta}>{a.windowsUser || "—"}</span>
                    </div>
                  </td>
                  <td className={styles.urlCell} title={a.hrmBaseUrl || ""}>
                    {a.hrmBaseUrl || "—"}
                  </td>
                  <td>{a.localEmployeeId || "—"}</td>
                  <td>
                    <select
                      className={styles.select}
                      value={drafts[a.machineId] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [a.machineId]: e.target.value }))
                      }
                    >
                      <option value="">— Not assigned —</option>
                      {employees.map((e) => (
                        <option key={e.id} value={String(e.id)}>
                          {empLabel(e)}
                        </option>
                      ))}
                    </select>
                    {a.assignedEmployeeName ? (
                      <span className={styles.empMeta}>Current: {a.assignedEmployeeName}</span>
                    ) : null}
                  </td>
                  <td>{a.agentVersion || "—"}</td>
                  <td>{formatWhen(a.lastSeenAt)}</td>
                  <td>{a.lastIp || "—"}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.chip}
                        disabled={savingId === a.machineId}
                        onClick={() => void saveAssignment(a.machineId)}
                      >
                        {savingId === a.machineId ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className={styles.chip}
                        onClick={() => void queueCommand("restart", { machineId: a.machineId })}
                      >
                        Restart
                      </button>
                      <button
                        type="button"
                        className={`${styles.chip} ${styles.chipDanger}`}
                        onClick={() => void queueCommand("exit", { machineId: a.machineId })}
                      >
                        Exit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
