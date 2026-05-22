"use client";
import React, { useState } from "react";
import styles from "../../add-employee/add-employee.module.css";
import { useRouter, usePathname } from "next/navigation";

const employeeTabs = [
  { name: "Employee List", path: "/employee-list" },
  { name: "Personal Details", path: "/employee-details/personal" },
  { name: "Contact Details", path: "/employee-details/contact" },
  { name: "Emergency Contacts", path: "/employee-details/emergency" },
  { name: "Dependents", path: "/employee-details/dependents" },
  { name: "Job", path: "/employee-details/job" },
  { name: "Salary", path: "/employee-details/salary" }
];

export default function SalaryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [salary, setSalary] = useState({
    component: "",
    payGrade: "",
    payFrequency: "",
    currency: "",
    amount: "",
    comments: "",
    directDeposit: false,
    accountNumber: "",
    accountType: "",
    routingNumber: "",
    depositAmount: ""
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const eid = window.prompt('Enter Employee ID to save salary details for (employee_id):');
    if (!eid) { alert('Employee ID is required'); return; }
    const payload = { details: { employeeId: eid, salary } };
    try {
      // Example placeholder for saving salary details
      const res = await fetch('/api/employee_salaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) alert('Salary details saved'); else alert('Save failed: ' + (data.error || 'Unknown'));
    } catch (err) { alert('Save failed: ' + String(err)); }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F7FAFC" }}>
      <aside className={styles.sidebar}>
        <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", margin: "18px 0 12px 0" }}>
          <button
            aria-label="Back to Dashboard"
            onClick={() => router.push("/dashboard")}
            style={{
              background: "#fff",
              border: "none",
              borderRadius: "50%",
              boxShadow: "0 2px 8px rgba(0,82,204,0.10)",
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer"
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="14" fill="#0052CC" />
              <path d="M16.5 9L12.5 14L16.5 19" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <nav className={styles.nav}>
          {employeeTabs.map(tab => {
            const isActive = pathname === tab.path;
            return (
              <div
                key={tab.name}
                onClick={() => router.push(tab.path)}
                className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
              >
                <span>{tab.name}</span>
              </div>
            );
          })}
        </nav>
      </aside>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className={styles.formCard}>
          <h2 className={styles.heading}>Add Salary Component</h2>
          <form className={styles.form} style={{ width: "100%" }} onSubmit={handleSave}>
            <div className={styles.row}>
              <input className={styles.input} type="text" placeholder="Salary Component*" value={salary.component} onChange={e => setSalary(s => ({ ...s, component: e.target.value }))} />
              <select className={styles.select} value={salary.payGrade} onChange={e => setSalary(s => ({ ...s, payGrade: e.target.value }))}>
                <option value="">-- Select --</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
              <select className={styles.select} value={salary.payFrequency} onChange={e => setSalary(s => ({ ...s, payFrequency: e.target.value }))}>
                <option value="">-- Select --</option>
                <option value="Monthly">Monthly</option>
                <option value="Weekly">Weekly</option>
                <option value="Yearly">Yearly</option>
              </select>
            </div>
            <div className={styles.row}>
              <select className={styles.select} value={salary.currency} onChange={e => setSalary(s => ({ ...s, currency: e.target.value }))}>
                <option value="">-- Select --</option>
                <option value="PKR">PKR</option>
                <option value="USD">USD</option>
                <option value="INR">INR</option>
                <option value="AED">AED</option>
              </select>
              <input className={styles.input} type="number" placeholder="Amount*" value={salary.amount} onChange={e => setSalary(s => ({ ...s, amount: e.target.value }))} />
            </div>
            <div className={styles.row}>
              <textarea className={styles.input} placeholder="Comments" value={salary.comments} onChange={e => setSalary(s => ({ ...s, comments: e.target.value }))} style={{ minHeight: 60, resize: "vertical" }} />
            </div>
            <div style={{ margin: "18px 0 10px 0", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 600 }}>Include Direct Deposit Details</span>
              <label style={{ display: "inline-block", position: "relative", width: 40, height: 22 }}>
                <input type="checkbox" checked={salary.directDeposit} onChange={e => setSalary(s => ({ ...s, directDeposit: e.target.checked }))} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", cursor: "pointer", top: 0, left: 0, right: 0, bottom: 0, background: salary.directDeposit ? "#FFA726" : "#E2E8F0", borderRadius: 22, transition: "background 0.2s" }}></span>
                <span style={{ position: "absolute", left: salary.directDeposit ? 20 : 2, top: 2, width: 18, height: 18, background: "#fff", borderRadius: "50%", boxShadow: "0 1px 4px rgba(0,82,204,0.12)", transition: "left 0.2s" }}></span>
              </label>
            </div>
            {salary.directDeposit && (
              <div>
                <div className={styles.row}>
                  <input className={styles.input} type="text" placeholder="Account Number*" value={salary.accountNumber} onChange={e => setSalary(s => ({ ...s, accountNumber: e.target.value }))} />
                  <select className={styles.select} value={salary.accountType} onChange={e => setSalary(s => ({ ...s, accountType: e.target.value }))}>
                    <option value="">-- Select --</option>
                    <option value="Savings">Savings</option>
                    <option value="Current">Current</option>
                  </select>
                </div>
                <div className={styles.row}>
                  <input className={styles.input} type="text" placeholder="Routing Number*" value={salary.routingNumber} onChange={e => setSalary(s => ({ ...s, routingNumber: e.target.value }))} />
                  <input className={styles.input} type="number" placeholder="Amount*" value={salary.depositAmount} onChange={e => setSalary(s => ({ ...s, depositAmount: e.target.value }))} />
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 18 }}>
              <button type="button" style={{ background: "#fff", color: "#8BC34A", border: "1px solid #8BC34A", borderRadius: 8, padding: "10px 32px", fontWeight: 600, fontSize: "1.08rem", cursor: "pointer" }}>Cancel</button>
              <button type="submit" style={{ background: "#8BC34A", color: "#fff", border: "none", borderRadius: 8, padding: "10px 32px", fontWeight: 600, fontSize: "1.08rem", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,82,204,0.10)" }}>Save</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
