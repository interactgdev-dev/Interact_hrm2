"use client";
import React, { useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "./advance-summary.module.css";

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
  // Advance amount input state per employee
  const [amountInputs, setAmountInputs] = useState<{ [key: string]: string }>({});
  const [saving, setSaving] = useState<{ [key: string]: boolean }>({});
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/employee-list").then(res => res.json()),
      fetch(`/api/advance-salary?month=${month}`).then(res => res.json())
    ])
      .then(([empData, advData]) => {
        if (empData.success) {
          setEmployees(empData.employees);
          setError("");
        } else {
          setError(empData.error || "Failed to fetch employees");
        }
        if (advData.success && Array.isArray(advData.records)) {
          // Pre-fill advance amount for each employee
          type AdvanceRecord = { employee_id: string | number; advance_amount: string | number };
          const advMap: { [key: string]: string } = {};
          (advData.records as AdvanceRecord[]).forEach((rec) => {
            const key = String(rec.employee_id);
            if (advMap[key] === undefined) advMap[key] = String(rec.advance_amount);
          });
          setAmountInputs(advMap);
        }
      })
      .catch(() => {
        setError("Failed to fetch employees or advance salary");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [month]);

  const uniqueDepartments = Array.from(new Set(employees.map((e) => e.department_name).filter(Boolean)));

  const filtered = employees.filter((emp) => {
    const searchLower = search.toLowerCase();
    const matchesSearch =
      !search ||
      (emp.employee_code || emp.id || "").toString().includes(searchLower) ||
      (emp.first_name + " " + (emp.middle_name || "") + " " + (emp.last_name || "")).toLowerCase().includes(searchLower) ||
      (emp.pseudonym || "").toLowerCase().includes(searchLower);
    const matchesDept = !departmentFilter || emp.department_name === departmentFilter;
    return matchesSearch && matchesDept;
  });

  // Save advance amount handler
  const handleSave = async (emp: any) => {
    setSaving((prev) => ({ ...prev, [emp.id]: true }));
    setSuccessMsg("");
    setError("");
    try {
      const res = await fetch("/api/advance-salary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: emp.id,
          employee_name: `${emp.first_name} ${emp.middle_name || ''} ${emp.last_name || ''}`.trim(),
          pseudonym: emp.pseudonym || null,
          department: emp.department_name,
          advance_amount: amountInputs[emp.id],
          month,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("Advance amount saved!");
      } else {
        setError(data.message || "Failed to save advance amount");
      }
    } catch (err: any) {
      setError("Failed to save advance amount");
    } finally {
      setSaving((prev) => ({ ...prev, [emp.id]: false }));
      setTimeout(() => setSuccessMsg("") , 2000);
    }
  };

  // Remove advance amount handler
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
        setSuccessMsg("Advance amount removed!");
        setAmountInputs((prev) => ({ ...prev, [emp.id]: '' }));
      } else {
        setError(data.message || "Failed to remove advance amount");
      }
    } catch (err: any) {
      setError("Failed to remove advance amount");
    } finally {
      setSaving((prev) => ({ ...prev, [emp.id]: false }));
      setTimeout(() => setSuccessMsg("") , 2000);
    }
  };

  return (
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer} style={{ position: 'relative', maxWidth: 1200, margin: '0 auto' }}>
        <div className={styles.breakSummaryHeader} style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Advance Salary Records</div>
        {successMsg && <div style={{ color: 'green', marginBottom: 8 }}>{successMsg}</div>}
        {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
        <div className={styles.breakSummaryFilters} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <label style={{ fontWeight: 600 }}>Month:</label>
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 180, fontSize: 16 }}
          />
          <input
            type="text"
            placeholder="Search by name, ID or P.Name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 220, fontSize: 15 }}
          />
          <select
            value={departmentFilter}
            onChange={e => setDepartmentFilter(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 180, fontSize: 15 }}
          >
            <option value="">All Departments</option>
            {uniqueDepartments.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
        <div className={styles.breakSummaryTableWrapper} style={{ overflowY: "auto", maxHeight: "74vh" }}>
          <table className={styles.breakSummaryTable} style={{ minWidth: 900 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 12 }}>
              <tr>
                <th>ID</th>
                <th>Employee Name</th>
                <th>P.Name</th>
                <th>Department</th>
                <th>Advance Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className={styles.breakSummaryNoRecords}>Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className={styles.breakSummaryNoRecords} style={{ color: 'red' }}>{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className={styles.breakSummaryNoRecords}>No records found.</td></tr>
              ) : (
                filtered.map(emp => (
                  <tr key={emp.id}>
                    <td>{emp.id}</td>
                    <td>{emp.first_name} {emp.middle_name} {emp.last_name}</td>
                    <td>{emp.pseudonym || '--'}</td>
                    <td>{emp.department_name || '--'}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        placeholder="Enter amount"
                        value={amountInputs[emp.id] ?? ''}
                        onChange={e => setAmountInputs((prev) => ({ ...prev, [emp.id]: e.target.value }))}
                        className={styles.breakSummaryInput}
                        style={{ width: 110, fontSize: 15 }}
                      />
                    </td>
                    <td>
                      <button
                        style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#0052CC', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
                        disabled={saving[emp.id]}
                        onClick={() => handleSave(emp)}
                      >
                        {saving[emp.id] ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#e53e3e', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
                        disabled={saving[emp.id]}
                        onClick={() => handleRemove(emp)}
                      >
                        Remove
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

