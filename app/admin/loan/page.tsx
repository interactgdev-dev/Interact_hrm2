"use client";
import React, { useEffect, useMemo, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import { FaSave, FaTrash } from "react-icons/fa";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import fh from "../employee-financial-history/financial-history.module.css";

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

const money = (n: number) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

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
      const p = Number(loan.payable_this_month ?? loan.original_amount) || 0;
      payable += p;
      paid += Number(loan.paid_amount) || 0;
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

  const statusSelectStyle = (status: string): React.CSSProperties => {
    const s = String(status || "pending").toLowerCase();
    if (s === "paid") {
      return {
        width: 110,
        fontSize: 13,
        padding: "6px 8px",
        fontWeight: 700,
        borderRadius: 8,
        border: "1px solid #86efac",
        background: "#dcfce7",
        color: "#166534",
      };
    }
    if (s === "stop") {
      return {
        width: 110,
        fontSize: 13,
        padding: "6px 8px",
        fontWeight: 700,
        borderRadius: 8,
        border: "1px solid #fca5a5",
        background: "#fee2e2",
        color: "#b91c1c",
      };
    }
    return {
      width: 110,
      fontSize: 13,
      padding: "6px 8px",
      fontWeight: 700,
      borderRadius: 8,
      border: "1px solid #fde68a",
      background: "#fef9c3",
      color: "#a16207",
    };
  };

  return (
    <OptionalAdminShell>
      <div className={fh.page}>
        <div className={fh.hero}>
          <h1 className={fh.heroTitle}>Loan Management</h1>
          <p className={fh.heroSub}>
            Create loan schedules, adjust payable installments, and track Pending / Paid / Stop
            status. Filter by name, pseudo name, department, month, or status.
          </p>
        </div>

        <div className={fh.panel}>
          <div className={fh.filters} style={{ gridTemplateColumns: "minmax(160px,1fr) minmax(140px,1fr) minmax(150px,1fr) 140px 150px auto" }}>
            <div className={fh.field}>
              <label className={fh.label}>Search by name</label>
              <input
                type="text"
                placeholder="Name, ID or code"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                className={fh.input}
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Pseudo name</label>
              <input
                type="text"
                placeholder="P.Name"
                value={pseudoSearch}
                onChange={(e) => setPseudoSearch(e.target.value)}
                className={fh.input}
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Department</label>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className={fh.select}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Status</label>
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
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Month</label>
              <input
                type="month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className={fh.input}
              />
            </div>
            <button type="button" className={fh.clearBtn} onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        </div>

        {formSuccess ? (
          <div className={fh.selectedBar} style={{ borderColor: "#a7f3d0", background: "#ecfdf5" }}>
            <div className={fh.selectedText} style={{ color: "#065f46" }}>
              {formSuccess}
            </div>
          </div>
        ) : null}
        {error ? <div className={fh.error}>{error}</div> : null}

        <div className={fh.cards}>
          <div className={fh.card}>
            <div className={fh.cardLabel}>Installments shown</div>
            <div className={fh.cardValue}>{summary.rows}</div>
            <div className={fh.cardMeta}>After filters</div>
          </div>
          <div className={fh.card}>
            <div className={fh.cardLabel}>Payable total</div>
            <div className={fh.cardValue}>{money(summary.payable)}</div>
            <div className={fh.cardMeta}>This view</div>
          </div>
          <div className={fh.card}>
            <div className={fh.cardLabel}>Paid installments</div>
            <div className={fh.cardValue}>{summary.paidCount}</div>
            <div className={fh.cardMeta}>Amount {money(summary.paid)}</div>
          </div>
          <div className={fh.card}>
            <div className={fh.cardLabel}>Pending</div>
            <div className={fh.cardValue}>{summary.pending}</div>
            <div className={fh.cardMeta}>Still open</div>
          </div>
        </div>

        <div className={fh.panel}>
          <div className={fh.selectedText} style={{ marginBottom: 12 }}>
            Add new loan
          </div>
          <form
            onSubmit={handleAddLoan}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(200px,1.4fr) 140px 120px 160px auto",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div className={fh.field}>
              <label className={fh.label}>Employee</label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                required
                className={fh.select}
              >
                <option value="">Select Employee</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_code ? `[${emp.employee_code}] ` : ""}
                    {emp.first_name} {emp.last_name}
                    {emp.pseudonym ? ` (${emp.pseudonym})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Loan amount</label>
              <input
                type="number"
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value)}
                required
                min={1}
                className={fh.input}
                placeholder="Amount"
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Installments</label>
              <input
                type="number"
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
                required
                min={1}
                className={fh.input}
                placeholder="Months"
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Start month</label>
              <input
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                required
                className={fh.input}
              />
            </div>
            <button type="submit" disabled={formLoading} className={fh.primaryBtn}>
              {formLoading ? "Adding..." : "Add Loan"}
            </button>
          </form>
        </div>

        {loading ? <div className={fh.loading}>Loading loan records...</div> : null}

        <div className={fh.panel}>
          <div className={fh.tableWrap}>
            <table className={fh.table}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>P.Name</th>
                  <th>Department</th>
                  <th>Month</th>
                  <th>Per installment</th>
                  <th>Payable this month</th>
                  <th>Paid amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9}>
                      <div className={fh.empty}>Loading...</div>
                    </td>
                  </tr>
                ) : filteredLoans.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className={fh.empty}>
                        No loan records match the current filters.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLoans.map((loan) => {
                    const emp = getEmployeeRecord(loan.employee_id);
                    const empName = getEmployeeName(loan.employee_id);
                    return (
                      <tr key={loan.loan_key ?? `${loan.employee_id}-${loan.month}`}>
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
                        <td>{emp?.pseudonym || "--"}</td>
                        <td>{emp?.department_name || "--"}</td>
                        <td>{loan.month}</td>
                        <td>{money(loan.original_amount)}</td>
                        <td>
                          <input
                            type="number"
                            value={loan.payable_this_month ?? loan.original_amount}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v >= 0) {
                                setLoans((prev) => {
                                  const allLoans = prev
                                    .filter((l) => l.employee_id === loan.employee_id)
                                    .sort((a, b) => a.month.localeCompare(b.month));
                                  const origTotal = allLoans.reduce(
                                    (sum, l) => sum + (l.original_amount ?? 0),
                                    0,
                                  );
                                  const idx = allLoans.findIndex((l) => l.month === loan.month);
                                  const paidSoFar =
                                    allLoans
                                      .slice(0, idx)
                                      .reduce(
                                        (sum, l) =>
                                          sum + (l.payable_this_month ?? l.original_amount ?? 0),
                                        0,
                                      ) + v;
                                  const remaining = origTotal - paidSoFar;
                                  const afterIdx = allLoans.slice(idx + 1);
                                  const perInstall =
                                    afterIdx.length > 0
                                      ? Math.floor((remaining / afterIdx.length) * 100) / 100
                                      : 0;
                                  let distributed = 0;
                                  return prev.map((l) => {
                                    if (l.employee_id !== loan.employee_id) return l;
                                    if (l.month === loan.month) {
                                      return { ...l, payable_this_month: v };
                                    }
                                    const afterIdxIndex = afterIdx.findIndex(
                                      (a) => a.month === l.month,
                                    );
                                    if (afterIdxIndex === -1) return l;
                                    if (afterIdxIndex === afterIdx.length - 1) {
                                      return {
                                        ...l,
                                        payable_this_month: Math.max(
                                          0,
                                          Math.round((remaining - distributed) * 100) / 100,
                                        ),
                                      };
                                    }
                                    distributed = Math.round((distributed + perInstall) * 100) / 100;
                                    return {
                                      ...l,
                                      payable_this_month: Math.max(0, perInstall),
                                    };
                                  });
                                });
                              }
                            }}
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v >= 0) {
                                handleSave(loan, v, (loan.status || "pending").toLowerCase());
                              }
                            }}
                            min={0}
                            step={0.01}
                            className={fh.input}
                            style={{ width: 110, padding: "6px 8px" }}
                          />
                        </td>
                        <td>{money(loan.paid_amount)}</td>
                        <td>
                          <select
                            value={(loan.status || "pending").toLowerCase()}
                            onChange={(e) => handleStatusChange(loan, e.target.value)}
                            style={statusSelectStyle(loan.status)}
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
                              handleSave(
                                loan,
                                loan.payable_this_month ?? loan.original_amount,
                                (loan.status || "pending").toLowerCase(),
                              )
                            }
                            title="Save"
                            disabled={savingRowKey === `${loan.employee_id}-${loan.month}`}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 4,
                              color: "#611f69",
                              opacity:
                                savingRowKey === `${loan.employee_id}-${loan.month}` ? 0.6 : 1,
                            }}
                          >
                            <FaSave size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(loan.employee_id, loan.month)}
                            title="Delete"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 4,
                              color: "#e53e3e",
                              marginLeft: 8,
                            }}
                          >
                            <FaTrash size={18} />
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
      {popup}
    </OptionalAdminShell>
  );
}
