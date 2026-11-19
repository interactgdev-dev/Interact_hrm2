"use client";
import React, { useEffect, useMemo, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import { FaSave, FaTrash } from "react-icons/fa";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import fh from "./loan.module.css";

type Employee = {
  id: number;
  first_name: string;
  last_name: string;
  employee_code?: string;
  pseudonym?: string;
  department_name?: string;
};

type LoanRecord = {
  loan_key?: string;
  employee_id: number;
  month: string;
  original_amount: number;
  paid_amount: number;
  payable_this_month: number;
  status: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const safeNum = (n: unknown, fallback = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
};

const money = (n: unknown) =>
  safeNum(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

/** Paid column: never show NaN; if Paid status but amount missing, use payable. */
function displayPaidAmount(loan: LoanRecord) {
  const paid = safeNum(loan.paid_amount, NaN);
  if (Number.isFinite(paid) && paid > 0) return paid;
  const st = String(loan.status || "").toLowerCase();
  if (st === "paid") {
    return safeNum(loan.payable_this_month ?? loan.original_amount);
  }
  return Number.isFinite(paid) ? paid : 0;
}

export default function LoanManagementPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [loanAmount, setLoanAmount] = useState("");
  const [installments, setInstallments] = useState("");
  const [startMonth, setStartMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formSuccess, setFormSuccess] = useState("");
  const [savingRowKey, setSavingRowKey] = useState<string>("");
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const [nameSearch, setNameSearch] = useState("");
  const [pseudoSearch, setPseudoSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");

    const loadData = async () => {
      try {
        const empRes = await fetch("/api/employee-list");
        const empData = await empRes.json();
        if (empData.success && Array.isArray(empData.employees)) {
          const seen = new Set<number>();
          const unique = empData.employees.filter((e: Employee) => {
            if (seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
          });
          setEmployees(unique);
        }
      } catch {
        setError("Failed to fetch employees");
      }

      try {
        const loanRes = await fetch("/api/loan-installments");
        const loanData = await loanRes.json();
        if (loanData.success && Array.isArray(loanData.records)) {
          setLoans(loanData.records);
        }
      } catch {
        /* Loans API may not exist yet */
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const loadLoans = async () => {
    try {
      const res = await fetch("/api/loan-installments");
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) setLoans(data.records);
    } catch {
      /* ignore */
    }
  };

  const handleAddLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormSuccess("");
    setError("");
    try {
      const res = await fetch("/api/loan-installments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: parseInt(selectedEmployee, 10),
          loan_amount: parseFloat(loanAmount),
          installments: parseInt(installments, 10),
          start_month: startMonth,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFormSuccess("Loan added successfully");
        setLoanAmount("");
        setInstallments("");
        setSelectedEmployee("");
        await loadLoans();
      } else {
        setError(data.error || "Failed to add loan");
      }
    } catch {
      setError("Failed to add loan");
    } finally {
      setFormLoading(false);
    }
  };

  const handleSave = async (loan: LoanRecord, payableValue: number, statusValue: string) => {
    try {
      setSavingRowKey(`${loan.employee_id}-${loan.month}`);
      const normalizedPayable = round2(payableValue);
      const res = await fetch("/api/loan-installments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: loan.employee_id,
          month: loan.month,
          payable_this_month: normalizedPayable,
          status: statusValue,
          adjust_remaining: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await loadLoans();
        setFormSuccess("Record updated");
        setTimeout(() => setFormSuccess(""), 2000);
      } else setError(data.error || "Failed to update");
    } catch {
      setError("Failed to update");
    } finally {
      setSavingRowKey("");
    }
  };

  const handleStatusChange = async (loan: LoanRecord, newStatus: string) => {
    try {
      setSavingRowKey(`${loan.employee_id}-${loan.month}`);
      const res = await fetch("/api/loan-installments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: loan.employee_id,
          month: loan.month,
          status: newStatus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await loadLoans();
        setFormSuccess("Status updated");
        setTimeout(() => setFormSuccess(""), 2000);
      } else setError(data.error || "Failed to update status");
    } catch {
      setError("Failed to update status");
    } finally {
      setSavingRowKey("");
    }
  };

  const handleDelete = async (employeeId: number, month: string) => {
    if (!confirm("Delete this loan installment?")) return;
    try {
      const res = await fetch("/api/loan-installments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: employeeId, month }),
      });
      const data = await res.json();
      if (data.success) {
        setLoans((prev) =>
          prev.filter((l) => !(l.employee_id === employeeId && l.month === month)),
        );
        setFormSuccess("Record deleted");
        setTimeout(() => setFormSuccess(""), 2000);
      } else setError(data.error || "Failed to delete");
    } catch {
      setError("Failed to delete");
    }
  };

  const getEmployeeName = (id: number) => {
    const emp = employees.find((e) => e.id === id);
    return emp ? `${emp.first_name} ${emp.last_name}`.trim() : String(id);
  };

  const getEmployeeRecord = (id: number) => employees.find((e) => e.id === id);

  const departments = useMemo(() => {
    return Array.from(
      new Set(employees.map((e) => e.department_name).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const filteredLoans = useMemo(() => {
    const nameQ = nameSearch.trim().toLowerCase();
    const pseudoQ = pseudoSearch.trim().toLowerCase();
    const statusQ = statusFilter.trim().toLowerCase();
    return loans.filter((loan) => {
      const emp = getEmployeeRecord(loan.employee_id);
      const name = getEmployeeName(loan.employee_id).toLowerCase();
      const pseudo = String(emp?.pseudonym || "").toLowerCase();
      const dept = String(emp?.department_name || "").toLowerCase();
      const status = String(loan.status || "pending").toLowerCase();
      if (
        nameQ &&
        !name.includes(nameQ) &&
        !String(loan.employee_id).includes(nameQ) &&
        !(emp?.employee_code || "").toLowerCase().includes(nameQ)
      ) {
        return false;
      }
      if (pseudoQ && !pseudo.includes(pseudoQ)) return false;
      if (departmentFilter && dept !== departmentFilter.toLowerCase()) return false;
      if (statusQ && status !== statusQ) return false;
      if (monthFilter && String(loan.month) !== monthFilter) return false;
      return true;
    });
  }, [loans, employees, nameSearch, pseudoSearch, departmentFilter, statusFilter, monthFilter]);

  const summary = useMemo(() => {
    let payable = 0;
    let paid = 0;
    let pending = 0;
    let paidCount = 0;
    for (const loan of filteredLoans) {
      const st = String(loan.status || "pending").toLowerCase();
      const p = safeNum(loan.payable_this_month ?? loan.original_amount);
      payable += p;
      paid += displayPaidAmount(loan);
      if (st === "paid") paidCount += 1;
      else if (st === "pending") pending += 1;
    }
    return {
      rows: filteredLoans.length,
      payable,
      paid,
      pending,
      paidCount,
    };
  }, [filteredLoans]);

  const clearFilters = () => {
    setNameSearch("");
    setPseudoSearch("");
    setDepartmentFilter("");
    setStatusFilter("");
    setMonthFilter("");
  };

  function statusSelectClass(status: string) {
    const s = String(status || "pending").toLowerCase();
    if (s === "paid") return `${fh.statusSelect} ${fh.statusPaidSelect}`;
    if (s === "stop") return `${fh.statusSelect} ${fh.statusStop}`;
    return `${fh.statusSelect} ${fh.statusPending}`;
  }

  const pendingHint = summary.pending;

  return (
    <OptionalAdminShell>
      <div className={`${fh.page} loanPageCritical`}>
        <header className={fh.topBar}>
          <div className={fh.topLeft}>
            <p className={fh.eyebrow}>
              <span className={fh.eyebrowDot} aria-hidden />
              Interact Loan
            </p>
            <h1 className={fh.heroTitle}>Loan management</h1>
            <p className={fh.heroSub}>
              Add loan schedules, adjust payable installments, then mark Pending,
              Paid, or Stop.
            </p>
          </div>
          <div className={fh.topRight}>
            <button
              type="button"
              className={fh.clearBtn}
              onClick={() => void loadLoans()}
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className={fh.metricStrip}>
          <div className={`${fh.metric} ${fh.metricAccent}`}>
            <div className={fh.metricLabel}>Installments</div>
            <div className={fh.metricValue}>{summary.rows}</div>
          </div>
          <div className={fh.metric}>
            <div className={fh.metricLabel}>Pending</div>
            <div className={fh.metricValue}>{summary.pending}</div>
          </div>
          <div className={fh.metric}>
            <div className={fh.metricLabel}>Payable total</div>
            <div className={fh.metricValue}>{money(summary.payable)}</div>
          </div>
          <div className={fh.metric}>
            <div className={fh.metricLabel}>Paid amount</div>
            <div className={fh.metricValue}>{money(summary.paid)}</div>
          </div>
        </div>

        {formSuccess ? <p className={fh.toast}>{formSuccess}</p> : null}
        {error ? <p className={fh.error}>{error}</p> : null}

        <div className={fh.panel}>
          <div className={fh.panelHead}>
            <div className={fh.panelHeadLeft}>
              <h2 className={fh.panelTitle}>Add loan</h2>
              <p className={fh.panelHint}>
                Select employee, amount, installments and start month
              </p>
            </div>
          </div>
          <div className={fh.panelBody}>
            <form onSubmit={handleAddLoan} className={fh.formGridLoan}>
              <label className={fh.field}>
                <span className={fh.label}>Employee</span>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  required
                  className={fh.select}
                >
                  <option value="">Select employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_code ? `[${emp.employee_code}] ` : ""}
                      {emp.first_name} {emp.last_name}
                      {emp.pseudonym ? ` (${emp.pseudonym})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Loan amount</span>
                <input
                  type="number"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(e.target.value)}
                  required
                  min={1}
                  className={fh.input}
                  placeholder="0"
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Installments</span>
                <input
                  type="number"
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                  required
                  min={1}
                  className={fh.input}
                  placeholder="Months"
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Start month</span>
                <input
                  type="month"
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  required
                  className={fh.input}
                />
              </label>
              <button type="submit" disabled={formLoading} className={fh.addBtn}>
                {formLoading ? "Adding…" : "Add loan"}
              </button>
            </form>
          </div>
        </div>

        <div className={fh.panel}>
          <div className={fh.panelHead}>
            <div className={fh.panelHeadLeft}>
              <h2 className={fh.panelTitle}>Loan installments</h2>
              <p className={fh.panelHint}>
                Filter, adjust payable, then save or update status
              </p>
            </div>
            <button type="button" className={fh.clearBtn} onClick={clearFilters}>
              Clear filters
            </button>
          </div>
          <div className={fh.panelBody}>
            <div className={fh.filtersLoan}>
              <label className={fh.field}>
                <span className={fh.label}>Search</span>
                <input
                  type="text"
                  placeholder="Name, ID or code…"
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  className={fh.input}
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Pseudo</span>
                <input
                  type="text"
                  placeholder="P.Name…"
                  value={pseudoSearch}
                  onChange={(e) => setPseudoSearch(e.target.value)}
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
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={fh.select}
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="stop">Stop</option>
                </select>
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Month</span>
                <input
                  type="month"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className={fh.input}
                />
              </label>
              <div />
            </div>

            <div className={fh.bulkBar} style={{ marginTop: 14 }}>
              <div className={fh.selectedText}>
                {pendingHint > 0
                  ? `${pendingHint} pending — adjust payable or mark Paid`
                  : summary.rows > 0
                    ? `${summary.rows} installment${summary.rows === 1 ? "" : "s"} in this view`
                    : "No loan installments for this filter"}
              </div>
            </div>

            {loading ? <p className={fh.loading}>Loading loan records…</p> : null}

            <div className={fh.tableWrap}>
              <table className={fh.table}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Pseudo</th>
                    <th>Dept</th>
                    <th>Month</th>
                    <th>Per installment</th>
                    <th>Payable</th>
                    <th>Paid</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className={fh.empty}>
                        Loading…
                      </td>
                    </tr>
                  ) : filteredLoans.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={fh.empty}>
                        No loan records match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredLoans.map((loan) => {
                      const emp = getEmployeeRecord(loan.employee_id);
                      const empName = getEmployeeName(loan.employee_id);
                      const rowBusy =
                        savingRowKey === `${loan.employee_id}-${loan.month}`;
                      return (
                        <tr
                          key={loan.loan_key ?? `${loan.employee_id}-${loan.month}`}
                        >
                          <td>
                            <EmployeeTableNameCell
                              name={empName}
                              employeeId={loan.employee_id}
                              photo={getPhoto(loan.employee_id)}
                              onOpen={() =>
                                openFromRow({
                                  employee_id: loan.employee_id,
                                  employee_name: empName,
                                  first_name: emp?.first_name,
                                  last_name: emp?.last_name,
                                  pseudonym: emp?.pseudonym,
                                  department_name: emp?.department_name,
                                })
                              }
                            />
                          </td>
                          <td>{emp?.pseudonym || "—"}</td>
                          <td>{emp?.department_name || "—"}</td>
                          <td>{loan.month}</td>
                          <td>
                            <strong>{money(loan.original_amount)}</strong>
                          </td>
                          <td>
                            <input
                              type="number"
                              value={
                                loan.payable_this_month ?? loan.original_amount
                              }
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v >= 0) {
                                  setLoans((prev) => {
                                    const allLoans = prev
                                      .filter(
                                        (l) => l.employee_id === loan.employee_id,
                                      )
                                      .sort((a, b) =>
                                        a.month.localeCompare(b.month),
                                      );
                                    const origTotal = allLoans.reduce(
                                      (sum, l) => sum + (l.original_amount ?? 0),
                                      0,
                                    );
                                    const idx = allLoans.findIndex(
                                      (l) => l.month === loan.month,
                                    );
                                    const paidSoFar =
                                      allLoans
                                        .slice(0, idx)
                                        .reduce(
                                          (sum, l) =>
                                            sum +
                                            (l.payable_this_month ??
                                              l.original_amount ??
                                              0),
                                          0,
                                        ) + v;
                                    const remaining = origTotal - paidSoFar;
                                    const afterIdx = allLoans.slice(idx + 1);
                                    const perInstall =
                                      afterIdx.length > 0
                                        ? Math.floor(
                                            (remaining / afterIdx.length) * 100,
                                          ) / 100
                                        : 0;
                                    let distributed = 0;
                                    return prev.map((l) => {
                                      if (l.employee_id !== loan.employee_id)
                                        return l;
                                      if (l.month === loan.month) {
                                        return { ...l, payable_this_month: v };
                                      }
                                      const afterIdxIndex = afterIdx.findIndex(
                                        (a) => a.month === l.month,
                                      );
                                      if (afterIdxIndex === -1) return l;
                                      if (
                                        afterIdxIndex ===
                                        afterIdx.length - 1
                                      ) {
                                        return {
                                          ...l,
                                          payable_this_month: Math.max(
                                            0,
                                            Math.round(
                                              (remaining - distributed) * 100,
                                            ) / 100,
                                          ),
                                        };
                                      }
                                      distributed =
                                        Math.round(
                                          (distributed + perInstall) * 100,
                                        ) / 100;
                                      return {
                                        ...l,
                                        payable_this_month: Math.max(
                                          0,
                                          perInstall,
                                        ),
                                      };
                                    });
                                  });
                                }
                              }}
                              onBlur={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v >= 0) {
                                  void handleSave(
                                    loan,
                                    v,
                                    (loan.status || "pending").toLowerCase(),
                                  );
                                }
                              }}
                              min={0}
                              step={0.01}
                              className={`${fh.input} ${fh.compactInput}`}
                            />
                          </td>
                          <td>
                            <strong>{money(displayPaidAmount(loan))}</strong>
                          </td>
                          <td>
                            <select
                              value={(loan.status || "pending").toLowerCase()}
                              onChange={(e) =>
                                void handleStatusChange(loan, e.target.value)
                              }
                              className={statusSelectClass(loan.status)}
                              disabled={rowBusy}
                            >
                              <option value="pending">Pending</option>
                              <option value="paid">Paid</option>
                              <option value="stop">Stop</option>
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() =>
                                void handleSave(
                                  loan,
                                  loan.payable_this_month ??
                                    loan.original_amount,
                                  (loan.status || "pending").toLowerCase(),
                                )
                              }
                              title="Save"
                              disabled={rowBusy}
                              className={fh.iconBtn}
                              style={{ opacity: rowBusy ? 0.6 : 1 }}
                            >
                              <FaSave size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleDelete(loan.employee_id, loan.month)
                              }
                              title="Delete"
                              className={fh.iconBtnDanger}
                            >
                              <FaTrash size={16} />
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
