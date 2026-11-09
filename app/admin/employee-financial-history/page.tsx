"use client";

import React, { useEffect, useMemo, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import fh from "./financial-history.module.css";

type Employee = {
  id: number;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  pseudonym?: string;
  department_name?: string;
  employee_code?: string;
};

type Overview = {
  year: string;
  advances_taken_count: number;
  advances_taken_total: number;
  loans_taken_count: number;
  loans_taken_principal: number;
  recoveries_this_year: number;
  active_loan_remaining: number;
};

type AdvanceRecord = {
  id: number;
  employee_id: number;
  payroll_month: string;
  amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Installment = {
  id: number;
  installment_no: number;
  due_month: string;
  original_amount: number;
  payable_amount: number;
  paid_amount: number;
  status: string;
  paid_at: string | null;
};

type LoanRecord = {
  id: number;
  employee_id: number;
  principal: number;
  installment_count: number;
  start_month: string;
  status: string;
  notes: string | null;
  issued_at: string | null;
  remaining_amount?: number;
  paid_total?: number;
  installments?: Installment[];
};

type ActivityEmployee = {
  employee_id: number;
  employee_name: string;
  pseudonym: string | null;
  advance_count: number;
  advance_total: number;
  loan_count: number;
  loan_principal: number;
};

const money = (n: number) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

const fullName = (emp?: Partial<Employee> | null) =>
  `${emp?.first_name || ""} ${emp?.middle_name || ""} ${emp?.last_name || ""}`
    .replace(/\s+/g, " ")
    .trim();

function statusClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "paid" || s === "closed" || s === "cleared") return fh.statusPaid;
  if (s === "active" || s === "pending") return fh.statusActive;
  if (s === "cancelled" || s === "stop" || s === "stopped") return fh.statusCancelled;
  return "";
}

function formatStatus(status: string) {
  const s = String(status || "").trim();
  if (!s) return "--";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "--";
  return String(v).slice(0, 19).replace("T", " ");
}

export default function EmployeeFinancialHistoryPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [nameSearch, setNameSearch] = useState("");
  const [pseudoSearch, setPseudoSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [tab, setTab] = useState<"overview" | "advances" | "loans">("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [advances, setAdvances] = useState<AdvanceRecord[]>([]);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [activityEmployees, setActivityEmployees] = useState<ActivityEmployee[]>([]);
  const [expandedLoanIds, setExpandedLoanIds] = useState<Record<number, boolean>>({});
  const [selectedName, setSelectedName] = useState("");
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    fetch("/api/employee-list")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.employees)) {
          const seen = new Set<number>();
          setEmployees(
            data.employees.filter((e: Employee) => {
              if (seen.has(e.id)) return false;
              seen.add(e.id);
              return true;
            }),
          );
        }
      })
      .catch(() => {});
  }, []);

  const employeeById = useMemo(() => {
    const map = new Map<number, Employee>();
    for (const e of employees) map.set(Number(e.id), e);
    return map;
  }, [employees]);

  const departments = useMemo(() => {
    return Array.from(
      new Set(employees.map((e) => e.department_name).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const filteredActivity = useMemo(() => {
    const nameQ = nameSearch.trim().toLowerCase();
    const pseudoQ = pseudoSearch.trim().toLowerCase();
    return activityEmployees.filter((row) => {
      const emp = employeeById.get(Number(row.employee_id));
      const name = (row.employee_name || fullName(emp) || "").toLowerCase();
      const pseudo = (row.pseudonym || emp?.pseudonym || "").toLowerCase();
      const dept = (emp?.department_name || "").toLowerCase();
      if (nameQ && !name.includes(nameQ) && !String(row.employee_id).includes(nameQ)) return false;
      if (pseudoQ && !pseudo.includes(pseudoQ)) return false;
      if (departmentFilter && dept !== departmentFilter.toLowerCase()) return false;
      return true;
    });
  }, [activityEmployees, employeeById, nameSearch, pseudoSearch, departmentFilter]);

  const loadHistory = async (empId: string, yr: string) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ year: yr });
      if (empId) qs.set("employee_id", empId);
      const res = await fetch(`/api/employee-financial-history?${qs.toString()}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "Failed to load financial history");
        setOverview(null);
        setAdvances([]);
        setLoans([]);
        setActivityEmployees([]);
        return;
      }
      setOverview(data.overview || null);
      setAdvances(Array.isArray(data.advances) ? data.advances : []);
      setLoans(Array.isArray(data.loans) ? data.loans : []);
      setActivityEmployees(Array.isArray(data.employees) ? data.employees : []);
      setSelectedName(data.employee_name || "");
      if (Array.isArray(data.loans)) {
        const open: Record<number, boolean> = {};
        for (const loan of data.loans) open[loan.id] = true;
        setExpandedLoanIds(open);
      }
    } catch {
      setError("Failed to load financial history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory(employeeId, year);
  }, [employeeId, year]);

  const clearFilters = () => {
    setNameSearch("");
    setPseudoSearch("");
    setDepartmentFilter("");
    setEmployeeId("");
    setTab("overview");
  };

  const openEmployee = (id: number | string, nextTab: typeof tab = "overview") => {
    setEmployeeId(String(id));
    setTab(nextTab);
  };

  const selectedEmp = employeeId ? employeeById.get(Number(employeeId)) : null;

  return (
    <LayoutDashboard>
      <div className={fh.page}>
        <div className={fh.hero}>
          <h1 className={fh.heroTitle}>Employee Financial History</h1>
          <p className={fh.heroSub}>
            Yearly advance and loan totals, month-wise advances, and installment timelines. Search
            by name, pseudo name, or department.
          </p>
        </div>

        <div className={fh.panel}>
          <div className={fh.filters}>
            <div className={fh.field}>
              <label className={fh.label}>Year</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={fh.input}
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Search by name</label>
              <input
                type="text"
                placeholder="Employee name or ID"
                value={nameSearch}
                onChange={(e) => {
                  setNameSearch(e.target.value);
                  if (employeeId) setEmployeeId("");
                }}
                className={fh.input}
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Pseudo name</label>
              <input
                type="text"
                placeholder="P.Name"
                value={pseudoSearch}
                onChange={(e) => {
                  setPseudoSearch(e.target.value);
                  if (employeeId) setEmployeeId("");
                }}
                className={fh.input}
              />
            </div>
            <div className={fh.field}>
              <label className={fh.label}>Department</label>
              <select
                value={departmentFilter}
                onChange={(e) => {
                  setDepartmentFilter(e.target.value);
                  if (employeeId) setEmployeeId("");
                }}
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
            <button type="button" className={fh.clearBtn} onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        </div>

        {error && <div className={fh.error}>{error}</div>}
        {loading && <div className={fh.loading}>Loading...</div>}

        {overview && (
          <div className={fh.cards}>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Advances taken</div>
              <div className={fh.cardValue}>{overview.advances_taken_count}</div>
              <div className={fh.cardMeta}>Total {money(overview.advances_taken_total)}</div>
            </div>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Loans taken</div>
              <div className={fh.cardValue}>{overview.loans_taken_count}</div>
              <div className={fh.cardMeta}>Principal {money(overview.loans_taken_principal)}</div>
            </div>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Recoveries this year</div>
              <div className={fh.cardValue}>{money(overview.recoveries_this_year)}</div>
              <div className={fh.cardMeta}>Paid installments</div>
            </div>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Active loan remaining</div>
              <div className={fh.cardValue}>{money(overview.active_loan_remaining)}</div>
              <div className={fh.cardMeta}>
                {employeeId
                  ? selectedName || fullName(selectedEmp) || `Employee #${employeeId}`
                  : "Year summary"}
              </div>
            </div>
          </div>
        )}

        {employeeId && (
          <div className={fh.selectedBar}>
            <div className={fh.selectedText}>
              Viewing: {selectedName || fullName(selectedEmp) || `Employee #${employeeId}`}
              {selectedEmp?.pseudonym ? ` · ${selectedEmp.pseudonym}` : ""}
              {selectedEmp?.department_name ? ` · ${selectedEmp.department_name}` : ""}
            </div>
            <button type="button" className={fh.ghostBtn} onClick={() => setEmployeeId("")}>
              Back to filtered list
            </button>
          </div>
        )}

        <div className={fh.tabs}>
          {(
            [
              ["overview", "Overview"],
              ["advances", "Advances"],
              ["loans", "Loans"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${fh.tab} ${tab === id ? fh.tabActive : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={fh.panel}>
          {!employeeId && tab === "overview" && (
            <div className={fh.tableWrap}>
              <table className={fh.table}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Employee</th>
                    <th>P.Name</th>
                    <th>Department</th>
                    <th>Advances</th>
                    <th>Advance total</th>
                    <th>Loans</th>
                    <th>Loan principal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivity.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className={fh.empty}>
                          No matching employees with advance/loan activity for {year}.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredActivity.map((row) => {
                      const emp = employeeById.get(Number(row.employee_id));
                      return (
                        <tr key={row.employee_id}>
                          <td>{row.employee_id}</td>
                          <td>
                            <EmployeeTableNameCell
                              name={row.employee_name}
                              employeeId={row.employee_id}
                              photo={getPhoto(row.employee_id)}
                              onOpen={() =>
                                openFromRow({
                                  employee_id: row.employee_id,
                                  employee_name: row.employee_name,
                                  pseudonym: row.pseudonym,
                                  department_name: emp?.department_name,
                                })
                              }
                            />
                          </td>
                          <td>{row.pseudonym || emp?.pseudonym || "--"}</td>
                          <td>{emp?.department_name || "--"}</td>
                          <td>{row.advance_count}</td>
                          <td>{money(row.advance_total)}</td>
                          <td>{row.loan_count}</td>
                          <td>{money(row.loan_principal)}</td>
                          <td>
                            <button
                              type="button"
                              className={fh.primaryBtn}
                              onClick={() => openEmployee(row.employee_id, "loans")}
                            >
                              Open detail
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {employeeId && tab === "overview" && (
            <div className={fh.empty} style={{ textAlign: "left" }}>
              <strong>{selectedName || fullName(selectedEmp) || `Employee #${employeeId}`}</strong>
              {" — "}
              {year} totals are in the cards above. Open <strong>Advances</strong> or{" "}
              <strong>Loans</strong> for full month / installment detail.
              <div style={{ marginTop: 8 }}>
                Advances this year: <strong>{advances.length}</strong> · Loans in scope:{" "}
                <strong>{loans.length}</strong>
              </div>
            </div>
          )}

          {tab === "advances" && (
            <div className={fh.tableWrap}>
              {!employeeId ? (
                <div className={fh.empty}>
                  Select an employee from Overview (use name / pseudo / department filters) to see
                  month-wise advances.
                </div>
              ) : advances.length === 0 ? (
                <div className={fh.empty}>No advances for this employee in {year}.</div>
              ) : (
                <table className={fh.table}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Payroll month</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Notes</th>
                      <th>Created</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advances.map((a) => (
                      <tr key={a.id}>
                        <td>{a.id}</td>
                        <td>{a.payroll_month}</td>
                        <td>{money(a.amount)}</td>
                        <td>
                          <span className={`${fh.statusPill} ${statusClass(a.status)}`}>
                            {formatStatus(a.status)}
                          </span>
                        </td>
                        <td>{a.notes || "--"}</td>
                        <td>{fmtDate(a.created_at)}</td>
                        <td>{fmtDate(a.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === "loans" && (
            <>
              {!employeeId ? (
                <div className={fh.empty}>
                  Select an employee from Overview to see loan masters and installment timelines.
                </div>
              ) : loans.length === 0 ? (
                <div className={fh.empty}>No loans for this employee in {year}.</div>
              ) : (
                loans.map((loan) => {
                  const open = !!expandedLoanIds[loan.id];
                  return (
                    <div key={loan.id} className={fh.loanCard}>
                      <button
                        type="button"
                        className={fh.loanHead}
                        onClick={() =>
                          setExpandedLoanIds((prev) => ({ ...prev, [loan.id]: !prev[loan.id] }))
                        }
                      >
                        <div className={fh.loanTitle}>
                          Loan #{loan.id} · {loan.start_month} · {loan.installment_count}{" "}
                          installments{" "}
                          <span className={`${fh.statusPill} ${statusClass(loan.status)}`}>
                            {formatStatus(loan.status)}
                          </span>
                        </div>
                        <div className={fh.loanMeta}>
                          Principal {money(loan.principal)} · Paid {money(loan.paid_total || 0)} ·
                          Remaining {money(loan.remaining_amount || 0)} {open ? "▲" : "▼"}
                        </div>
                      </button>
                      {open && (
                        <div className={fh.tableWrap} style={{ border: "none", borderRadius: 0 }}>
                          <table className={fh.table} style={{ minWidth: 760 }}>
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Due month</th>
                                <th>Original</th>
                                <th>Payable</th>
                                <th>Paid</th>
                                <th>Status</th>
                                <th>Paid at</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(loan.installments || []).length === 0 ? (
                                <tr>
                                  <td colSpan={7}>
                                    <div className={fh.empty}>No installment rows.</div>
                                  </td>
                                </tr>
                              ) : (
                                (loan.installments || []).map((inst) => (
                                  <tr key={inst.id}>
                                    <td>{inst.installment_no}</td>
                                    <td>{inst.due_month}</td>
                                    <td>{money(inst.original_amount)}</td>
                                    <td>{money(inst.payable_amount)}</td>
                                    <td>{money(inst.paid_amount)}</td>
                                    <td>
                                      <span
                                        className={`${fh.statusPill} ${statusClass(inst.status)}`}
                                      >
                                        {formatStatus(inst.status)}
                                      </span>
                                    </td>
                                    <td>{fmtDate(inst.paid_at)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                          {loan.notes ? (
                            <div style={{ padding: "8px 14px 12px", fontSize: 13, color: "#64748b" }}>
                              Notes: {loan.notes}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
      {popup}
    </LayoutDashboard>
  );
}
