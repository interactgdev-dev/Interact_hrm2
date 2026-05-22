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

export default function ContactDetailsPage() {
  const router = useRouter();
  const pathname = usePathname();
  // State for form fields
  const [address, setAddress] = useState({
    street1: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
    country: ""
  });
  const [telephone, setTelephone] = useState({
    home: "",
    mobile: "",
    work: ""
  });
  const [email, setEmail] = useState({
    work: "",
    other: ""
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const eid = window.prompt('Enter Employee ID to save contact details for (employee_id):');
    if (!eid) {
      alert('Employee ID is required');
      return;
    }
    const payload = {
      details: {
        employeeId: eid,
        contact: {
          address,
          telephone,
          email
        }
      }
    };
    try {
      // Example placeholder for saving contact details
      const res = await fetch('/api/employee_contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) alert('Contact details saved'); else alert('Save failed: ' + (data.error || 'Unknown'));
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
          <h2 className={styles.heading}>Contact Details</h2>
          <form className={styles.form} style={{ width: "100%" }} onSubmit={handleSave}>
            {/* Address Section */}
            <div style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: 10 }}>Address</div>
            <div className={styles.row}>
              <input className={styles.input} type="text" placeholder="Street 1" value={address.street1} onChange={e => setAddress(a => ({ ...a, street1: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="Street 2" value={address.street2} onChange={e => setAddress(a => ({ ...a, street2: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="City" value={address.city} onChange={e => setAddress(a => ({ ...a, city: e.target.value }))} />
            </div>
            <div className={styles.row}>
              <input className={styles.input} type="text" placeholder="State/Province" value={address.state} onChange={e => setAddress(a => ({ ...a, state: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="Zip/Postal Code" value={address.zip} onChange={e => setAddress(a => ({ ...a, zip: e.target.value }))} />
              <select className={styles.select} value={address.country} onChange={e => setAddress(a => ({ ...a, country: e.target.value }))}>
                <option value="">-- Select --</option>
                <option value="Pakistan">Pakistan</option>
                <option value="India">India</option>
                <option value="UAE">UAE</option>
                <option value="USA">USA</option>
                <option value="UK">UK</option>
                <option value="Other">Other</option>
              </select>
            </div>
            {/* Telephone Section */}
            <div style={{ fontWeight: 600, fontSize: "1.1rem", margin: "18px 0 10px 0" }}>Telephone</div>
            <div className={styles.row}>
              <input className={styles.input} type="text" placeholder="Home" value={telephone.home} onChange={e => setTelephone(t => ({ ...t, home: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="Mobile" value={telephone.mobile} onChange={e => setTelephone(t => ({ ...t, mobile: e.target.value }))} />
              <input className={styles.input} type="text" placeholder="Work" value={telephone.work} onChange={e => setTelephone(t => ({ ...t, work: e.target.value }))} />
            </div>
            {/* Email Section */}
            <div style={{ fontWeight: 600, fontSize: "1.1rem", margin: "18px 0 10px 0" }}>Email</div>
            <div className={styles.row}>
              <input className={styles.input} type="email" placeholder="Work Email" value={email.work} onChange={e => setEmail(em => ({ ...em, work: e.target.value }))} />
              <input className={styles.input} type="email" placeholder="Other Email" value={email.other} onChange={e => setEmail(em => ({ ...em, other: e.target.value }))} />
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
