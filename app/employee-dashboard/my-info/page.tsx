"use client";
import { useEffect, useState } from "react";
import styles from "./my-info.module.css";
import { FaKey, FaEnvelope, FaUser, FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";

export default function MyInfoPage() {
  const [data, setData] = useState<any>(null);
  const [jobDetails, setJobDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsError, setCredentialsError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<{ id: number | null; username: string; email: string; currentPassword: string }>(
    { id: null, username: "", email: "", currentPassword: "" }
  );

  useEffect(() => {
    // Get employee ID from session/localStorage
    const employeeId = localStorage.getItem("employeeId") || sessionStorage.getItem("employeeId");
    
    if (!employeeId) {
      setError("Employee ID not found. Please login again.");
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`/api/my-info?employeeId=${employeeId}`).then(res => res.json()),
      fetch(`/api/employee_jobs?employeeId=${employeeId}`).then(res => res.json())
    ])
      .then(([resultInfo, resultJob]) => {
        if (resultInfo.success) {
          setData(resultInfo.data);
        } else {
          setError(resultInfo.error || "Failed to fetch data");
        }
        
        if (resultJob.success && resultJob.job) {
          setJobDetails(resultJob.job);
        }
        
        setLoading(false);
      })
      .catch(err => {
        setError("Failed to fetch data: " + String(err));
        setLoading(false);
      });

    // Load credentials
    loadCredentials();
  }, []);

  async function loadCredentials() {
    setCredentialsLoading(true);
    try {
      const loginId = localStorage.getItem("loginId");
      if (!loginId) {
        setCredentialsError("Login is required. Please sign in again.");
        setCredentialsLoading(false);
        return;
      }

      const employee = await fetchEmployee(loginId);
      if (!employee) {
        setCredentialsError("Could not find your employee record.");
        setCredentialsLoading(false);
        return;
      }

      const employeeId = Number(employee.id ?? employee.employee_id);
      if (!employeeId) {
        setCredentialsError("Your profile is missing an employee id.");
        setCredentialsLoading(false);
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
      setCredentialsError("Failed to load your credentials. Please refresh and try again.");
    } finally {
      setCredentialsLoading(false);
    }
  }

  async function fetchEmployee(loginId: string): Promise<any> {
    const queryParam = loginId.includes("@") ? `email=${encodeURIComponent(loginId)}` : `username=${encodeURIComponent(loginId)}`;

    try {
      const [primary, fallback] = await Promise.all([
        fetch(`/api/hrm_employees?${queryParam}`).then(res => res.json()).catch(() => ({ success: false })),
        fetch(`/api/hrm_employees?employeeId=${encodeURIComponent(loginId)}`).then(res => res.json()).catch(() => ({ success: false }))
      ]);

      const data = primary.success ? primary : fallback;
      return data.success ? data.employee : null;
    } catch (err) {
      return null;
    }
  }

  async function fetchContact(employeeId: number): Promise<any> {
    try {
      const res = await fetch(`/api/employee_contacts?employeeId=${employeeId}`);
      const data = await res.json();
      return data.success ? data.contact : null;
    } catch (err) {
      return null;
    }
  }

  async function handlePasswordUpdate(event: React.FormEvent) {
    event.preventDefault();
    setCredentialsError("");
    setSuccess("");

    if (!credentials.id) {
      setCredentialsError("Missing employee id. Please reload the page.");
      return;
    }
    if (!newPassword.trim()) {
      setCredentialsError("New password is required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setCredentialsError("Passwords do not match.");
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
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setCredentialsError(data.error || "Unable to update password.");
      }
    } catch (err) {
      setCredentialsError("Unable to update password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading your information...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>My Information</h1>
        <p className={styles.subtitle}>Your personal and contact details</p>
      </div>

      <div className={styles.card}>
        {/* Shift Timing Section */}
        {/* First Line: Employee ID & Pseudonym */}
        <div className={styles.topRow}>
          <div className={styles.badge}>
            <span className={styles.badgeLabel}>Employee ID</span>
            <span className={styles.badgeValue}>{data?.employee_id || 'N/A'}</span>
          </div>
          {data?.pseudonym && (
            <div className={styles.badge}>
              <span className={styles.badgeLabel}>Pseudo Name</span>
              <span className={styles.badgeValue}>{data.pseudonym}</span>
            </div>
          )}
        </div>

        {/* Personal Information Section */}
        <div className={styles.section}>
           <h2 className={styles.sectionTitle}>Personal Information</h2>
           <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>Full Name</label>
              <div className={styles.value}>{`${data?.first_name || ''} ${data?.last_name || ''}`}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CNIC Number</label>
              <div className={styles.value}>{data?.cnic_number || 'Not Provided'}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CNIC Address</label>
              <div className={styles.value}>{data?.cnic_address || 'Not Provided'}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Shift Timing</label>
              <div className={styles.value}>{data?.shift_timing || 'Not Assigned'}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Working Days</label>
              <div className={styles.value}>Monday to Friday</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Employment Status</label>
              <div className={`${styles.value} ${styles.status}`}>
                <span className={data?.employment_status === 'Permanent' ? styles.permanent : styles.probation}>
                  {data?.employment_status || 'Not Set'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Job Details Section */}
        {jobDetails && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Job Details</h2>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Date of Joining</label>
                <div className={styles.value}>
                  {jobDetails.joined_date ? new Date(jobDetails.joined_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not Set'}
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Job Title</label>
                <div className={styles.value}>{jobDetails.job_title || 'Not Set'}</div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Job Category</label>
                <div className={styles.value}>{jobDetails.job_category || 'Not Set'}</div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Location</label>
                <div className={styles.value}>{jobDetails.location || 'Not Set'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Contact Information Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Contact Information</h2>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>Work Email</label>
              <div className={styles.value}>
                {data?.email_work ? (
                  <a href={`mailto:${data.email_work}`} className={styles.link}>
                    {data.email_work}
                  </a>
                ) : (
                  'Not Provided'
                )}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Other Email</label>
              <div className={styles.value}>
                {data?.email_other ? (
                  <a href={`mailto:${data.email_other}`} className={styles.link}>
                    {data.email_other}
                  </a>
                ) : (
                  'Not Provided'
                )}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Phone Number</label>
              <div className={styles.value}>
                {data?.phone_mobile ? (
                  <a href={`tel:${data.phone_mobile}`} className={styles.link}>
                    {data.phone_mobile}
                  </a>
                ) : (
                  'Not Provided'
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Credentials Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>My Credentials</h2>
          
          {credentialsLoading ? (
            <div className={styles.credentialsLoading}>Loading credentials...</div>
          ) : (
            <>
              {credentialsError && (
                <div className={styles.credentialsError}>
                  <FaExclamationTriangle />
                  <span>{credentialsError}</span>
                </div>
              )}
              {success && (
                <div className={styles.credentialsSuccess}>
                  <FaCheckCircle />
                  <span>{success}</span>
                </div>
              )}

              <div className={styles.credentialsGrid}>
                <div className={styles.field}>
                  <label className={styles.label}><FaUser /> Username</label>
                  <div className={styles.value}>{credentials.username || "Not set"}</div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}><FaEnvelope /> Email</label>
                  <div className={styles.value}>{credentials.email || "Not available"}</div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}><FaKey /> Current Password</label>
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

              <form className={styles.credentialsForm} onSubmit={handlePasswordUpdate}>
                <div className={styles.formRow}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="newPassword">New Password</label>
                    <input
                      id="newPassword"
                      name="newPassword"
                      type="password"
                      className={styles.credentialsInput}
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
                      className={styles.credentialsInput}
                      placeholder="Re-enter the new password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>
                <p className={styles.hint}>Username and email are read-only. Use this form to set a new password for your account.</p>

                <button type="submit" className={styles.updateButton} disabled={saving}>
                  {saving ? "Updating..." : "Update Password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
