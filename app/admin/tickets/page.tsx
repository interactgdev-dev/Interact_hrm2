"use client";

import LayoutDashboard from "../../layout-dashboard";
import React from "react";
import adminStyles from "../admin-page.module.css";
import TicketThread from "../../components/TicketThread";
import { categoryLabel, ticketTypeLabel, type TicketCategory } from "../../../lib/ticket-catalog";
import { formatTicketStatusLabel, isTicketClosed } from "../../../lib/ticket-status";
import { previewTicketToastOnPage } from "../../../lib/ticket-toast-demo";
import type { TicketThreadMessage } from "../../../lib/ticket-thread";
import { toastError, toastInfo } from "@/lib/app-toast";

type Ticket = {
  id: number;
  ticket_number: string;
  employee_id: string;
  employee_name: string;
  category: TicketCategory;
  ticket_type: string;
  subject: string | null;
  description: string | null;
  form_data: Record<string, unknown> | null;
  priority: string;
  status: string;
  admin_remark: string | null;
  messages?: TicketThreadMessage[];
  requested_at: string;
};

export default function AdminTicketsPage() {
  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"pending" | "all">("pending");
  const [selected, setSelected] = React.useState<Ticket | null>(null);
  const [reply, setReply] = React.useState("");
  const [processing, setProcessing] = React.useState(false);

  const fetchTickets = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({ ts: String(Date.now()) });
      if (filter === "pending") params.set("status", "open");
      const res = await fetch(`/api/employee-tickets?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) setTickets(data.tickets || []);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [filter]);

  React.useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data.toString());
        if (msg?.type === "ticket_update" || msg?.type === "ticket_created") {
          void fetchTickets({ silent: true });
          if (msg.ticket?.id && selected?.id === msg.ticket.id) {
            if (msg.ticket.deleted) setSelected(null);
            else setSelected(msg.ticket);
          }
        }
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [fetchTickets, selected?.id]);

  const patchTicket = async (id: number, status?: string) => {
    setProcessing(true);
    try {
      const res = await fetch("/api/employee-tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          status,
          reply: reply.trim() || undefined,
          author_name: "Admin",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReply("");
        if (data.ticket) {
          setSelected(data.ticket);
        } else if (!status) {
          setSelected(null);
        }
        void fetchTickets();
      } else {
        toastError(data.error || "Action failed");
      }
    } catch {
      toastError("Action failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleStatus = (id: number, status: string) => {
    void patchTicket(id, status);
  };

  const handleSendReply = (id: number) => {
    if (selected && isTicketClosed(selected.status)) return;
    if (!reply.trim()) {
      toastInfo("Please type a reply first.");
      return;
    }
    void patchTicket(id);
  };

  const handleDeleteTicket = async (t: Ticket) => {
    const ok = window.confirm(
      `Delete ticket ${t.ticket_number}?\nThis cannot be undone.`
    );
    if (!ok) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/employee-tickets?id=${t.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        if (selected?.id === t.id) setSelected(null);
        setTickets((prev) => prev.filter((x) => x.id !== t.id));
        void fetchTickets({ silent: true });
      } else {
        toastError(data.error || "Delete failed");
      }
    } catch {
      toastError("Delete failed");
    } finally {
      setProcessing(false);
    }
  };

  const openTicket = async (t: Ticket) => {
    setReply("");
    try {
      const res = await fetch(`/api/employee-tickets?id=${t.id}&ts=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setSelected(data.success && data.tickets?.[0] ? data.tickets[0] : t);
    } catch {
      setSelected(t);
    }
  };

  const statusBadge = (status: string) => {
    if (status === "pending") return adminStyles.badgePending;
    if (status === "in_progress") return adminStyles.badgeInProgress;
    if (status === "rejected") return adminStyles.badgeRejected;
    return adminStyles.badgeApproved;
  };

  const threadMessages = selected?.messages ?? [];
  const ticketClosed = selected ? isTicketClosed(selected.status) : false;

  const formatDateLabel = (value: unknown) => {
    const raw = String(value || "").trim();
    if (!raw) return "—";
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString();
  };

  const renderTicketDetails = (ticket: Ticket) => {
    const fd = ticket.form_data || {};
    if (!fd || Object.keys(fd).length === 0) {
      return ticket.description ? (
        <p className={adminStyles.muted} style={{ marginBottom: 12 }}>
          {ticket.description}
        </p>
      ) : null;
    }

    if (ticket.ticket_type === "leave") {
      const docs = Array.isArray(fd.document_paths) ? fd.document_paths : [];
      return (
        <div className={adminStyles.detailCard}>
          <div className={adminStyles.detailGrid}>
            <div className={adminStyles.detailItem}>
              <span className={adminStyles.detailLabel}>Leave category</span>
              <span className={adminStyles.detailValue}>
                {String(fd.leave_category || "—").replace(/_/g, " ")}
              </span>
            </div>
            <div className={adminStyles.detailItem}>
              <span className={adminStyles.detailLabel}>Total days</span>
              <span className={adminStyles.detailValue}>{String(fd.total_days ?? "—")}</span>
            </div>
            <div className={adminStyles.detailItem}>
              <span className={adminStyles.detailLabel}>Start date</span>
              <span className={adminStyles.detailValue}>{formatDateLabel(fd.start_date)}</span>
            </div>
            <div className={adminStyles.detailItem}>
              <span className={adminStyles.detailLabel}>End date</span>
              <span className={adminStyles.detailValue}>{formatDateLabel(fd.end_date)}</span>
            </div>
          </div>
          <div className={adminStyles.detailBlock}>
            <span className={adminStyles.detailLabel}>Reason</span>
            <p className={adminStyles.detailReason}>
              {String(fd.reason || ticket.description || "No reason provided")}
            </p>
          </div>
          {docs.length > 0 ? (
            <div className={adminStyles.detailBlock}>
              <span className={adminStyles.detailLabel}>Documents</span>
              <ul className={adminStyles.detailDocs}>
                {docs.map((path, idx) => (
                  <li key={`${String(path)}-${idx}`}>
                    <a href={String(path)} target="_blank" rel="noreferrer">
                      Attachment {idx + 1}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    }

    if (ticket.ticket_type === "hrm_issue" || ticket.ticket_type === "custom") {
      const images = Array.isArray(fd.image_paths) ? fd.image_paths.map(String) : [];
      return (
        <div className={adminStyles.detailCard}>
          <div className={adminStyles.detailBlock}>
            <span className={adminStyles.detailLabel}>
              {ticket.ticket_type === "custom" ? "Custom query" : "Issue details"}
            </span>
            <p className={adminStyles.detailReason}>
              {String(fd.reason || ticket.description || "No details provided")}
            </p>
          </div>
          {images.length > 0 ? (
            <div className={adminStyles.detailBlock}>
              <span className={adminStyles.detailLabel}>Screenshots</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                {images.map((src, idx) => (
                  <a
                    key={`${src}-${idx}`}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "block" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`HRM issue attachment ${idx + 1}`}
                      style={{
                        maxWidth: 220,
                        maxHeight: 160,
                        objectFit: "cover",
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                      }}
                    />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className={adminStyles.detailCard}>
        <div className={adminStyles.detailGrid}>
          {Object.entries(fd).map(([key, value]) => (
            <div key={key} className={adminStyles.detailItem}>
              <span className={adminStyles.detailLabel}>{key.replace(/_/g, " ")}</span>
              <span className={adminStyles.detailValue}>
                {Array.isArray(value) ? value.join(", ") || "—" : String(value ?? "—")}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <LayoutDashboard>
      <div className={adminStyles.page}>
        <div className={adminStyles.inner}>
          <h1 className={adminStyles.title}>Ticket inbox</h1>
          <p className={adminStyles.subtitle}>
            All employee tickets from Generate Ticket — review and update status.
          </p>

          <div className={adminStyles.ticketToolbar}>
            <div className={adminStyles.tabRow}>
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`${adminStyles.tabBtn} ${filter === "pending" ? adminStyles.tabBtnActive : ""}`}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`${adminStyles.tabBtn} ${filter === "all" ? adminStyles.tabBtnActive : ""}`}
              >
                All tickets
              </button>
            </div>
            <button
              type="button"
              className={adminStyles.previewToastBtn}
              onClick={() => previewTicketToastOnPage()}
            >
              Preview notification
            </button>
          </div>

          {loading ? (
            <p className={adminStyles.muted}>Loading…</p>
          ) : tickets.length === 0 ? (
            <div className={adminStyles.empty}>
              No {filter === "pending" ? "open " : ""}tickets.
            </div>
          ) : (
            <div className={adminStyles.requestList}>
              {tickets.map((t) => (
                <div
                  key={t.id}
                  className={`${adminStyles.requestCard} ${adminStyles.requestCardClickable}`}
                  onClick={() => void openTicket(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void openTicket(t);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className={adminStyles.requestBody}>
                    <div className={adminStyles.requestMeta}>
                      <span className={`${adminStyles.badge} ${adminStyles.badgeType}`}>
                        {t.ticket_number}
                      </span>
                      <span className={`${adminStyles.badge} ${statusBadge(t.status)}`}>
                        {formatTicketStatusLabel(t.status, t.ticket_type)}
                      </span>
                      <span className={`${adminStyles.badge} ${adminStyles.badgeType}`}>
                        {t.priority}
                      </span>
                    </div>
                    <div className={adminStyles.amount} style={{ fontSize: 16 }}>
                      {t.subject}
                    </div>
                    <div className={adminStyles.muted}>
                      {t.employee_name} · {categoryLabel(t.category)} ·{" "}
                      {ticketTypeLabel(t.category, t.ticket_type)}
                    </div>
                    {t.description ? (
                      <div className={adminStyles.muted} style={{ marginTop: 8, color: "#475569" }}>
                        {t.description}
                      </div>
                    ) : null}
                    <div
                      className={adminStyles.muted}
                      style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}
                    >
                      {new Date(t.requested_at).toLocaleString()}
                    </div>
                  </div>
                  <div className={adminStyles.actions}>
                    <button
                      type="button"
                      className={adminStyles.btnDeleteIcon}
                      title="Delete ticket"
                      aria-label={`Delete ${t.ticket_number}`}
                      disabled={processing}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteTicket(t);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={
                        isTicketClosed(t.status) ? adminStyles.btnClosed : adminStyles.btnApprove
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        void openTicket(t);
                      }}
                    >
                      {isTicketClosed(t.status) ? "Closed" : "Manage"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected ? (
        <div className={adminStyles.modalBackdrop} onClick={() => setSelected(null)}>
          <div
            className={`${adminStyles.modal} ${adminStyles.modalWide}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={adminStyles.modalTitle}>{selected.ticket_number}</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <p className={adminStyles.muted} style={{ margin: 0 }}>
                {selected.employee_name} · {categoryLabel(selected.category)} ·{" "}
                {ticketTypeLabel(selected.category, selected.ticket_type)}
              </p>
              <span className={`${adminStyles.badge} ${statusBadge(selected.status)}`}>
                {formatTicketStatusLabel(selected.status, selected.ticket_type)}
              </span>
            </div>
            <p style={{ fontWeight: 600, margin: "0 0 12px" }}>{selected.subject}</p>
            {renderTicketDetails(selected)}

            {selected.ticket_type === "leave" ? (
              <p className={adminStyles.muted} style={{ marginBottom: 12 }}>
                Leave tickets are status-only — chat / replies are disabled.
              </p>
            ) : (
              <div className={adminStyles.chatSection}>
                <span className={adminStyles.chatSectionLabel}>Conversation</span>
                {threadMessages.length > 0 ? (
                  <TicketThread messages={threadMessages} />
                ) : (
                  <p className={adminStyles.muted} style={{ margin: 0 }}>
                    No messages yet.
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              className={adminStyles.modalCloseBtn}
              onClick={() => setSelected(null)}
            >
              Close
            </button>

            {selected.ticket_type !== "leave" ? (
            <div
              className={`${adminStyles.chatComposer} ${ticketClosed ? adminStyles.chatComposerDisabled : ""}`}
            >
              {ticketClosed ? (
                <div className={adminStyles.ticketClosedNotice}>
                  This ticket is {selected.status.replace("_", " ")}. Replies are disabled.
                </div>
              ) : null}
              <label className={adminStyles.chatSectionLabel} htmlFor="ticket-reply">
                New reply
              </label>
              <textarea
                id="ticket-reply"
                className={adminStyles.textareaField}
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  ticketClosed
                    ? "This ticket is closed — no new replies"
                    : "Type your reply… (previous messages stay above)"
                }
                disabled={ticketClosed}
                readOnly={ticketClosed}
                style={{ width: "100%" }}
              />
              <div className={adminStyles.chatSendRow}>
                <button
                  type="button"
                  className={adminStyles.btnSecondary}
                  disabled={ticketClosed || processing || !reply.trim()}
                  onClick={() => handleSendReply(selected.id)}
                >
                  Send reply
                </button>
              </div>
            </div>
            ) : null}

            {!ticketClosed ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={adminStyles.btnPrimary}
                disabled={processing}
                onClick={() => handleStatus(selected.id, "in_progress")}
              >
                In progress
              </button>
              <button
                type="button"
                className={adminStyles.btnGreen}
                disabled={processing}
                onClick={() => handleStatus(selected.id, "resolved")}
              >
                {selected.ticket_type === "leave" ? "Approve" : "Resolve"}
              </button>
              <button
                type="button"
                className={adminStyles.btnReject}
                disabled={processing}
                onClick={() => handleStatus(selected.id, "rejected")}
              >
                Reject
              </button>
            </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </LayoutDashboard>
  );
}
