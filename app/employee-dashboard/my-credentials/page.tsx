"use client";
import React, { useEffect, useState } from "react";
import styles from "./my-credentials.module.css";
import { FaKey, FaEnvelope, FaUser, FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";

interface EmployeeRecord {
  id?: number;
  employee_id?: number;
  username?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
}

interface ContactRecord {
  email_work?: string;
  email_other?: string;
}

export default function MyCredentialsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [credentials, setCredentials] = useState<{ id: number | null; username: string; email: string; currentPassword: string }>(
    { id: null, username: "", email: "", currentPassword: "" }
  );

  useEffect(() => {
    loadCredentials();
  }, []);

  async function loadCredentials() {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const loginId = typeof window !== "undefined" ? localStorage.getItem("loginId") : null;
      if (!loginId) {
        setError("Login is required. Please sign in again.");
        setLoading(false);
        return;
      }

      const employee = await fetchEmployee(loginId);
      if (!employee) {
        setError("Could not find your employee record.");
        setLoading(false);
        return;
      }

      const employeeId = Number(employee.id ?? employee.employee_id);
      if (!employeeId) {
        setError("Your profile is missing an employee id.");
        setLoading(false);
        return;
      }

      const contact = await fetchContact(employeeId);
      const email = contact?.email_work || contact?.email_other || (loginId.includes("@") ? loginId : "");

      setCredentials({
        id: employeeId,
        username: employee.username || loginId,
        email,
        currentPassword: employee.password || ""
      });
    } catch (err) {
      setError("Failed to load your credentials. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchEmployee(loginId: string): Promise<EmployeeRecord | null> {
    const queryParam = loginId.includes("@") ? `email=${encodeURIComponent(loginId)}` : `username=${encodeURIComponent(loginId)}`;

    try {
      const [primary, fallback] = await Promise.all([
        fetch(`/api/hrm_employees?${queryParam}`).then(res => res.json()).catch(() => ({ success: false })),
        fetch(`/api/hrm_employees?employeeId=${encodeURIComponent(loginId)}`).then(res => res.json()).catch(() => ({ success: false }))
      ]);

      const data = primary.success ? primary : fallback;
      return data.success ? (data.employee as EmployeeRecord) : null;
    } catch (err) {
      return null;
    }
  }

  async function fetchContact(employeeId: number): Promise<ContactRecord | null> {
    try {
      const res = await fetch(`/api/employee_contacts?employeeId=${employeeId}`);
      const data = await res.json();
      return data.success ? (data.contact as ContactRecord) : null;
    } catch (err) {
      return null;
    }
  }

  async function handlePasswordUpdate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!credentials.id) {
      setError("Missing employee id. Please reload the page.");
      return;
    }
    if (!newPassword.trim()) {
      setError("New password is required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/employee-credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: credentials.id, password: newPassword })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Password updated successfully.");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setError(data.error || "Unable to update password.");
      }
    } catch (err) {
      setError("Unable to update password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleWrap}>
          <FaKey className={styles.titleIcon} />
          <div>
            <h1 className={styles.title}>My Credentials</h1>
            <p className={styles.subtitle}>View your login details and update your password.</p>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        {loading ? (
          <div className={styles.loading}>Loading your credentials...</div>
        ) : (
          <>
            {error && (
              <div className={`${styles.banner} ${styles.error}`}>
                <FaExclamationTriangle />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className={`${styles.banner} ${styles.success}`}>
                <FaCheckCircle />
                <span>{success}</span>
              </div>
            )}

            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <div className={styles.infoLabel}><FaUser /> Username</div>
                <div className={styles.infoValue}>{credentials.username || "Not set"}</div>
              </div>
              <div className={styles.infoItem}>
                <div className={styles.infoLabel}><FaEnvelope /> Email</div>
                <div className={styles.infoValue}>{credentials.email || "Not available"}</div>
              </div>
              <div className={styles.infoItem}>
                <div className={styles.infoLabel}><FaKey /> Current Password</div>
                <div className={styles.passwordDisplay}>
                  <span>{showPassword ? credentials.currentPassword : "••••••••"}</span>
                  <button
                    type="button"
                    className={styles.toggleButton}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <form className={styles.form} onSubmit={handlePasswordUpdate}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  className={styles.input}
                  placeholder="Enter a new password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  className={styles.input}
                  placeholder="Re-enter the new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />
              </div>
              <p className={styles.hint}>Username and email are read-only. Use this form to set a new password for your account.</p>

              <button type="submit" className={styles.primaryButton} disabled={saving}>
                {saving ? "Saving..." : "Update Password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
