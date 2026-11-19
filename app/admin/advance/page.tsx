"use client";
import React, { useEffect, useMemo, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import fh from "./advance.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";

const money = (n: number) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

export default function AdvancePage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const [amountInputs, setAmountInputs] = useState<{ [key: string]: string }>({});
  const [statusByEmployee, setStatusByEmployee] = useState<{ [key: string]: string }>({});
  const [saving, setSaving] = useState<{ [key: string]: boolean }>({});
  const [successMsg, setSuccessMsg] = useState("");
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const statusPillClass = (status: string) => {
    const s = String(status || "active").toLowerCase();
    if (s === "paid") return fh.statusPaid;
    if (s === "cancelled") return fh.statusCancelled;
    return fh.statusActive;
  };

  const formatStatus = (status: string) => {
    const s = String(status || "active").trim();
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  };

  const getFullName = (emp: any) =>
    `${emp.first_name || ""} ${emp.middle_name || ""} ${emp.last_name || ""}`
      .replace(/\s+/g, " ")
      .trim();

  const reload = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/employee-list").then((res) => res.json()),
      fetch(`/api/advance-salary?month=${month}`).then((res) => res.json()),
    ])
      .then(([empData, advData]) => {
        if (empData.success) {
          setEmployees(empData.employees);
          setError("");
        } else {
          setError(empData.error || "Failed to fetch employees");
        }
        if (advData.success && Array.isArray(advData.records)) {
          type AdvanceRecord = {
            employee_id: string | number;
            advance_amount: string | number;
            status?: string;
          };
          const advMap: { [key: string]: string } = {};
          const stMap: { [key: string]: string } = {};
          (advData.records as AdvanceRecord[]).forEach((rec) => {
            const key = String(rec.employee_id);
            if (advMap[key] === undefined) advMap[key] = String(rec.advance_amount);
            stMap[key] = String(rec.status || "active").toLowerCase();
          });
          setAmountInputs(advMap);
          setStatusByEmployee(stMap);
        } else {
          setStatusByEmployee({});
        }
      })
      .catch(() => {
        setError("Failed to fetch employees or advance salary");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when month changes
  }, [month]);

  const uniqueDepartments = Array.from(
    new Set(employees.map((e) => e.department_name).filter(Boolean)),
  );

  const filtered = employees.filter((emp) => {
    const searchLower = search.toLowerCase();
    const matchesSearch =
      !search ||
      (emp.employee_code || emp.id || "").toString().includes(searchLower) ||
      (
        emp.first_name +
        " " +
        (emp.middle_name || "") +
        " " +
        (emp.last_name || "")
      )
        .toLowerCase()
        .includes(searchLower) ||
      (emp.pseudonym || "").toLowerCase().includes(searchLower);
    const matchesDept = !departmentFilter || emp.department_name === departmentFilter;
    return matchesSearch && matchesDept;
  });

  const summary = useMemo(() => {
    let withAdvance = 0;
    let active = 0;
    let paid = 0;
    let totalAmount = 0;
    for (const emp of filtered) {
      const key = String(emp.id);
      const raw = String(amountInputs[emp.id] ?? "").trim();
      if (!raw) continue;
      const amt = Number(raw);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      withAdvance += 1;
      totalAmount += amt;
      const st = String(statusByEmployee[key] || "active").toLowerCase();
      if (st === "paid") paid += 1;
      else active += 1;
    }
    return { withAdvance, active, paid, totalAmount, employees: filtered.length };
  }, [filtered, amountInputs, statusByEmployee]);

  const handleSave = async (emp: any) => {
    setSaving((prev) => ({ ...prev, [emp.id]: true }));
    setSuccessMsg("");
    setError("");
    const rawAmount = amountInputs[emp.id];
    const advanceAmount =
      rawAmount === undefined || rawAmount === null ? "" : String(rawAmount).trim();
    try {
      const res = await fetch("/api/advance-salary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: emp.id,
          employee_name: `${emp.first_name} ${emp.middle_name || ""} ${emp.last_name || ""}`.trim(),
          pseudonym: emp.pseudonym || null,
          department: emp.department_name,
          advance_amount: advanceAmount,
          month,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (advanceAmount === "") {
          setAmountInputs((prev) => ({ ...prev, [emp.id]: "" }));
          setStatusByEmployee((prev) => {
            const next = { ...prev };
            delete next[String(emp.id)];
            return next;
          });
          setSuccessMsg("Advance amount cleared");
        } else {
          setAmountInputs((prev) => ({
            ...prev,
            [emp.id]: String(Number(advanceAmount)),
          }));
          setStatusByEmployee((prev) => ({
            ...prev,
            [String(emp.id)]: "active",
          }));
          setSuccessMsg("Advance amount saved");
        }
      } else {
        setError(data.message || "Failed to save advance amount");
      }
    } catch {
      setError("Failed to save advance amount");
    } finally {
      setSaving((prev) => ({ ...prev, [emp.id]: false }));
      setTimeout(() => setSuccessMsg(""), 2000);
    }
  };

  const handleRemove = async (emp: any) => {
    setSaving((prev) => ({ ...prev, [emp.id]: true }));
    setSuccessMsg("");
    setError("");
    try {
      const res = await fetch("/api/advance-salary", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: emp.id,
          month,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("Advance amount removed");
        setAmountInputs((prev) => ({ ...prev, [emp.id]: "" }));
        setStatusByEmployee((prev) => {
          const next = { ...prev };
          delete next[String(emp.id)];
          return next;
        });
      } else {
        setError(data.message || "Failed to remove advance amount");
      }
    } catch {
      setError("Failed to remove advance amount");
    } finally {
      setSaving((prev) => ({ ...prev, [emp.id]: false }));
      setTimeout(() => setSuccessMsg(""), 2000);
    }
  };

  return (
    <OptionalAdminShell>
      <div className={`${fh.page} advancePageCritical`}>
        <header className={fh.topBar}>
          <div className={fh.topLeft}>
            <p className={fh.eyebrow}>
              <span className={fh.eyebrowDot} aria-hidden />
              Interact Advance
            </p>
            <h1 className={fh.heroTitle}>Advance salary</h1>
            <p className={fh.heroSub}>
              Set monthly advances per employee, then track Active / Paid status
              from payroll.
            </p>
          </div>
          <div className={fh.topRight}>
            <label className={fh.monthChip}>
              <span>Month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                aria-label="Advance month"
              />
            </label>
            <button
              type="button"
              className={fh.clearBtn}
              onClick={() => reload()}
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className={fh.metricStrip}>
          <div className={`${fh.metric} ${fh.metricAccent}`}>
            <div className={fh.metricLabel}>With advance</div>
            <div className={fh.metricValue}>{summary.withAdvance}</div>
          </div>
          <div className={fh.metric}>
            <div className={fh.metricLabel}>Active</div>
            <div className={fh.metricValue}>{summary.active}</div>
          </div>
          <div className={fh.metric}>
            <div className={fh.metricLabel}>Paid</div>
            <div className={fh.metricValue}>{summary.paid}</div>
          </div>
          <div className={fh.metric}>
            <div className={fh.metricLabel}>Total amount</div>
            <div className={fh.metricValue}>{money(summary.totalAmount)}</div>
          </div>
        </div>

        {successMsg ? <p className={fh.toast}>{successMsg}</p> : null}
        {error ? <p className={fh.error}>{error}</p> : null}

        <div className={fh.panel}>
          <div className={fh.panelHead}>
            <div className={fh.panelHeadLeft}>
              <h2 className={fh.panelTitle}>Advance records</h2>
              <p className={fh.panelHint}>
                Filter employees, enter amount, then Save — Remove clears the month
              </p>
            </div>
            <button
              type="button"
              className={fh.clearBtn}
              onClick={() => {
                setSearch("");
                setDepartmentFilter("");
              }}
            >
              Clear filters
            </button>
          </div>
          <div className={fh.panelBody}>
            <div className={fh.filtersAdvance}>
              <label className={fh.field}>
                <span className={fh.label}>Month</span>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className={fh.input}
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Search</span>
                <input
                  type="text"
                  placeholder="Name, ID or pseudo…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={fh.input}
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Department</span>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className={fh.select}
                >
                  <option value="">All</option>
                  {uniqueDepartments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </label>
              <div />
            </div>

            <div className={fh.bulkBar} style={{ marginTop: 14 }}>
              <div className={fh.selectedText}>
                {summary.withAdvance > 0
                  ? `${summary.withAdvance} advance${summary.withAdvance === 1 ? "" : "s"} · ${money(summary.totalAmount)} this month`
                  : `${summary.employees} employee${summary.employees === 1 ? "" : "s"} — enter amount to save`}
              </div>
            </div>

            {loading ? <p className={fh.loading}>Loading advance records…</p> : null}

            <div className={fh.tableWrap}>
              <table className={fh.table}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Employee</th>
                    <th>Pseudo</th>
                    <th>Dept</th>
                    <th>Advance amount</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className={fh.empty}>
                        Loading…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className={fh.empty}>
                        No employees match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((emp) => {
                      const fullName = getFullName(emp);
                      const empKey = String(emp.id);
                      const hasAmount =
                        String(amountInputs[emp.id] ?? "").trim() !== "";
                      const status =
                        statusByEmployee[empKey] || (hasAmount ? "active" : "");
                      const isPaid = String(status).toLowerCase() === "paid";
                      const busy = Boolean(saving[emp.id]);
                      return (
                        <tr key={emp.id}>
                          <td>{emp.id}</td>
                          <td>
                            <EmployeeTableNameCell
                              name={fullName}
                              employeeId={emp.id}
                              photo={getPhoto(emp.id)}
                              onOpen={() =>
                                openFromRow({
                                  employee_id: emp.id,
                                  employee_name: fullName,
                                  first_name: emp.first_name,
                                  middle_name: emp.middle_name,
                                  last_name: emp.last_name,
                                  pseudonym: emp.pseudonym,
                                  department_name: emp.department_name,
                                })
                              }
                            />
                          </td>
                          <td>{emp.pseudonym || "—"}</td>
                          <td>{emp.department_name || "—"}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={amountInputs[emp.id] ?? ""}
                              onChange={(e) =>
                                setAmountInputs((prev) => ({
                                  ...prev,
                                  [emp.id]: e.target.value,
                                }))
                              }
                              className={`${fh.input} ${fh.compactInput}`}
                              disabled={isPaid}
                              title={
                                isPaid
                                  ? "Paid from Monthly Payroll — clear/remove only if you need to reverse"
                                  : undefined
                              }
                            />
                          </td>
                          <td>
                            {hasAmount || status ? (
                              <span
                                className={`${fh.statusPill} ${statusPillClass(
                                  status || "active",
                                )}`}
                              >
                                {formatStatus(status || "active")}
                              </span>
                            ) : (
                              <span className={fh.muted}>—</span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={fh.rowSaveBtn}
                              disabled={busy || isPaid}
                              onClick={() => void handleSave(emp)}
                            >
                              {busy ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              className={fh.rowRemoveBtn}
                              disabled={busy}
                              onClick={() => void handleRemove(emp)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {popup}
    </OptionalAdminShell>
  );
}
