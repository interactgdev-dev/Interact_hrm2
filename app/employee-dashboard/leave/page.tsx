"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
import styles from "./leave.module.css";

interface Leave {
  id: number;
  employee_id?: string | number;
  leave_category: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  documents: string[];
  status: string;
  requested_at: string;
  document_paths?: string | string[];
  admin_remark?: string;
}

const LEAVE_CATEGORIES = [
  { value: "annual", label: "Annual" },
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "bereavement", label: "Bereavement" },
  { value: "other", label: "Other" },
];

function formatDate(dateString: string) {
  if (!dateString) return "";
  const d = new Date(dateString);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTime(dateTimeString: string) {
  if (!dateTimeString) return "";
  const dateStr = getDateStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const timeStr = getTimeStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year} ${timeStr}`;
}

function parseDocs(document_paths?: string | string[]) {
  if (!document_paths) return [];
  if (typeof document_paths === "string") {
    try {
      const parsed = JSON.parse(document_paths || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(document_paths) ? document_paths : [];
}

function statusBadgeClass(status: string) {
  if (status === "approved") return styles.badgeApproved;
  if (status === "rejected") return styles.badgeRejected;
  return styles.badgePending;
}

function calcDays(start: string, end: string) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

export default function LeavePage() {
  const [employeeId, setEmployeeId] = useState<string>("");
  const [employeeName, setEmployeeName] = useState<string>("");
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveBalance, setLeaveBalance] = useState(20);
  const [annualAllowance, setAnnualAllowance] = useState(20);
  const [employmentStatus, setEmploymentStatus] = useState<string>("Permanent");
  const [bereavementBalance, setBereavementBalance] = useState(3);
  const [category, setCategory] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<Leave | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const closeModal = () => {
    setModalOpen(false);
    setSelectedLeave(null);
  };

  useEffect(() => {
    const initEmployeeInfo = async () => {
      let empId = localStorage.getItem("employeeId") || "";
      let empName = localStorage.getItem("employeeName") || "";

      if (!empId) {
        const loginId = localStorage.getItem("loginId");
        if (loginId) {
          try {
            const res = await fetch(`/api/hrm_employees?employeeId=${loginId}`);
            const data = await res.json();
            if (data.success && data.employee) {
              empId = String(data.employee.id || data.employee.employee_id || loginId);
              empName = `${data.employee.first_name || ""} ${data.employee.middle_name || ""} ${data.employee.last_name || ""}`.trim();
              localStorage.setItem("employeeId", empId);
              localStorage.setItem("employeeName", empName);
            }
          } catch {
            /* keep empty */
          }
        }
      }

      setEmployeeId(empId);
      setEmployeeName(empName);
    };

    void initEmployeeInfo();
  }, []);

  const fetchLeaves = async () => {
    try {
      if (!employeeId) return;

      const res = await fetch(`/api/leaves?ts=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const data = await res.json();
      if (data.success) {
        const myLeaves = data.leaves.filter((l: Leave) => l.employee_id == employeeId);
        setLeaves(myLeaves);
      }

      const balanceRes = await fetch(`/api/leave-balance?employee_id=${employeeId}&ts=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const balanceData = await balanceRes.json();

      if (balanceData.success) {
        setLeaveBalance(balanceData.annualBalance || 0);
        setAnnualAllowance(balanceData.annualAllowance || 20);
        setBereavementBalance(balanceData.bereavementBalance || 0);
        setEmploymentStatus(balanceData.employment_status || "Permanent");
      }
    } catch {
      /* keep current state */
    }
  };

  useEffect(() => {
    if (!employeeId) return;
    void fetchLeaves();
    const intervalId = setInterval(() => {
      void fetchLeaves();
    }, 30000);
    return () => clearInterval(intervalId);
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new window.WebSocket(`${protocol}://${window.location.host}/api/ws`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "leave_update") void fetchLeaves();
        } catch {
          /* ignore */
        }
      };
      return () => ws.close();
    } catch {
      /* optional realtime */
    }
  }, [employeeId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const validFiles = files.filter((f) => f.type === "application/pdf" && f.size <= 100 * 1024 * 1024);
    setDocuments(validFiles);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      let uploadedFilePaths: string[] = [];
      if (documents.length > 0) {
        const formData = new FormData();
        formData.append("employee_id", employeeId || "");
        documents.forEach((file) => {
          formData.append("files", file);
        });

        const uploadRes = await fetch("/api/attachments", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) {
          setError(uploadData.error || "Failed to upload documents");
          setSubmitting(false);
          return;
        }
        uploadedFilePaths = uploadData.files.map((f: { url: string }) => f.url);
      }

      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          leave_category: category,
          start_date: startDate,
          end_date: endDate,
          total_days: calcDays(startDate, endDate),
          reason,
          document_paths: uploadedFilePaths.length > 0 ? uploadedFilePaths : [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Leave request submitted successfully.");
        void fetchLeaves();
        setCategory("annual");
        setStartDate("");
        setEndDate("");
        setReason("");
        setDocuments([]);
      } else {
        setError(data.error || "Failed to submit leave request");
      }
    } catch {
      setError("Failed to submit leave request");
    }
    setSubmitting(false);
  };

  const handleDocumentDownload = (docPath: string) => {
    const filename = docPath.split("/").pop() || docPath;
    const link = document.createElement("a");
    link.href = `/api/attachments/download?filename=${encodeURIComponent(filename)}`;
    link.download = filename;
    link.click();
  };

  const balanceLabel =
    employmentStatus === "Probation" ? "Leave balance" : "Annual leave balance";

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Leave</h1>

        <div className={styles.statRow}>
          <div className={`${styles.statCard} ${styles.statCardPurple}`}>
            <p className={styles.statLabel}>{balanceLabel}</p>
            <p className={styles.statValue}>
              {leaveBalance}
              <span style={{ fontSize: "1rem", fontWeight: 600, color: "#94a3b8" }}>
                {" "}
                / {annualAllowance}
              </span>
            </p>
            <p className={styles.statSub}>Days remaining this year</p>
          </div>
          <div className={`${styles.statCard} ${styles.statCardGreen}`}>
            <p className={styles.statLabel}>Bereavement leave</p>
            <p className={styles.statValue}>
              {bereavementBalance}
              <span style={{ fontSize: "1rem", fontWeight: 600, color: "#94a3b8" }}> / 3</span>
            </p>
            <p className={styles.statSub}>Days remaining</p>
          </div>
        </div>

        <form className={styles.formCard} onSubmit={handleSubmit}>
          <h2 className={styles.formTitle}>Apply for leave</h2>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="leave-category">
                Category
              </label>
              <select
                id="leave-category"
                className={styles.select}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {LEAVE_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="leave-start">
                Start date
              </label>
              <input
                id="leave-start"
                type="date"
                className={styles.input}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="leave-end">
                End date
              </label>
              <input
                id="leave-end"
                type="date"
                className={styles.input}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className={`${styles.field} ${styles.fieldFull}`}>
            <label className={styles.label} htmlFor="leave-reason">
              Reason
            </label>
            <textarea
              id="leave-reason"
              className={styles.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={3}
            />
          </div>

          <div className={`${styles.field} ${styles.fieldFull}`}>
            <label className={styles.label}>Attach documents (PDF only)</label>
            <div className={styles.fileRow}>
              <input
                id="leave-file-input"
                type="file"
                accept="application/pdf"
                multiple
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className={styles.fileBtn}
                onClick={() => document.getElementById("leave-file-input")?.click()}
              >
                Choose files
              </button>
              <span className={styles.fileHint}>Max 100MB per file</span>
            </div>
            {documents.length > 0 ? (
              <div className={styles.fileList}>
                {documents.map((f) => (
                  <div key={f.name}>📄 {f.name}</div>
                ))}
              </div>
            ) : null}
          </div>

          <button type="submit" className={styles.submitBtn} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit request"}
          </button>
          {error ? <div className={styles.alertError}>{error}</div> : null}
          {success ? <div className={styles.alertSuccess}>{success}</div> : null}
        </form>

        <h2 className={styles.sectionTitle}>Your leave requests</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Documents</th>
                <th>Status</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {leaves.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>
                    No leave requests yet.
                  </td>
                </tr>
              ) : (
                leaves.map((l) => {
                  const docs = parseDocs(l.document_paths);
                  return (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 600 }}>
                        {l.leave_category.charAt(0).toUpperCase() + l.leave_category.slice(1)}
                      </td>
                      <td>
                        {formatDate(l.start_date)} – {formatDate(l.end_date)}
                      </td>
                      <td>{l.total_days}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.chipBtn}
                          onClick={() => {
                            setSelectedLeave(l);
                            setModalOpen(true);
                          }}
                        >
                          View
                        </button>
                      </td>
                      <td>
                        {docs.length > 0 ? (
                          docs.map((d: string) => (
                            <span key={d} className={styles.docTag}>
                              {d.split("/").pop()}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className={`${styles.badge} ${statusBadgeClass(l.status)}`}>
                          {l.status}
                        </span>
                      </td>
                      <td>{l.requested_at ? formatDateTime(l.requested_at) : "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && selectedLeave && typeof document !== "undefined"
        ? createPortal(
            <div className={styles.modalBackdrop} onClick={closeModal} role="presentation">
              <div
                className={styles.modal}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Leave details"
              >
                <h3 className={styles.modalTitle}>Leave details</h3>
                <div className={styles.modalRow}>
                  <b>Category:</b> {selectedLeave.leave_category}
                </div>
                <div className={styles.modalRow}>
                  <b>Dates:</b> {formatDate(selectedLeave.start_date)} –{" "}
                  {formatDate(selectedLeave.end_date)} ({selectedLeave.total_days} days)
                </div>
                <div className={styles.modalRow}>
                  <b>Status:</b>{" "}
                  <span className={`${styles.badge} ${statusBadgeClass(selectedLeave.status)}`}>
                    {selectedLeave.status}
                  </span>
                </div>
                <div className={styles.modalRow}>
                  <b>Reason:</b> {selectedLeave.reason}
                </div>
                {selectedLeave.admin_remark ? (
                  <div className={styles.modalRow}>
                    <b>Remarks:</b> {selectedLeave.admin_remark}
                  </div>
                ) : null}
                <div className={styles.modalRow}>
                  <b>Documents:</b>{" "}
                  {parseDocs(selectedLeave.document_paths).length > 0 ? (
                    parseDocs(selectedLeave.document_paths).map((d: string) => (
                      <button
                        key={d}
                        type="button"
                        className={styles.chipBtn}
                        style={{ marginRight: 6, marginTop: 4 }}
                        onClick={() => handleDocumentDownload(d)}
                      >
                        📄 {d.split("/").pop()}
                      </button>
                    ))
                  ) : (
                    <span style={{ color: "#94a3b8" }}>No documents</span>
                  )}
                </div>
                <div className={styles.modalRow}>
                  <b>Requested:</b>{" "}
                  {selectedLeave.requested_at ? formatDateTime(selectedLeave.requested_at) : "—"}
                </div>
                <button type="button" className={styles.modalClose} onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
