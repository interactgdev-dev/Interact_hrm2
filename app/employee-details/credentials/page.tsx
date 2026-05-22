"use client";
// ...existing code...
import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import styles from "../../add-employee/add-employee.module.css";
import { useRouter } from "next/navigation";

const employeeTabs = [
  { name: "Employee List", path: "/employee-list" },
  { name: "Personal Details", path: "/employee-details/personal" },
  { name: "Contact Details", path: "/employee-details/contact" },
  { name: "Emergency Contacts", path: "/employee-details/emergency" },
  { name: "Dependents", path: "/employee-details/dependents" },
  { name: "Job", path: "/employee-details/job" },
  { name: "Salary", path: "/employee-details/salary" }
];

function CredentialsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const employeeId = searchParams?.get("employeeId") || "";
  const [credentials, setCredentials] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(true);

  const fetchCredentials = () => {
    if (!employeeId) return;
    setLoading(true);
    // API endpoint removed
    setCredentials(null);
    setLoading(false);
  };

  useEffect(() => {
    fetchCredentials();
  }, [employeeId]);

  const handleUpdatePassword = async () => {
    if (!employeeId || !newPassword) return;
    // API endpoint removed
    setNewPassword("");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F7FAFC" }}>
      <aside className={styles.sidebar}>
        <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", margin: "18px 0 12px 0" }}>
          <button
            aria-label="Back to Dashboard"
            onClick={() => router.push("/dashboard")}
            style={{ background: "#fff", border: "none", borderRadius: "50%", boxShadow: "0 2px 8px rgba(0,82,204,0.10)", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="14" fill="#0052CC" />
              <path d="M16.5 9L12.5 14L16.5 19" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <nav className={styles.nav}>
          {employeeTabs.map(tab => {
            const isActive = pathname?.startsWith(tab.path) ?? false;
            return (
              <div
                key={tab.name}
                onClick={() => router.push(tab.path + (tab.name === "Employee Credentials" ? `?employeeId=${employeeId}` : ""))}
                className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
              >
                <span>{tab.name}</span>
              </div>
            );
          })}
        </nav>
      </aside>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className={styles.formCard} style={{ maxWidth: 480, margin: "32px auto" }}>
          <h2 className={styles.heading} style={{ textAlign: "center" }}>Employee Credentials</h2>
          {loading ? (
            <div>Loading credentials...</div>
          ) : credentials ? (
            <div>
              <div><b>Username:</b> {credentials.username}</div>
              <div><b>Password:</b> {showPassword ? credentials.password : "********"}</div>
              <button onClick={() => setShowPassword(v => !v)} style={{ marginTop: 8 }}>{showPassword ? "Hide" : "Show"} Password</button>
              <div style={{ marginTop: 24 }}>
                <input
                  type="text"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #E2E8F0", width: "100%", marginBottom: 8 }}
                />
                <button
                  onClick={handleUpdatePassword}
                  style={{ background: "linear-gradient(90deg, #0052CC 0%, #2B6CB0 100%)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontWeight: 600, fontSize: "1rem", boxShadow: "0 2px 8px rgba(0,82,204,0.10)", cursor: "pointer", transition: "background 0.2s" }}
                >
                  Update Password
                </button>
              </div>
            </div>
          ) : (
            <div>No credentials found.</div>
          )}
        </div>
      </div>
    </div>
  );
}



const CredentialsPage = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <CredentialsPageInner />
  </Suspense>
);

export default CredentialsPage;
