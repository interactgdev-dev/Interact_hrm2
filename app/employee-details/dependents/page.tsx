"use client";
import React from "react";
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

export default function DependentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [dependents, setDependents] = React.useState([
    { name: "", relationship: "", dob: "" }
  ]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const eid = window.prompt('Enter Employee ID to save dependents for (employee_id):');
    if (!eid) { alert('Employee ID is required'); return; }
    const payload = { details: { employeeId: eid, dependents } };
    try {
      // Example placeholder for saving dependents
      const res = await fetch('/api/employee_dependents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) alert('Dependents saved'); else alert('Save failed: ' + (data.error || 'Unknown'));
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
          <h2>Dependents</h2>
          <form className={styles.form} style={{ width: "100%" }} onSubmit={handleSave}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Dependent 1</div>
            <div className={styles.row}>
              <input className={styles.input} placeholder="Name" value={dependents[0].name} onChange={e => setDependents(d => { const c = [...d]; c[0].name = e.target.value; return c; })} />
              <input className={styles.input} placeholder="Relationship" value={dependents[0].relationship} onChange={e => setDependents(d => { const c = [...d]; c[0].relationship = e.target.value; return c; })} />
              <input className={styles.input} type="date" placeholder="DOB" value={dependents[0].dob} onChange={e => setDependents(d => { const c = [...d]; c[0].dob = e.target.value; return c; })} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button type="submit" style={{ background: "#8BC34A", color: "#fff", border: "none", borderRadius: 8, padding: "10px 32px", fontWeight: 600, fontSize: "1.08rem", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,82,204,0.10)" }}>Save</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
