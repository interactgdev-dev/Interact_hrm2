"use client";
import React, { useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../advance/advance-summary.module.css";
import { FaSave, FaTrash } from "react-icons/fa";

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

export default function LoanManagementPage() {
	// State for employees and loans
	const [employees, setEmployees] = useState<Employee[]>([]);
	const [loans, setLoans] = useState<LoanRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	// Add Loan Form State
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

	// Fetch employees and loans from API
	useEffect(() => {
		setLoading(true);
		setError("");

		const loadData = async () => {
			try {
				// Fetch all employees via /api/employee-list
				const empRes = await fetch("/api/employee-list");
				const empData = await empRes.json();
				if (empData.success && Array.isArray(empData.employees)) {
					// Deduplicate by id (API may return duplicates from JOINs)
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

			// Fetch loan records
			try {
				const loanRes = await fetch("/api/loan-installments");
				const loanData = await loanRes.json();
				if (loanData.success && Array.isArray(loanData.records)) {
					setLoans(loanData.records);
				}
			} catch {
				// Loans API may not exist yet; employees still work
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
		} catch {}
	};

	// Add Loan Handler - real API call
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
				// Reload to reflect any auto-adjustment in remaining months from backend.
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
				await loadLoans(); // status affects paid_amount; refresh row values from DB
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
				setLoans((prev) => prev.filter((l) => !(l.employee_id === employeeId && l.month === month)));
				setFormSuccess("Record deleted");
				setTimeout(() => setFormSuccess(""), 2000);
			} else setError(data.error || "Failed to delete");
		} catch {
			setError("Failed to delete");
		}
	};

	// Helper: Get employee name
	const getEmployeeName = (id: number) => {
		const emp = employees.find(e => e.id === id);
		return emp ? `${emp.first_name} ${emp.last_name}` : id;
	};

	return (
		<LayoutDashboard>
			<div className={styles.breakSummaryContainer} style={{ position: "relative", maxWidth: 1200, margin: "0 auto" }}>
				<div className={styles.breakSummaryHeader} style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
					Loan Management
				</div>
				{formSuccess && <div style={{ color: "#38A169", marginBottom: 8 }}>{formSuccess}</div>}
				{error && <div style={{ color: "#e53e3e", marginBottom: 8 }}>{error}</div>}

				{/* Add New Loan Section */}
				<div className={styles.breakSummaryFilters} style={{ marginBottom: 24, flexWrap: "wrap" }}>
					<label style={{ fontWeight: 600 }}>Add New Loan</label>
				</div>
				<form onSubmit={handleAddLoan} className={styles.breakSummaryFilters} style={{ alignItems: "flex-end", marginBottom: 32 }}>
					<div>
						<label style={{ fontWeight: 500, display: "block", marginBottom: 4 }}>Employee</label>
						<select
							value={selectedEmployee}
							onChange={e => setSelectedEmployee(e.target.value)}
							required
							className={styles.breakSummaryInput}
							style={{ width: 220 }}
						>
							<option value="">Select Employee</option>
							{employees.map(emp => (
								<option key={emp.id} value={emp.id}>
									{emp.employee_code ? `[${emp.employee_code}] ` : ""}{emp.first_name} {emp.last_name} {emp.pseudonym ? `(${emp.pseudonym})` : ""}
								</option>
							))}
						</select>
					</div>
					<div>
						<label style={{ fontWeight: 500, display: "block", marginBottom: 4 }}>Loan Amount</label>
						<input
							type="number"
							value={loanAmount}
							onChange={e => setLoanAmount(e.target.value)}
							required
							min={1}
							className={styles.breakSummaryInput}
							style={{ width: 140 }}
							placeholder="Amount"
						/>
					</div>
					<div>
						<label style={{ fontWeight: 500, display: "block", marginBottom: 4 }}>Installments</label>
						<input
							type="number"
							value={installments}
							onChange={e => setInstallments(e.target.value)}
							required
							min={1}
							className={styles.breakSummaryInput}
							style={{ width: 120 }}
							placeholder="Months"
						/>
					</div>
					<div>
						<label style={{ fontWeight: 500, display: "block", marginBottom: 4 }}>Start Month</label>
						<input
							type="month"
							value={startMonth}
							onChange={e => setStartMonth(e.target.value)}
							required
							className={styles.breakSummaryInput}
							style={{ width: 160 }}
						/>
					</div>
					<button
						type="submit"
						disabled={formLoading}
						style={{ background: "#0052CC", color: "#fff", border: "none", borderRadius: 10, padding: "12px 28px", fontWeight: 600, fontSize: "1rem", cursor: "pointer" }}
					>
						{formLoading ? "Adding..." : "Add Loan"}
					</button>
				</form>

				{/* Loan Records Table */}
				<div className={styles.breakSummaryFilters} style={{ marginBottom: 12 }}>
					<label style={{ fontWeight: 600 }}>Loan Records</label>
				</div>
				<div className={styles.breakSummaryTableWrapper}>
					<table className={styles.breakSummaryTable} style={{ minWidth: 900 }}>
						<thead>
							<tr>
								<th>Employee</th>
								<th>Month</th>
								<th>Per Installment</th>
								<th>Payable This Month</th>
								<th>Paid Amount</th>
								<th>Status</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{loading ? (
								<tr><td colSpan={7} className={styles.breakSummaryNoRecords}>Loading...</td></tr>
							) : error ? (
								<tr><td colSpan={7} className={styles.breakSummaryNoRecords} style={{ color: "#e53e3e" }}>{error}</td></tr>
							) : loans.length === 0 ? (
								<tr><td colSpan={7} className={styles.breakSummaryNoRecords}>No loan records found.</td></tr>
							) : (
								loans.map((loan) => (
									<tr key={loan.loan_key ?? `${loan.employee_id}-${loan.month}`}>
										<td>{getEmployeeName(loan.employee_id)}</td>
										<td>{loan.month}</td>
										<td>{loan.original_amount}</td>
										<td>
											<input
												type="number"
												value={loan.payable_this_month ?? loan.original_amount}
												onChange={(e) => {
													const v = parseFloat(e.target.value);
													if (!isNaN(v) && v >= 0) {
														setLoans((prev) => {
															// Find all loans for this employee, sorted by month
															const allLoans = prev.filter(l => l.employee_id === loan.employee_id).sort((a, b) => a.month.localeCompare(b.month));
															const origTotal = allLoans.reduce((sum, l) => sum + (l.original_amount ?? 0), 0);
															const idx = allLoans.findIndex(l => l.month === loan.month);
															// Calculate paid so far (including new value)
															const paidSoFar = allLoans.slice(0, idx).reduce((sum, l) => sum + (l.payable_this_month ?? l.original_amount ?? 0), 0) + v;
															let remaining = origTotal - paidSoFar;
															const afterIdx = allLoans.slice(idx + 1);
															let perInstall = afterIdx.length > 0 ? Math.floor((remaining / afterIdx.length) * 100) / 100 : 0;
															let distributed = 0;
															// Build new loans array with updated values
															return prev.map(l => {
																if (l.employee_id !== loan.employee_id) return l;
																// If this is the changed month
																if (l.month === loan.month) return { ...l, payable_this_month: v };
																// If this is a future month
																const afterIdxIndex = afterIdx.findIndex(a => a.month === l.month);
																if (afterIdxIndex === -1) return l;
																// Last installment: assign all remaining
																if (afterIdxIndex === afterIdx.length - 1) {
																	return { ...l, payable_this_month: Math.max(0, Math.round((remaining - distributed) * 100) / 100) };
																} else {
																	distributed = Math.round((distributed + perInstall) * 100) / 100;
																	return { ...l, payable_this_month: Math.max(0, perInstall) };
																}
															});
														});
													}
												}}
												onBlur={(e) => {
													const v = parseFloat(e.target.value);
													if (!isNaN(v) && v >= 0) {
														handleSave(
															loan,
															v,
															(loan.status || "pending").toLowerCase()
														);
													}
												}}
												min={0}
												step={0.01}
												className={styles.breakSummaryInput}
												style={{ width: 100, fontSize: 13 }}
											/>
										</td>
										<td>{loan.paid_amount}</td>
										<td>
											<select
												value={(loan.status || "pending").toLowerCase()}
												onChange={(e) => handleStatusChange(loan, e.target.value)}
												className={styles.breakSummaryInput}
												style={{ width: 100, fontSize: 13, padding: "6px 8px" }}
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
														(loan.status || "pending").toLowerCase()
													)
												}
												title="Save"
												disabled={savingRowKey === `${loan.employee_id}-${loan.month}`}
												style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#0052CC", opacity: savingRowKey === `${loan.employee_id}-${loan.month}` ? 0.6 : 1 }}
											>
												<FaSave size={18} />
											</button>
											<button
												type="button"
												onClick={() => handleDelete(loan.employee_id, loan.month)}
												title="Delete"
												style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#e53e3e", marginLeft: 8 }}
											>
												<FaTrash size={18} />
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>
		</LayoutDashboard>
	);
}
