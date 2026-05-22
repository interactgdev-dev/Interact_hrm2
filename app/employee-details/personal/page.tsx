"use client";
import React, { useState, useEffect } from "react";
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

export default function PersonalDetailsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [details, setDetails] = useState({
    fullName1: "",
    fullName2: "",
    fullName3: "",
    employeeId: "",
    otherId: "",
    licenseNumber: "",
    licenseExpiry: "",
    nationality: "",
    maritalStatus: "",
    dob: "",
    gender: ""
  });

  useEffect(() => {
    // Get employeeId from query string
    const params = new URLSearchParams(window.location.search);
    const empId = params.get('employeeId');
    if (empId) {
      // API endpoint removed
      if (false) {
        setDetails(d => ({
          ...d,
          fullName1: "",
          fullName2: "",
          fullName3: "",
          employeeId: "",
          dob: "",
          gender: "",
          maritalStatus: "",
          nationality: "" // or data.employee.nationality || "" if data is available
        }));
      }
    }
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // send personal data to API (will upsert employees)
    const payload = {
      firstName: details.fullName1,
      middleName: details.fullName2,
      lastName: details.fullName3,
      employeeId: details.employeeId,
      dob: details.dob,
      gender: details.gender,
      maritalStatus: details.maritalStatus,
      nationality: details.nationality,
      // other fields can be added as needed
    };
    try {
      // Example placeholder for saving personal details
      const res = await fetch('/api/employee_personal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) alert('Personal details saved'); else alert('Save failed: ' + (data.error || 'Unknown'));
    } catch (err) {
      alert('Save failed: ' + String(err));
    }
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
          <h2 className={styles.heading}>Personal Details</h2>
          <form className={styles.form} style={{ width: "100%" }} onSubmit={handleSave}>
            <div style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: 10 }}>Employee Full Name*</div>
            <div className={styles.row}>
              <input className={styles.input} type="text" placeholder="First" value={details.fullName1} onChange={e => setDetails(d => ({ ...d, fullName1: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="Middle" value={details.fullName2} onChange={e => setDetails(d => ({ ...d, fullName2: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="Last" value={details.fullName3} onChange={e => setDetails(d => ({ ...d, fullName3: e.target.value }))} />
            </div>
            <div className={styles.row}>
              <input className={styles.input} type="text" placeholder="Employee Id" value={details.employeeId} onChange={e => setDetails(d => ({ ...d, employeeId: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="Other Id" value={details.otherId} onChange={e => setDetails(d => ({ ...d, otherId: e.target.value }))} />
            </div>
            <div className={styles.row}>
              <input className={styles.input} type="text" placeholder="Driver's License Number" value={details.licenseNumber} onChange={e => setDetails(d => ({ ...d, licenseNumber: e.target.value }))} />
              <input className={styles.input} type="date" placeholder="License Expiry Date" value={details.licenseExpiry} onChange={e => setDetails(d => ({ ...d, licenseExpiry: e.target.value }))} />
            </div>
            <div className={styles.row}>
              <select className={styles.select} value={details.nationality} onChange={e => setDetails(d => ({ ...d, nationality: e.target.value }))}>
                <option value="">-- Select --</option>
                <option value="Pakistan">Pakistan</option>
                <option value="India">India</option>
                <option value="UAE">UAE</option>
                <option value="USA">USA</option>
                <option value="UK">UK</option>
                <option value="Other">Other</option>
              </select>
              <select className={styles.select} value={details.maritalStatus} onChange={e => setDetails(d => ({ ...d, maritalStatus: e.target.value }))}>
                <option value="">-- Select --</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className={styles.row}>
              <input className={styles.input} type="date" placeholder="Date of Birth" value={details.dob} onChange={e => setDetails(d => ({ ...d, dob: e.target.value }))} />
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <span style={{ fontWeight: 600 }}>Gender</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" name="gender" value="Male" checked={details.gender === "Male"} onChange={e => setDetails(d => ({ ...d, gender: e.target.value }))} /> Male
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" name="gender" value="Female" checked={details.gender === "Female"} onChange={e => setDetails(d => ({ ...d, gender: e.target.value }))} /> Female
                </label>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button type="submit" style={{ background: "#8BC34A", color: "#fff", border: "none", borderRadius: 8, padding: "10px 32px", fontWeight: 600, fontSize: "1.08rem", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,82,204,0.10)" }}>Save</button>
            </div>
            <div className={styles.note}>* Required</div>
          </form>
        </div>
      </div>
    </div>
  );
}
