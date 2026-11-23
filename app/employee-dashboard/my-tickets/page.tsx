"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  categoryLabel,
  ticketTypeLabel,
  type TicketCategory,
} from "../../../lib/ticket-catalog";
import {
  getLastAdminMessage,
  saveTicketSeen,
  type TicketThreadMessage,
} from "../../../lib/ticket-thread";
import { formatTicketStatusLabel, isTicketClosed } from "../../../lib/ticket-status";
import TicketThread from "../../components/TicketThread";
import { BackToDashboard } from "../components/BackToDashboard";
import styles from "../generate-ticket/generate-ticket.module.css";

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
  approved_by?: string | null;
  approved_by_name?: string | null;
  acknowledged_by?: string | null;
  acknowledged_by_name?: string | null;
  acknowledged_at?: string | null;
};

function ticketDecidedByLabel(t: TicketRow): string | null {
  const name = String(t.approved_by_name || "").trim();
  if (!name) return null;
  if (t.status === "rejected") return `Rejected by ${name}`;
  if (t.status === "resolved" || t.status === "closed") {
    return t.ticket_type === "leave" ? `Approved by ${name}` : `Resolved by ${name}`;
  }
  return null;
}

function ticketAcknowledgedByLabel(t: TicketRow): string | null {
  if (String(t.ticket_type || "").toLowerCase() === "leave") return null;
  const name = String(t.acknowledged_by_name || "").trim();
  if (!name) return null;
  return `Acknowledged by ${name}`;
}

function statusBadgeClass(status: string) {
  if (status === "in_progress") return styles.badgeProgress;
  if (status === "resolved" || status === "closed") {
    return status === "closed" ? styles.badgeClosed : styles.badgeResolved;
  }
  if (status === "rejected") return styles.badgeRejected;
  return styles.badgePending;
}

export default function MyTicketsPage() {
  return (
    <Suspense fallback={<div className={styles.page}>Loading…</div>}>
      <MyTicketsPageInner />
    </Suspense>
  );
}

function MyTicketsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("Employee");
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<TicketRow | null>(null);
  const [employeeReply, setEmployeeReply] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [dateFilter, setDateFilter] = useState("");

  const clearOpenQuery = useCallback(() => {
    if (!searchParams?.get("open")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("open");
    const qs = params.toString();
    const base = pathname || "/employee-dashboard/my-tickets";
    router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [searchParams, router, pathname]);

  const closeTicketModal = useCallback(() => {
    setSelectedTicket(null);
    setEmployeeReply("");
    setReplyError("");
    clearOpenQuery();
  }, [clearOpenQuery]);

  const fetchTickets = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/employee-tickets?employeeId=${encodeURIComponent(id)}&limit=100&ts=${Date.now()}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (data.success) setTickets(data.tickets || []);
      else setTickets([]);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const openTicket = useCallback(
    async (t: TicketRow) => {
      if (!employeeId) {
        setSelectedTicket(t);
        return;
      }
      try {
        const res = await fetch(
          `/api/employee-tickets?id=${t.id}&employeeId=${encodeURIComponent(employeeId)}&ts=${Date.now()}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        const ticket = data.success && data.ticket ? data.ticket : t;
        setSelectedTicket(ticket);
        const lastAdmin = getLastAdminMessage(ticket.messages);
        if (lastAdmin && employeeId) {
          saveTicketSeen(employeeId, ticket.id, lastAdmin.id);
        }
      } catch {
        setSelectedTicket(t);
      }
    },
    [employeeId],
  );

  const handleEmployeeReply = useCallback(async () => {
    if (!selectedTicket || !employeeId || !employeeReply.trim()) return;
    if (selectedTicket.ticket_type === "leave") return;
    if (isTicketClosed(selectedTicket.status)) {
      setReplyError("This ticket is closed.");
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
          action: "employee_reply",
          employee_id: employeeId,
          employee_name: employeeName,
          message: employeeReply.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setReplyError(data.error || "Failed to send reply");
        return;
      }
      if (data.ticket) {
        setSelectedTicket(data.ticket);
        const lastAdmin = getLastAdminMessage(data.ticket.messages);
        if (lastAdmin) saveTicketSeen(employeeId, data.ticket.id, lastAdmin.id);
      }
      setEmployeeReply("");
      void fetchTickets(employeeId);
    } catch {
      setReplyError("Failed to send reply");
    } finally {
      setReplySending(false);
    }
  }, [selectedTicket, employeeId, employeeName, employeeReply, fetchTickets]);

  useEffect(() => {
    const id =
      localStorage.getItem("employeeId") || localStorage.getItem("loginId") || "";
    const name =
      localStorage.getItem("employeeName") ||
      localStorage.getItem("fullName") ||
      localStorage.getItem("name") ||
      "Employee";
    setEmployeeId(String(id).trim());
    setEmployeeName(String(name).trim() || "Employee");
    if (id) void fetchTickets(String(id).trim());
    else setLoading(false);
  }, [fetchTickets]);

  useEffect(() => {
    const openId = searchParams?.get("open");
    if (!openId || tickets.length === 0) return;
    const match = tickets.find((t) => String(t.id) === openId);
    if (match) void openTicket(match);
  }, [searchParams, tickets, openTicket]);

  useEffect(() => {
    if (!employeeId || typeof window === "undefined") return;
    let ws: WebSocket | null = null;
    try {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || "{}"));
          if (msg?.type === "ticket_updated" || msg?.type === "ticket_message") {
            void fetchTickets(employeeId);
            if (msg.ticket?.id && selectedTicket?.id === msg.ticket.id) {
              void openTicket({ id: msg.ticket.id } as TicketRow);
            }
          }
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* ignore */
    }
    return () => ws?.close();
  }, [employeeId, fetchTickets, openTicket, selectedTicket?.id]);

  const visible = tickets.filter((t) => {
    const closed = isTicketClosed(t.status);
    if (statusFilter === "open" && closed) return false;
    if (statusFilter === "closed" && !closed) return false;
    const requested = new Date(t.requested_at);
    if (!Number.isNaN(requested.getTime())) {
      const y = requested.getFullYear();
      const m = String(requested.getMonth() + 1).padStart(2, "0");
      const d = String(requested.getDate()).padStart(2, "0");
      const ymd = `${y}-${m}-${d}`;
      const ym = `${y}-${m}`;
      if (dateFilter && ymd !== dateFilter) return false;
      if (!dateFilter && monthFilter && ym !== monthFilter) return false;
    } else if (dateFilter || monthFilter) {
      return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(t.ticket_number || "").toLowerCase().includes(q) ||
      String(t.subject || "").toLowerCase().includes(q) ||
      String(t.ticket_type || "").toLowerCase().includes(q) ||
      String(t.status || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className={styles.page}>
      <div className={styles.inner} style={{ maxWidth: 860 }}>
        <header className={styles.header}>
          <BackToDashboard />
          <h1 className={styles.title}>My Ticket Inbox</h1>
          <p className={styles.sub}>
            Your tickets only — open any ticket to read HR responses and reply.
          </p>
        </header>

        <div className={styles.card} style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#64748b" }}>
              Month
              <input
                className={styles.input}
                style={{ width: "auto", minWidth: 150, marginBottom: 0 }}
                type="month"
                value={monthFilter}
                onChange={(e) => {
                  setMonthFilter(e.target.value);
                  setDateFilter("");
                }}
                aria-label="Filter by month"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#64748b" }}>
              Date
              <input
                className={styles.input}
                style={{ width: "auto", minWidth: 150, marginBottom: 0 }}
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filter by date"
              />
            </label>
            <input
              className={styles.input}
              style={{ flex: "1 1 200px", marginBottom: 0, alignSelf: "flex-end" }}
              type="search"
              placeholder="Search ticket #, subject, type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={styles.select}
              style={{ width: "auto", minWidth: 140, marginBottom: 0, alignSelf: "flex-end" }}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "open" | "closed")
              }
              aria-label="Filter by status"
            >
              <option value="all">All tickets</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <Link
              href="/employee-dashboard/generate-ticket"
              className={styles.submitBtn}
              style={{
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
                width: "auto",
                padding: "10px 14px",
                alignSelf: "flex-end",
              }}
            >
              New ticket
            </Link>
          </div>
        </div>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            {loading
              ? "Loading…"
              : `${visible.length} ticket${visible.length === 1 ? "" : "s"}`}
          </h2>
          {!employeeId ? (
            <div className={styles.empty}>Sign in as an employee to view your tickets.</div>
          ) : loading ? (
            <div className={styles.empty}>Loading your tickets…</div>
          ) : visible.length === 0 ? (
            <div className={styles.empty}>
              No tickets yet.{" "}
              <Link href="/employee-dashboard/generate-ticket">Generate a ticket</Link>
            </div>
          ) : (
            <div className={styles.historyList}>
              {visible.map((t) => (
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
                    {categoryLabel(t.category)} ·{" "}
                    {ticketTypeLabel(t.category, t.ticket_type)} ·{" "}
                    {new Date(t.requested_at).toLocaleString()}
                  </div>
                  {ticketAcknowledgedByLabel(t) ? (
                    <div
                      className={styles.historyMeta}
                      style={{ marginTop: 4, fontWeight: 600, color: "#1d4ed8" }}
                    >
                      {ticketAcknowledgedByLabel(t)}
                    </div>
                  ) : null}
                  {ticketDecidedByLabel(t) ? (
                    <div
                      className={styles.historyMeta}
                      style={{
                        marginTop: 4,
                        fontWeight: 600,
                        color: t.status === "rejected" ? "#b91c1c" : "#0f766e",
                      }}
                    >
                      {ticketDecidedByLabel(t)}
                    </div>
                  ) : null}
                  <div className={styles.historyHint}>
                    {t.ticket_type === "leave"
                      ? "Leave request · Click to view status"
                      : isTicketClosed(t.status)
                        ? "Closed · Click to read conversation"
                        : "Click to view responses & reply"}
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
              {ticketAcknowledgedByLabel(selectedTicket) ? (
                <span
                  className={`${styles.badge} ${statusBadgeClass(selectedTicket.status)}`}
                  style={{ background: "#eff6ff", color: "#1d4ed8" }}
                >
                  {ticketAcknowledgedByLabel(selectedTicket)}
                </span>
              ) : null}
              {ticketDecidedByLabel(selectedTicket) ? (
                <span
                  className={`${styles.badge} ${statusBadgeClass(selectedTicket.status)}`}
                  style={{ background: "#ecfdf5", color: "#0f766e" }}
                >
                  {ticketDecidedByLabel(selectedTicket)}
                </span>
              ) : null}
            </div>
            <p className={styles.historySubject}>{selectedTicket.subject}</p>
            {selectedTicket.ticket_type === "leave" ? (
              <div className={styles.modalThread}>
                <span className={styles.historyBodyLabel}>Leave request status</span>
                <p className={styles.ticketHintText}>
                  You can track this leave ticket status here. Chat is not available on leave
                  tickets.
                </p>
                {ticketDecidedByLabel(selectedTicket) ? (
                  <p
                    className={styles.ticketHintText}
                    style={{
                      marginTop: 10,
                      fontWeight: 700,
                      color:
                        selectedTicket.status === "rejected" ? "#b91c1c" : "#0f766e",
                    }}
                  >
                    {ticketDecidedByLabel(selectedTicket)}
                  </p>
                ) : null}
                {selectedTicket.description ? (
                  <div className={styles.ticketContextBox}>
                    <span className={styles.ticketContextLabel}>Request details</span>
                    <p className={styles.ticketContextText}>{selectedTicket.description}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.modalThread}>
                <span className={styles.historyBodyLabel}>Conversation</span>
                {ticketAcknowledgedByLabel(selectedTicket) ? (
                  <p
                    className={styles.ticketHintText}
                    style={{ marginBottom: 10, fontWeight: 700, color: "#1d4ed8" }}
                  >
                    {ticketAcknowledgedByLabel(selectedTicket)}
                  </p>
                ) : null}
                {selectedTicket.messages && selectedTicket.messages.length > 0 ? (
                  <TicketThread messages={selectedTicket.messages} />
                ) : selectedTicket.description ? (
                  <div className={styles.ticketContextBox}>
                    <span className={styles.ticketContextLabel}>Message</span>
                    <p className={styles.ticketContextText}>{selectedTicket.description}</p>
                  </div>
                ) : (
                  <p className={styles.empty}>No messages yet.</p>
                )}

                {isTicketClosed(selectedTicket.status) ? (
                  <p className={styles.closedNotice}>
                    This ticket is closed. You can read the conversation but cannot reply.
                  </p>
                ) : (
                  <div className={styles.replyComposer}>
                    <label className={styles.historyBodyLabel} htmlFor="my-ticket-reply">
                      Your reply
                    </label>
                    <textarea
                      id="my-ticket-reply"
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
