"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ENABLED_HR_TICKET_TYPES,
  categoryLabel,
  getTicketTypesForCategory,
  ticketTypeLabel,
  type TicketCategory,
  type TicketFormKind,
} from "../../../lib/ticket-catalog";
import {
  getLastAdminMessage,
  saveTicketSeen,
  type TicketThreadMessage,
} from "../../../lib/ticket-thread";
import { formatTicketStatusLabel, isTicketClosed } from "../../../lib/ticket-status";
import TicketThread from "../../components/TicketThread";
import styles from "./generate-ticket.module.css";

type TicketRow = {
  id: number;
  ticket_number: string;
  category: TicketCategory;
  ticket_type: string;
  subject: string | null;
  description: string | null;
  admin_remark: string | null;
  messages?: TicketThreadMessage[];
  priority: string;
  status: string;
  requested_at: string;
  updated_at: string;
};

const LEAVE_CATEGORIES = [
  { value: "annual", label: "Annual" },
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "bereavement", label: "Bereavement" },
  { value: "other", label: "Other" },
];

function calcDays(start: string, end: string) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

function statusBadgeClass(status: string) {
  if (status === "in_progress") return styles.badgeProgress;
  if (status === "resolved" || status === "closed") {
    return status === "closed" ? styles.badgeClosed : styles.badgeResolved;
  }
  if (status === "rejected") return styles.badgeRejected;
  return styles.badgePending;
}

export default function GenerateTicketPage() {
  return (
    <Suspense fallback={<div className={styles.page}>Loading…</div>}>
      <GenerateTicketPageInner />
    </Suspense>
  );
}

function GenerateTicketPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const consumedOpenIdRef = useRef<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("Employee");
  const [category, setCategory] = useState<TicketCategory>("HR");
  const [ticketType, setTicketType] = useState("leave");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [leaveCategory, setLeaveCategory] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [amount, setAmount] = useState("");
  const [installments, setInstallments] = useState("6");
  const [startMonth, setStartMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [slipMonth, setSlipMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [history, setHistory] = useState<TicketRow[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketRow | null>(null);
  const [leaveBalance, setLeaveBalance] = useState(0);
  const [annualAllowance, setAnnualAllowance] = useState(20);
  const [bereavementBalance, setBereavementBalance] = useState(3);
  const [employmentStatus, setEmploymentStatus] = useState("Permanent");
  const [documents, setDocuments] = useState<File[]>([]);
  const [issueImages, setIssueImages] = useState<File[]>([]);
  const [employeeReply, setEmployeeReply] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState("");

  const clearOpenQuery = useCallback(() => {
    if (!searchParams?.get("open")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("open");
    const qs = params.toString();
    const base = pathname || "/employee-dashboard/generate-ticket";
    router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [searchParams, router, pathname]);

  const closeTicketModal = useCallback(() => {
    setSelectedTicket(null);
    setEmployeeReply("");
    setReplyError("");
    clearOpenQuery();
  }, [clearOpenQuery]);

  const typeOptions = useMemo(
    () =>
      getTicketTypesForCategory(category).filter((t) =>
        (ENABLED_HR_TICKET_TYPES as readonly string[]).includes(t.value)
      ),
    [category]
  );

  const selectedType = useMemo(
    () => typeOptions.find((t) => t.value === ticketType),
    [typeOptions, ticketType]
  );

  const formKind: TicketFormKind | null = selectedType?.form ?? null;

  const fetchHistory = useCallback(async (id: string) => {
    const res = await fetch(
      `/api/employee-tickets?employeeId=${encodeURIComponent(id)}&limit=20&ts=${Date.now()}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (data.success) setHistory(data.tickets || []);
  }, []);

  const fetchLeaveBalance = useCallback(async () => {
    if (!employeeId) return;
    try {
      const res = await fetch(
        `/api/leave-balance?employee_id=${encodeURIComponent(employeeId)}&ts=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.success) {
        setLeaveBalance(data.annualBalance ?? 0);
        setAnnualAllowance(data.annualAllowance ?? 20);
        setBereavementBalance(data.bereavementBalance ?? 0);
        setEmploymentStatus(data.employment_status || "Permanent");
      }
    } catch {
      /* keep current */
    }
  }, [employeeId]);

  const openTicket = useCallback(
    async (t: TicketRow) => {
      setEmployeeReply("");
      setReplyError("");
      if (!employeeId) {
        setSelectedTicket(t);
        return;
      }
      try {
        const res = await fetch(
          `/api/employee-tickets?id=${t.id}&employeeId=${encodeURIComponent(employeeId)}&ts=${Date.now()}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        const ticket = data.success && data.tickets?.[0] ? data.tickets[0] : t;
        const lastAdmin = getLastAdminMessage(ticket.messages ?? []);
        if (lastAdmin && employeeId) {
          saveTicketSeen(employeeId, ticket.id, lastAdmin.id);
        }
        setSelectedTicket(ticket);
      } catch {
        setSelectedTicket(t);
      }
    },
    [employeeId]
  );

  const handleEmployeeReply = useCallback(async () => {
    if (!selectedTicket || !employeeId || !employeeReply.trim()) return;
    if (selectedTicket.ticket_type === "leave") return;
    if (isTicketClosed(selectedTicket.status)) {
      setReplyError("This ticket is closed. You cannot reply.");
      return;
    }
    setReplySending(true);
    setReplyError("");
    try {
      const res = await fetch("/api/employee-tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedTicket.id,
          reply: employeeReply.trim(),
          from: "employee",
          employee_id: employeeId,
          author_name: employeeName,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setReplyError(data.error || "Could not send reply");
        return;
      }
      setEmployeeReply("");
      if (data.ticket) {
        setSelectedTicket(data.ticket);
        const lastAdmin = getLastAdminMessage(data.ticket.messages ?? []);
        if (lastAdmin) saveTicketSeen(employeeId, data.ticket.id, lastAdmin.id);
      }
      void fetchHistory(employeeId);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Could not send reply");
    } finally {
      setReplySending(false);
    }
  }, [selectedTicket, employeeId, employeeName, employeeReply, fetchHistory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = localStorage.getItem("employeeId") || localStorage.getItem("loginId") || "";
    const name = localStorage.getItem("employeeName") || "Employee";
    setEmployeeId(id);
    setEmployeeName(name);
    if (id) void fetchHistory(id);
  }, [fetchHistory]);

  useEffect(() => {
    const openId = searchParams?.get("open");
    if (!openId) {
      // Allow a future toast deep-link (?open=) to open again after URL is cleared
      consumedOpenIdRef.current = null;
      return;
    }
    if (history.length === 0) return;
    // Only auto-open once per ?open= id — do not re-open when history refreshes after creating a ticket
    if (consumedOpenIdRef.current === openId) return;
    const match = history.find((t) => String(t.id) === openId);
    if (match) {
      consumedOpenIdRef.current = openId;
      void openTicket(match);
    }
  }, [searchParams, history, openTicket]);

  useEffect(() => {
    if (!employeeId || typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data.toString());
        if (msg?.type === "ticket_update" || msg?.type === "ticket_created") {
          void fetchHistory(employeeId);
          if (msg.ticket?.id && selectedTicket?.id === msg.ticket.id) {
            setSelectedTicket(msg.ticket);
          }
        }
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [employeeId, fetchHistory, selectedTicket?.id]);

  useEffect(() => {
    setError("");
    setSuccess("");
    setSubject("");
    setDescription("");
    setStartDate("");
    setEndDate("");
    setAmount("");
    setLeaveCategory("annual");
    setDocuments([]);
    setIssueImages([]);
  }, [category, ticketType]);

  useEffect(() => {
    if (employeeId && formKind === "leave") void fetchLeaveBalance();
  }, [employeeId, formKind, fetchLeaveBalance]);

  const leaveDays = useMemo(
    () => (startDate && endDate ? calcDays(startDate, endDate) : 0),
    [startDate, endDate]
  );

  const detailsLabel = useMemo(() => {
    if (formKind === "custom") return "Your query";
    if (formKind === "hrm_issue") return "Describe the HRM issue";
    if (formKind === "leave") return "Reason for leave";
    if (formKind === "advance" || formKind === "loan") return "Reason / notes";
    if (formKind === "salary_slip") return "Additional notes (optional)";
    return "Details / reason";
  }, [formKind]);

  const showFormSection = Boolean(selectedType && formKind);

  const balanceLabel =
    employmentStatus === "Probation" ? "Leave balance" : "Annual leave balance";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const validFiles = files.filter(
      (f) => f.type === "application/pdf" && f.size <= 100 * 1024 * 1024
    );
    setDocuments(validFiles);
  };

  const handleIssueImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const validFiles = files.filter(
      (f) =>
        /^image\/(png|jpeg|jpg|webp|gif)$/i.test(f.type) && f.size <= 100 * 1024 * 1024
    );
    setIssueImages(validFiles);
  };

  const buildPayload = async () => {
    const base: Record<string, unknown> = {};
    if (formKind === "leave") {
      const days = calcDays(startDate, endDate);
      if (!startDate || !endDate) throw new Error("Please select leave start and end dates.");
      if (!description.trim()) throw new Error("Please enter a reason for leave.");

      let uploadedFilePaths: string[] = [];
      if (documents.length > 0) {
        const formData = new FormData();
        formData.append("employee_id", employeeId || "");
        documents.forEach((file) => formData.append("files", file));
        const uploadRes = await fetch("/api/attachments", { method: "POST", body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) {
          throw new Error(uploadData.error || "Failed to upload documents");
        }
        uploadedFilePaths = uploadData.files.map((f: { url: string }) => f.url);
      }

      base.leave_category = leaveCategory;
      base.start_date = startDate;
      base.end_date = endDate;
      base.total_days = days;
      base.reason = description;
      base.document_paths = uploadedFilePaths;
    } else if (formKind === "advance") {
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed <= 0) throw new Error("Please enter a valid amount.");
      base.amount = parsed;
      base.reason = description;
    } else if (formKind === "loan") {
      const parsed = parseFloat(amount);
      const inst = parseInt(installments, 10);
      if (isNaN(parsed) || parsed <= 0) throw new Error("Please enter a valid loan amount.");
      if (isNaN(inst) || inst < 1) throw new Error("Please enter valid installments.");
      base.amount = parsed;
      base.installments = inst;
      base.start_month = startMonth;
      base.reason = description;
    } else if (formKind === "salary_slip") {
      base.month = slipMonth;
      base.reason = description;
    } else if (formKind === "custom") {
      if (!subject.trim()) throw new Error("Please enter a subject for your custom ticket.");
      if (!description.trim()) throw new Error("Please write your custom query.");
    } else if (formKind === "hrm_issue") {
      if (!description.trim()) throw new Error("Please describe the HRM issue.");
      let imagePaths: string[] = [];
      if (issueImages.length > 0) {
        const formData = new FormData();
        formData.append("employee_id", employeeId || "");
        issueImages.forEach((file) => formData.append("files", file));
        const uploadRes = await fetch("/api/attachments", { method: "POST", body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) {
          throw new Error(uploadData.error || "Failed to upload image");
        }
        imagePaths = uploadData.files.map((f: { url: string }) => f.url);
      }
      base.image_paths = imagePaths;
      base.reason = description;
    } else if (formKind === "generic") {
      if (!description.trim()) throw new Error("Please describe your issue or request.");
    }
    return base;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const allowed =
      category === "HR" &&
      (ENABLED_HR_TICKET_TYPES as readonly string[]).includes(ticketType);
    if (!allowed) {
      setError("Please select a valid HR request type (Leave, Custom, or HRM Issue).");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const form_data = await buildPayload();
      const res = await fetch("/api/employee-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          category,
          ticket_type: ticketType,
          is_custom: formKind === "custom",
          subject: formKind === "custom" ? subject : undefined,
          description,
          form_data: Object.keys(form_data).length ? form_data : undefined,
          priority,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Could not submit ticket");
        return;
      }
      setSuccess(
        `Ticket ${data.ticket?.ticket_number || ""} submitted! Admin will review it shortly.`
      );
      setSelectedTicket(null);
      setEmployeeReply("");
      setReplyError("");
      clearOpenQuery();
      setDescription("");
      setSubject("");
      setAmount("");
      setDocuments([]);
      setIssueImages([]);
      setStartDate("");
      setEndDate("");
      void fetchHistory(employeeId);
      if (formKind === "leave") void fetchLeaveBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h1 className={styles.title}>Generate ticket</h1>
          <p className={styles.sub}>
            Select department and request type. All tickets go to the admin HR inbox for review.
          </p>
        </header>

        <form className={styles.card} onSubmit={handleSubmit}>
          <h2 className={styles.cardTitle}>New ticket</h2>
          {error ? <div className={styles.alertError}>{error}</div> : null}
          {success ? <div className={styles.alertSuccess}>{success}</div> : null}

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ticket-category">
                Department
              </label>
              <select
                id="ticket-category"
                className={styles.select}
                value="HR"
                disabled
                aria-readonly="true"
              >
                <option value="HR">HR</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ticket-type">
                Request type
              </label>
              <select
                id="ticket-type"
                className={styles.select}
                value={ticketType}
                onChange={(e) => setTicketType(e.target.value)}
              >
                {typeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ticket-priority">
              Priority
            </label>
            <select
              id="ticket-priority"
              className={styles.select}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          {showFormSection ? (
            <div className={styles.formSection}>
              <div className={styles.formSectionHead}>
                <h3 className={styles.formSectionTitle}>Request details</h3>
                <p className={styles.formSectionSub}>
                  {categoryLabel(category)} · {selectedType?.label}
                </p>
              </div>

          {formKind === "custom" ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ticket-subject">
                Subject
              </label>
              <input
                id="ticket-subject"
                className={styles.input}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief title for your request"
              />
            </div>
          ) : null}

          {formKind === "leave" ? (
            <>
              <div className={styles.leaveBalanceRow}>
                <div className={`${styles.leaveBalanceCard} ${styles.leaveBalancePurple}`}>
                  <p className={styles.leaveBalanceLabel}>{balanceLabel}</p>
                  <p className={styles.leaveBalanceValue}>
                    {leaveBalance}
                    <span className={styles.leaveBalanceOf}> / {annualAllowance}</span>
                  </p>
                  <p className={styles.leaveBalanceSub}>Days remaining this year</p>
                </div>
                <div className={`${styles.leaveBalanceCard} ${styles.leaveBalanceGreen}`}>
                  <p className={styles.leaveBalanceLabel}>Bereavement leave</p>
                  <p className={styles.leaveBalanceValue}>
                    {bereavementBalance}
                    <span className={styles.leaveBalanceOf}> / 3</span>
                  </p>
                  <p className={styles.leaveBalanceSub}>Days remaining</p>
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Leave category</label>
                <select
                  className={styles.select}
                  value={leaveCategory}
                  onChange={(e) => setLeaveCategory(e.target.value)}
                >
                  {LEAVE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Start date</label>
                  <input
                    type="date"
                    className={styles.input}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>End date</label>
                  <input
                    type="date"
                    className={styles.input}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>
              {leaveDays > 0 ? (
                <p className={styles.daysHint}>Total days: {leaveDays}</p>
              ) : null}
            </>
          ) : null}

          {(formKind === "advance" || formKind === "loan") && (
            <div className={styles.field}>
              <label className={styles.label}>Amount (PKR)</label>
              <input
                type="number"
                min="1"
                className={styles.input}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          )}

          {formKind === "loan" ? (
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label}>Installments</label>
                <input
                  type="number"
                  min="1"
                  className={styles.input}
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Start month</label>
                <input
                  type="month"
                  className={styles.input}
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  required
                />
              </div>
            </div>
          ) : null}

          {formKind === "salary_slip" ? (
            <div className={styles.field}>
              <label className={styles.label}>Salary slip month</label>
              <input
                type="month"
                className={styles.input}
                value={slipMonth}
                onChange={(e) => setSlipMonth(e.target.value)}
                required
              />
            </div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.label}>{detailsLabel}</label>
            <textarea
              className={styles.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                selectedType
                  ? `Describe your ${selectedType.label.toLowerCase()} request…`
                  : "Describe your request…"
              }
              required={formKind !== "salary_slip"}
            />
          </div>

          {formKind === "leave" ? (
            <div className={styles.field}>
              <label className={styles.label}>Attach documents (PDF only)</label>
              <div className={styles.fileRow}>
                <input
                  id="ticket-leave-file-input"
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={handleFileChange}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className={styles.fileBtn}
                  onClick={() => document.getElementById("ticket-leave-file-input")?.click()}
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
          ) : null}

          {formKind === "hrm_issue" ? (
            <div className={styles.field}>
              <label className={styles.label}>Attach image (optional)</label>
              <div className={styles.fileRow}>
                <input
                  id="ticket-hrm-image-input"
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                  multiple
                  onChange={handleIssueImageChange}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className={styles.fileBtn}
                  onClick={() => document.getElementById("ticket-hrm-image-input")?.click()}
                >
                  Choose image
                </button>
                <span className={styles.fileHint}>Optional · PNG/JPG/WEBP/GIF · Max 100MB</span>
              </div>
              {issueImages.length > 0 ? (
                <div className={styles.fileList}>
                  {issueImages.map((f, idx) => (
                    <div key={`${f.name}-${idx}`} className={styles.fileChip}>
                      <span className={styles.fileChipName}>🖼️ {f.name}</span>
                      <button
                        type="button"
                        className={styles.fileChipRemove}
                        aria-label={`Remove ${f.name}`}
                        title="Remove image"
                        onClick={() => {
                          setIssueImages((prev) => prev.filter((_, i) => i !== idx));
                          const input = document.getElementById(
                            "ticket-hrm-image-input"
                          ) as HTMLInputElement | null;
                          if (input) input.value = "";
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
            </div>
          ) : null}

          <button type="submit" className={styles.submitBtn} disabled={submitting || !employeeId || !showFormSection}>
            {submitting ? "Submitting…" : "Submit ticket"}
          </button>
        </form>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>My tickets</h2>
          {history.length === 0 ? (
            <div className={styles.empty}>No tickets yet.</div>
          ) : (
            <div className={styles.historyList}>
              {history.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.historyItem}
                  onClick={() => void openTicket(t)}
                >
                  <div className={styles.historyTop}>
                    <span className={styles.historyId}>{t.ticket_number}</span>
                    <span className={`${styles.badge} ${statusBadgeClass(t.status)}`}>
                      {formatTicketStatusLabel(t.status, t.ticket_type)}
                    </span>
                  </div>
                  <div className={styles.historySubject}>{t.subject}</div>
                  <div className={styles.historyMeta}>
                    {categoryLabel(t.category)} · {ticketTypeLabel(t.category, t.ticket_type)} ·{" "}
                    {new Date(t.requested_at).toLocaleString()}
                  </div>
                  <div className={styles.historyHint}>
                    {t.ticket_type === "leave"
                      ? isTicketClosed(t.status)
                        ? "Leave request · Click to view status"
                        : "Leave request · Click to view status"
                      : isTicketClosed(t.status)
                        ? "Closed · Click to read conversation"
                        : "Click to view conversation"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedTicket ? (
        <div className={styles.modalBackdrop} onClick={closeTicketModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{selectedTicket.ticket_number}</h2>
            <div className={styles.modalMeta}>
              <span className={`${styles.badge} ${statusBadgeClass(selectedTicket.status)}`}>
                {formatTicketStatusLabel(selectedTicket.status, selectedTicket.ticket_type)}
              </span>
              <span className={styles.historyMeta}>
                {categoryLabel(selectedTicket.category)} ·{" "}
                {ticketTypeLabel(selectedTicket.category, selectedTicket.ticket_type)}
              </span>
            </div>
            <p className={styles.historySubject}>{selectedTicket.subject}</p>
            {selectedTicket.ticket_type === "leave" ? (
              <div className={styles.modalThread}>
                <span className={styles.historyBodyLabel}>Leave request status</span>
                <p className={styles.historyBodyText}>
                  You can track this leave ticket status here. Chat is not available on leave
                  tickets.
                </p>
                {selectedTicket.description ? (
                  <p className={styles.historyBodyText} style={{ marginTop: 10 }}>
                    {selectedTicket.description}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className={styles.modalThread}>
                <span className={styles.historyBodyLabel}>Conversation</span>
                {selectedTicket.messages && selectedTicket.messages.length > 0 ? (
                  <TicketThread messages={selectedTicket.messages} />
                ) : selectedTicket.description ? (
                  <p className={styles.historyBodyText}>{selectedTicket.description}</p>
                ) : (
                  <p className={styles.empty}>No messages yet.</p>
                )}

                {isTicketClosed(selectedTicket.status) ? (
                  <p className={styles.closedNotice}>
                    This ticket is closed. You can read the conversation but cannot reply.
                  </p>
                ) : (
                  <div className={styles.replyComposer}>
                    <label className={styles.historyBodyLabel} htmlFor="employee-ticket-reply">
                      Your reply
                    </label>
                    <textarea
                      id="employee-ticket-reply"
                      className={styles.textarea}
                      rows={3}
                      value={employeeReply}
                      onChange={(e) => setEmployeeReply(e.target.value)}
                      placeholder="Type your reply to HR…"
                    />
                    {replyError ? <div className={styles.alertError}>{replyError}</div> : null}
                    <button
                      type="button"
                      className={styles.replySendBtn}
                      disabled={replySending || !employeeReply.trim()}
                      onClick={() => void handleEmployeeReply()}
                    >
                      {replySending ? "Sending…" : "Send reply"}
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={closeTicketModal}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
