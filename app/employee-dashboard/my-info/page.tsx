"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FaKey,
  FaEnvelope,
  FaUser,
  FaCheckCircle,
  FaExclamationTriangle,
  FaIdBadge,
  FaBriefcase,
  FaAddressCard,
} from "react-icons/fa";
import { EmployeeAvatar } from "../../components/EmployeeAvatar";
import { employeeInitials } from "../../../lib/employee-photo-shared";
import { BackToDashboard } from "../components/BackToDashboard";
import styles from "./my-info.module.css";
import filesStyles from "./my-files.module.css";
import { MyFilesTab } from "./MyFilesTab";

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
  const [photo, setPhoto] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "myfiles">("profile");
  const [storedEmployeeId, setStoredEmployeeId] = useState("");
  const [credentials, setCredentials] = useState<{
    id: number | null;
    username: string;
    email: string;
    currentPassword: string;
  }>({ id: null, username: "", email: "", currentPassword: "" });

  useEffect(() => {
    const employeeId =
      localStorage.getItem("employeeId") || sessionStorage.getItem("employeeId");
    if (employeeId) setStoredEmployeeId(employeeId);

    if (!employeeId) {
      setError("Employee ID not found. Please login again.");
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`/api/my-info?employeeId=${employeeId}`).then((res) => res.json()),
      fetch(`/api/employee_jobs?employeeId=${employeeId}`).then((res) => res.json()),
      fetch(`/api/employee-profile?employeeId=${encodeURIComponent(employeeId)}`)
        .then((res) => res.json())
        .catch(() => ({ success: false })),
    ])
      .then(([resultInfo, resultJob, profile]) => {
        if (resultInfo.success) {
          setData(resultInfo.data);
        } else {
          setError(resultInfo.error || "Failed to fetch data");
        }

        if (resultJob.success && resultJob.job) {
          setJobDetails(resultJob.job);
        }

        if (profile?.success && profile.photo) {
          setPhoto(profile.photo);
        }

        setLoading(false);
      })
      .catch((err) => {
        setError("Failed to fetch data: " + String(err));
        setLoading(false);
      });

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
      const email =
        contact?.email_work ||
        contact?.email_other ||
        (loginId.includes("@") ? loginId : "");

      setCredentials({
        id: employeeId,
        username: employee.username || loginId,
        email,
        currentPassword: employee.password || "",
      });
      setStoredEmployeeId(String(employeeId));
    } catch {
      setCredentialsError("Failed to load your credentials. Please refresh and try again.");
    } finally {
      setCredentialsLoading(false);
    }
  }

  async function fetchEmployee(loginId: string): Promise<any> {
    const queryParam = loginId.includes("@")
      ? `email=${encodeURIComponent(loginId)}`
      : `username=${encodeURIComponent(loginId)}`;

    try {
      const [primary, fallback] = await Promise.all([
        fetch(`/api/hrm_employees?${queryParam}`)
          .then((res) => res.json())
          .catch(() => ({ success: false })),
        fetch(`/api/hrm_employees?employeeId=${encodeURIComponent(loginId)}`)
          .then((res) => res.json())
          .catch(() => ({ success: false })),
      ]);

      const data = primary.success ? primary : fallback;
      return data.success ? data.employee : null;
    } catch {
      return null;
    }
  }

  async function fetchContact(employeeId: number): Promise<any> {
    try {
      const res = await fetch(`/api/employee_contacts?employeeId=${employeeId}`);
      const data = await res.json();
      return data.success ? data.contact : null;
    } catch {
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
        body: JSON.stringify({ id: credentials.id, password: newPassword }),
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
    } catch {
      setCredentialsError("Unable to update password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fullName = `${data?.first_name || ""} ${data?.last_name || ""}`.trim() || "Employee";

  const profileSubtitle = useMemo(() => {
    const parts = [
      (jobDetails?.job_title || "").trim(),
      (data?.pseudonym || "").trim(),
      (data?.department_name || "").trim(),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Employee profile";
  }, [jobDetails?.job_title, data?.pseudonym, data?.department_name]);

  const statusClass = (status: string) => {
    if (status === "Permanent") return styles.permanent;
    if (status === "Probation") return styles.probation;
    return styles.otherStatus;
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading your information…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <BackToDashboard />
            <h1 className={styles.title}>My Info</h1>
            <p className={styles.subtitle}>Personal details and your employee file folder</p>
          </div>
        </header>

        <div className={filesStyles.tabs}>
          <button
            type="button"
            className={`${filesStyles.tab} ${activeTab === "profile" ? filesStyles.tabActive : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            Profile
          </button>
          <button
            type="button"
            className={`${filesStyles.tab} ${activeTab === "myfiles" ? filesStyles.tabActive : ""}`}
            onClick={() => setActiveTab("myfiles")}
          >
            My Files
          </button>
        </div>

        {activeTab === "myfiles" ? (
          <section className={styles.card}>
            <MyFilesTab employeeId={storedEmployeeId || String(credentials.id || "")} />
          </section>
        ) : (
        <>

        <div className={styles.profileCard}>
          <EmployeeAvatar
            name={fullName}
            initials={employeeInitials(fullName)}
            photo={photo}
            size="lg"
          />
          <div className={styles.profileMeta}>
            <div className={styles.profileName}>{fullName}</div>
            <div className={styles.profileSub}>{profileSubtitle}</div>
          </div>
        </div>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>
              <FaIdBadge />
            </span>
            Personal information
          </h2>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>Full name</label>
              <div className={styles.value}>{fullName}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CNIC number</label>
              <div className={styles.value}>{data?.cnic_number || "Not provided"}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CNIC address</label>
              <div className={styles.value}>{data?.cnic_address || "Not provided"}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Shift timing</label>
              <div className={styles.value}>{data?.shift_timing || "Not assigned"}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Working days</label>
              <div className={styles.value}>Monday to Friday</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Employment status</label>
              <div className={styles.value}>
                <span
                  className={`${styles.statusPill} ${statusClass(data?.employment_status || "")}`}
                >
                  {data?.employment_status || "Not set"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {jobDetails ? (
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionIcon}>
                <FaBriefcase />
              </span>
              Job details
            </h2>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Date of joining</label>
                <div className={styles.value}>
                  {jobDetails.joined_date
                    ? new Date(jobDetails.joined_date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "Not set"}
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Job title</label>
                <div className={styles.value}>{jobDetails.job_title || "Not set"}</div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Job category</label>
                <div className={styles.value}>{jobDetails.job_category || "Not set"}</div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Location</label>
                <div className={styles.value}>{jobDetails.location || "Not set"}</div>
              </div>
            </div>
          </section>
        ) : null}

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>
              <FaAddressCard />
            </span>
            Contact information
          </h2>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>Work email</label>
              <div className={styles.value}>
                {data?.email_work ? (
                  <a href={`mailto:${data.email_work}`} className={styles.link}>
                    {data.email_work}
                  </a>
                ) : (
                  "Not provided"
                )}
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Other email</label>
              <div className={styles.value}>
                {data?.email_other ? (
                  <a href={`mailto:${data.email_other}`} className={styles.link}>
                    {data.email_other}
                  </a>
                ) : (
                  "Not provided"
                )}
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Phone number</label>
              <div className={styles.value}>
                {data?.phone_mobile ? (
                  <a href={`tel:${data.phone_mobile}`} className={styles.link}>
                    {data.phone_mobile}
                  </a>
                ) : (
                  "Not provided"
                )}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>
              <FaKey />
            </span>
            My credentials
          </h2>

          {credentialsLoading ? (
            <div className={styles.credentialsLoading}>Loading credentials…</div>
          ) : (
            <>
              {credentialsError ? (
                <div className={styles.alertError}>
                  <FaExclamationTriangle />
                  <span>{credentialsError}</span>
                </div>
              ) : null}
              {success ? (
                <div className={styles.alertSuccess}>
                  <FaCheckCircle />
                  <span>{success}</span>
                </div>
              ) : null}

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label className={styles.label}>
                    <FaUser /> Username
                  </label>
                  <div className={styles.value}>{credentials.username || "Not set"}</div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>
                    <FaEnvelope /> Email
                  </label>
                  <div className={styles.value}>{credentials.email || "Not available"}</div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>
                    <FaKey /> Current password
                  </label>
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
                    <label className={styles.label} htmlFor="newPassword">
                      New password
                    </label>
                    <input
                      id="newPassword"
                      name="newPassword"
                      type="password"
                      className={styles.input}
                      placeholder="Enter a new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="confirmPassword">
                      Confirm password
                    </label>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      className={styles.input}
                      placeholder="Re-enter the new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Username and email are read-only. Use this form to set a new password for your
                  account.
                </p>
                <button type="submit" className={styles.submitBtn} disabled={saving}>
                  {saving ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </section>
        </>
        )}
      </div>
    </div>
  );
}
