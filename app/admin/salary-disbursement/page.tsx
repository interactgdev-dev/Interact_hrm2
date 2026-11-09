"use client";

import React, { useEffect, useMemo, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import fh from "../employee-financial-history/financial-history.module.css";
import finalizeModal from "../monthly-payroll/finalize-modal.module.css";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";

type BankFilter = "all" | "askari" | "other";
type BankGroup = "askari" | "other";

type DisbursementRecord = {
  employee_id: number;
  employee_name: string;
  first_name?: string;
  last_name?: string;
  pseudonym?: string;
  employee_code?: string;
  department_name?: string;
  bank_name: string;
  account_number: string;
  bank_group: BankGroup;
  amount: number;
  status: "paid" | "unpaid";
};

const money = (n: number) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

function statusStyle(status: string, bankGroup: string): React.CSSProperties {
  const paid = String(status).toLowerCase() === "paid";
  if (paid && bankGroup === "askari") {
    return {
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      background: "#dbeafe",
      color: "#1d4ed8",
      border: "1px solid #93c5fd",
    };
  }
  if (paid) {
    return {
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      background: "#ffedd5",
      color: "#c2410c",
      border: "1px solid #fdba74",
    };
  }
  return {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: "#f1f5f9",
    color: "#475569",
    border: "1px solid #cbd5e1",
  };
}

export default function SalaryDisbursementPage() {
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const [bankFilter, setBankFilter] = useState<BankFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"" | "paid" | "unpaid">("");
  const [nameSearch, setNameSearch] = useState("");
  const [records, setRecords] = useState<DisbursementRecord[]>([]);
  const [summary, setSummary] = useState({
    total_employees: 0,
    paid_count: 0,
    unpaid_count: 0,
    paid_amount: 0,
    unpaid_amount: 0,
    total_amount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewerId, setViewerId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { type: "success" | "error"; message: string }>(
    null,
  );
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    try {
      const eid = String(localStorage.getItem("employeeId") || "").trim();
      setViewerId(/^\d+$/.test(eid) ? eid : "");
    } catch {
      setViewerId("");
    }
  }, []);

  const load = async () => {
    if (!viewerId) {
      setError("Finance employee login required.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/salary-disbursement?month=${encodeURIComponent(month)}&bank=${encodeURIComponent(bankFilter)}&viewerId=${encodeURIComponent(viewerId)}`,
        {
          cache: "no-store",
          headers: {
            "x-employee-id": viewerId,
            "x-hrm-employee-id": viewerId,
          },
        },
      );
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "Failed to load salary disbursement.");
        setRecords([]);
        return;
      }
      const rows: DisbursementRecord[] = Array.isArray(data.records) ? data.records : [];
      setRecords(rows);
      setSummary(
        data.summary || {
          total_employees: rows.length,
          paid_count: 0,
          unpaid_count: 0,
          paid_amount: 0,
          unpaid_amount: 0,
          total_amount: 0,
        },
      );
      // Default select: currently unpaid rows (ready to mark paid)
      setSelected(
        new Set(rows.filter((r) => r.status !== "paid").map((r) => r.employee_id)),
      );
    } catch {
      setError("Failed to load salary disbursement.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!viewerId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, month, bankFilter]);

  const filtered = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      const blob = [
        r.employee_name,
        r.pseudonym,
        r.employee_code,
        r.department_name,
        r.bank_name,
        r.account_number,
        String(r.employee_id),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [records, nameSearch, statusFilter]);

  const filteredIds = useMemo(
    () => filtered.map((r) => r.employee_id),
    [filtered],
  );

  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.employee_id)),
    [filtered, selected],
  );

  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [selectedRows],
  );

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmMark = async () => {
    if (!viewerId || !month) return;
    setBusy(true);
    setResult(null);
    try {
      const amounts: Record<string, number> = {};
      for (const r of records) amounts[String(r.employee_id)] = Number(r.amount) || 0;

      const groups: BankGroup[] =
        bankFilter === "all" ? ["askari", "other"] : [bankFilter];

      let paidCount = 0;
      let unpaidCount = 0;
      let paidAmount = 0;
      const messages: string[] = [];

      for (const group of groups) {
        const inGroup = records.filter((r) => r.bank_group === group);
        if (!inGroup.length) continue;
        const selectedIds = inGroup
          .filter((r) => selected.has(r.employee_id))
          .map((r) => r.employee_id);

        const res = await fetch("/api/salary-disbursement", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-employee-id": viewerId,
            "x-hrm-employee-id": viewerId,
          },
          body: JSON.stringify({
            month,
            bank_group: group,
            selected_ids: selectedIds,
            amounts,
            viewer_id: Number(viewerId),
          }),
        });
        const data = await res.json();
        if (!data.success) {
          setResult({
            type: "error",
            message: data.message || "Failed to update salary paid status.",
          });
          return;
        }
        paidCount += Number(data.paid_count) || 0;
        unpaidCount += Number(data.unpaid_count) || 0;
        paidAmount += Number(data.paid_amount) || 0;
        if (data.message) messages.push(String(data.message));
      }

      setResult({
        type: "success",
        message:
          messages.join(" ") ||
          `Updated: ${paidCount} Salary Paid (total ${money(paidAmount)}), ${unpaidCount} Unpaid.`,
      });
      await load();
    } catch {
      setResult({
        type: "error",
        message: "Failed to update salary paid status.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <OptionalAdminShell>
      <div className={fh.page}>
        <div className={fh.hero}>
          <h1 className={fh.heroTitle}>Salary Disbursement</h1>
          <p className={fh.heroSub}>
            Finance bank transfer tracker — amounts come from Monthly Payroll Final Salary for the
            selected month. Filter Askari vs Other banks, select employees, confirm total, then mark
            Salary Paid / Unpaid.
          </p>
        </div>

        <div className={fh.panel}>
          <div
            className={fh.filters}
            style={{
              gridTemplateColumns:
                "140px minmax(160px,1fr) 150px 160px auto auto",
            }}
          >
            <div className={fh.field}>
              <label className={fh.label}>Month</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={fh.input}
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Search</label>
              <input
                type="text"
                placeholder="Name, bank, account…"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                className={fh.input}
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Bank filter</label>
              <select
                value={bankFilter}
                onChange={(e) => setBankFilter(e.target.value as BankFilter)}
                className={fh.select}
              >
                <option value="all">All banks</option>
                <option value="askari">Askari account holders</option>
                <option value="other">Other banks</option>
              </select>
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "" | "paid" | "unpaid")
                }
                className={fh.select}
              >
                <option value="">All</option>
                <option value="paid">Salary Paid</option>
                <option value="unpaid">Salary Unpaid</option>
              </select>
            </div>
            <button type="button" className={fh.clearBtn} onClick={() => void load()}>
              Refresh
            </button>
            <button
              type="button"
              className={fh.primaryBtn || fh.clearBtn}
              style={{
                background: "linear-gradient(135deg,#611f69,#4a1850)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "10px 14px",
                fontWeight: 700,
                cursor: selected.size ? "pointer" : "not-allowed",
                opacity: selected.size ? 1 : 0.55,
              }}
              disabled={!selected.size}
              onClick={() => {
                setResult(null);
                setModalOpen(true);
              }}
            >
              Mark Salary Paid
            </button>
          </div>
        </div>

        <div className={fh.cards}>
          <div className={fh.card}>
            <div className={fh.cardLabel}>In filter</div>
            <div className={fh.cardValue}>{filtered.length}</div>
          </div>
          <div className={fh.card}>
            <div className={fh.cardLabel}>Selected</div>
            <div className={fh.cardValue}>{selectedRows.length}</div>
          </div>
          <div className={fh.card}>
            <div className={fh.cardLabel}>Selected total</div>
            <div className={fh.cardValue}>{money(selectedTotal)}</div>
          </div>
          <div className={fh.card}>
            <div className={fh.cardLabel}>Paid (filter)</div>
            <div className={fh.cardValue}>
              {summary.paid_count} · {money(summary.paid_amount)}
            </div>
          </div>
        </div>

        {error ? (
          <div className={fh.panel} style={{ color: "#b91c1c" }}>
            {error}
          </div>
        ) : null}

        <div className={fh.panel} style={{ padding: 0, overflow: "hidden" }}>
          <div className={fh.tableWrap}>
            <table className={fh.table}>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Bank name</th>
                  <th>Account number</th>
                  <th>Final Salary</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 28 }}>
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 28 }}>
                      No employees in this bank filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.employee_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(row.employee_id)}
                          onChange={() => toggleOne(row.employee_id)}
                          aria-label={`Select ${row.employee_name}`}
                        />
                      </td>
                      <td>
                        <EmployeeTableNameCell
                          employeeId={row.employee_id}
                          name={row.employee_name}
                          photo={getPhoto(row.employee_id)}
                          onOpen={() =>
                            openFromRow({
                              employee_id: row.employee_id,
                              employee_name: row.employee_name,
                              first_name: row.first_name,
                              last_name: row.last_name,
                              pseudonym: row.pseudonym,
                              department_name: row.department_name,
                            })
                          }
                        />
                      </td>
                      <td>{row.department_name || "—"}</td>
                      <td>{row.bank_name || "—"}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace" }}>
                        {row.account_number || "—"}
                      </td>
                      <td style={{ fontWeight: 700 }}>{money(row.amount)}</td>
                      <td>
                        <span style={statusStyle(row.status, row.bank_group)}>
                          {row.status === "paid" ? "Salary Paid" : "Salary Unpaid"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div className={finalizeModal.overlay} role="dialog" aria-modal="true">
          <div className={finalizeModal.card}>
            <div className={finalizeModal.header}>
              <div className={finalizeModal.iconWrap}>
                {result?.type === "error" ? (
                  <FaExclamationTriangle />
                ) : (
                  <FaCheckCircle />
                )}
              </div>
              <h2 className={finalizeModal.title}>
                {result
                  ? result.type === "success"
                    ? "Salary Status Updated"
                    : "Could Not Update"
                  : "Confirm Salary Disbursement"}
              </h2>
              <p className={finalizeModal.subtitle}>
                {result
                  ? result.type === "success"
                    ? "Statuses saved for this bank filter."
                    : "Please try again."
                  : `${
                      bankFilter === "all"
                        ? "All banks"
                        : bankFilter === "askari"
                          ? "Askari"
                          : "Other banks"
                    } · ${month}`}
              </p>
            </div>
            <div className={finalizeModal.body}>
              {!result ? (
                <>
                  <p className={finalizeModal.note}>
                    Selected employees will be marked <strong>Salary Paid</strong>. Unchecked
                    employees in this bank filter will be marked <strong>Salary Unpaid</strong>.
                  </p>
                  <ul className={finalizeModal.list} style={{ marginTop: 14 }}>
                    <li>
                      <span className={finalizeModal.bullet} />
                      <span>
                        Selected employees: <strong>{selectedRows.length}</strong>
                      </span>
                    </li>
                    <li>
                      <span className={finalizeModal.bullet} />
                      <span>
                        Total amount: <strong>{money(selectedTotal)}</strong>
                      </span>
                    </li>
                    <li>
                      <span className={finalizeModal.bullet} />
                      <span>
                        Unchecked in filter:{" "}
                        <strong>{Math.max(0, records.length - selected.size)}</strong>
                      </span>
                    </li>
                  </ul>
                </>
              ) : result.type === "success" ? (
                <p className={finalizeModal.successBox}>{result.message}</p>
              ) : (
                <p className={finalizeModal.errorBox}>{result.message}</p>
              )}
            </div>
            <div className={finalizeModal.actions}>
              {!result ? (
                <>
                  <button
                    type="button"
                    className={finalizeModal.btnGhost}
                    disabled={busy}
                    onClick={() => setModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={finalizeModal.btnPrimary}
                    disabled={busy}
                    onClick={() => void confirmMark()}
                  >
                    {busy ? "Updating…" : "Confirm & Mark Paid"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={
                    result.type === "success"
                      ? finalizeModal.btnSuccess
                      : finalizeModal.btnPrimary
                  }
                  onClick={() => setModalOpen(false)}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {popup}
    </OptionalAdminShell>
  );
}
