"use client";

import React, { useCallback, useEffect, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import { toastError, toastSuccess } from "@/lib/app-toast";

type PendingRow = {
  employee_id: number;
  employee_name: string;
  department_name: string | null;
  joined_date: string;
  cycle: string;
  cycle_label: string;
  due_date: string;
  due_after_months: number;
  has_open_assignment: boolean;
};

export default function PendingAppraisalsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/appraisals/pending", { cache: "no-store" });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Failed to load");
        setRows([]);
        return;
      }
      setRows(Array.isArray(data.pending) ? data.pending : []);
    } catch {
      toastError("Failed to load pending appraisals");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendForm = async (row: PendingRow) => {
    const key = `${row.employee_id}-${row.cycle}`;
    setSendingId(key);
    try {
      const res = await fetch("/api/appraisals/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: row.employee_id,
          cycle: row.cycle,
          assigned_by: "hr",
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Send failed");
        return;
      }
      toastSuccess(data.message || "Form sent to employee My Files");
      await load();
    } catch {
      toastError("Send failed");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <OptionalAdminShell>
      <div className={styles.breakSummaryContainer}>
        <div style={{ marginBottom: 20 }}>
          <h1 className={styles.pageTitle}>Pending Appraisals</h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            1st from joining (3/6 mo). From 2nd onward the same interval repeats (7/8/annual) —
            e.g. 2nd at 8 mo → 3rd at +8 mo again. Send form → employee My Files (HR Issued).
          </p>
        </div>

        <div className={styles.breakSummaryTableWrapper}>
          <table className={styles.breakSummaryTable} style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Joined</th>
                <th>Appraisal</th>
                <th>Due date</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className={styles.breakSummaryNoRecords}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.breakSummaryNoRecords}>
                    No appraisals due right now.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const key = `${row.employee_id}-${row.cycle}`;
                  return (
                    <tr key={key}>
                      <td style={{ fontWeight: 600 }}>{row.employee_name}</td>
                      <td>{row.department_name || "—"}</td>
                      <td>{row.joined_date}</td>
                      <td>{row.cycle_label}</td>
                      <td style={{ color: "#dc2626", fontWeight: 600 }}>{row.due_date}</td>
                      <td>
                        {row.has_open_assignment ? (
                          <span style={{ color: "#b45309", fontWeight: 600 }}>HR Issued</span>
                        ) : (
                          <span style={{ color: "#dc2626", fontWeight: 600 }}>Due</span>
                        )}
                      </td>
                      <td>
                        {row.has_open_assignment ? (
                          <span style={{ color: "#64748b", fontSize: 13 }}>Already sent</span>
                        ) : (
                          <button
                            type="button"
                            className={styles.breakSummaryBtn}
                            disabled={sendingId === key}
                            onClick={() => void sendForm(row)}
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {sendingId === key ? "Sending…" : "Send Appraisal Form"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </OptionalAdminShell>
  );
}
