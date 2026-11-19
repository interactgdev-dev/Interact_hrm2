"use client";
import React from "react";
import { FaCalendarAlt } from "react-icons/fa";
import { showAppConfirm } from "@/lib/app-confirm";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import { CompanyPolicySection } from "../company-policy/CompanyPolicySection";
import styles from "../admin-page.module.css";
import tableStyles from "../../break-summary/break-summary.module.css";
import leaveStyles from "../../leave/leave.module.css";

interface EventItem {
  id: number;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  is_all_day: number | boolean;
  location: string | null;
  color?: string | null;
  status: string;
  widget_heading?: string;
  created_at?: string;
  updated_at?: string;
}

interface ReminderItem {
  id: number;
  message: string;
  is_active: number | boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

const EVENT_COLORS = ["#25c6da", "#45aef0", "#ffb22c", "#e03756", "#7c4dff"];

const initialForm = {
  title: "",
  description: "",
  start_at: "",
  end_at: "",
  is_all_day: false,
  location: "",
  status: "published",
  color: EVENT_COLORS[0],
};

export default function AdminEventsPage() {
  const [form, setForm] = React.useState(initialForm);
  const [events, setEvents] = React.useState<EventItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [headingSaving, setHeadingSaving] = React.useState(false);
  const [widgetHeading, setWidgetHeading] = React.useState("Upcoming Events");
  const [reminders, setReminders] = React.useState<ReminderItem[]>([]);
  const [reminderMessage, setReminderMessage] = React.useState("");
  const [reminderSaving, setReminderSaving] = React.useState(false);
  const [deletingReminderId, setDeletingReminderId] = React.useState<number | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);

  const fetchEvents = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/events", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        setEvents(data.events || []);
        if (data.widgetHeading) setWidgetHeading(data.widgetHeading);
      }
    } catch (e) {
      console.error("fetch events", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchReminders = React.useCallback(async () => {
    try {
      const res = await fetch("/api/reminders", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) setReminders(data.reminders || []);
    } catch (e) {
      console.error("fetch reminders", e);
    }
  }, []);

  React.useEffect(() => {
    fetchEvents();
    fetchReminders();
    if (typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data.toString());
        if (msg?.type === "events_updated") {
          fetchEvents();
        }
        if (msg?.type === "reminders_updated") {
          fetchReminders();
        }
      } catch (_) {
        // ignore malformed
      }
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "events_admin_init" }));
    return () => ws.close();
  }, [fetchEvents, fetchReminders]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.start_at) return;
    try {
      setSaving(true);
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data?.success) {
        setForm(initialForm);
        fetchEvents();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "events_updated" }));
        }
      }
    } catch (err) {
      console.error("save event", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleHeadingChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newHeading = e.target.value;
    if (newHeading === widgetHeading) return;
    try {
      setHeadingSaving(true);
      const res = await fetch("/api/events", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widget_heading: newHeading }),
      });
      const data = await res.json();
      if (data?.success) {
        setWidgetHeading(newHeading);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "events_updated" }));
        }
      }
    } catch (err) {
      console.error("update heading", err);
    } finally {
      setHeadingSaving(false);
    }
  }

  async function handleAddReminder(e: React.FormEvent) {
    e.preventDefault();
    if (!reminderMessage.trim()) return;
    try {
      setReminderSaving(true);
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reminderMessage, is_active: 1, display_order: reminders.length + 1 }),
      });
      const data = await res.json();
      if (data?.success) {
        setReminderMessage("");
        fetchReminders();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "reminders_updated" }));
        }
      }
    } catch (err) {
      console.error("add reminder", err);
    } finally {
      setReminderSaving(false);
    }
  }

  async function handleDeleteReminder(id: number) {
    const ok = await showAppConfirm({
      message: "Delete this reminder?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      setDeletingReminderId(id);
      const res = await fetch(`/api/reminders?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data?.success) {
        await fetchReminders();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "reminders_updated" }));
        }
      }
    } catch (err) {
      console.error("delete reminder", err);
    } finally {
      setDeletingReminderId(null);
    }
  }

  async function handleDelete(id: number) {
    const ok = await showAppConfirm({
      message: "Delete this event?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      setDeletingId(id);
      const res = await fetch(`/api/events?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data?.success) {
        await fetchEvents();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "events_updated" }));
        }
      }
    } catch (err) {
      console.error("delete event", err);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={tableStyles.breakSummaryContainer}>
          <div className={styles.pageHeader}>
            <div>
              <h1 className={styles.pageHeaderTitle}>
                <FaCalendarAlt
                  style={{ marginRight: 10, color: "#0f766e", verticalAlign: "middle" }}
                />
                Events & Announcements
              </h1>
              <p className={tableStyles.mgmtAttMeta} style={{ marginTop: 4 }}>
                Create events for the employee dashboard calendar. US federal holidays are linked
                automatically.
              </p>
            </div>
          </div>

          <div className={leaveStyles.toolbar}>
            <label className={styles.field} style={{ margin: 0, minWidth: 200 }}>
              <span style={{ marginBottom: 4, display: "block" }}>Widget Heading</span>
              <select
                value={widgetHeading}
                onChange={handleHeadingChange}
                disabled={headingSaving}
                className={leaveStyles.toolbarSelect}
              >
                <option value="Upcoming Events">Upcoming Events</option>
                <option value="Announcements">Announcements</option>
              </select>
            </label>
            <span className={tableStyles.empListShowing}>
              {headingSaving
                ? "Saving…"
                : loading
                  ? "Loading…"
                  : `Showing: ${events.length} event${events.length === 1 ? "" : "s"}`}
            </span>
          </div>

          <div className={tableStyles.eventsLayout}>
            <div className={styles.card} style={{ marginBottom: 0 }}>
              <h2 className={styles.cardTitle}>Add Event</h2>
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className={styles.field}>
                  <label>Title</label>
                  <input
                    required
                    placeholder="Title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className={styles.input}
                  />
                </div>
                <div className={styles.field}>
                  <label>Description</label>
                  <textarea
                    placeholder="Description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className={styles.textareaField}
                    rows={3}
                  />
                </div>
                <div className={styles.field}>
                  <label>Start At</label>
                  <input
                    required
                    type="datetime-local"
                    value={form.start_at}
                    onChange={(e) => setForm({ ...form, start_at: e.target.value })}
                    className={styles.input}
                  />
                </div>
                <div className={styles.field}>
                  <label>End At (optional)</label>
                  <input
                    type="datetime-local"
                    value={form.end_at}
                    onChange={(e) => setForm({ ...form, end_at: e.target.value })}
                    className={styles.input}
                  />
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    color: "#334155",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!form.is_all_day}
                    onChange={(e) => setForm({ ...form, is_all_day: e.target.checked })}
                  />
                  All day
                </label>
                <div className={styles.field}>
                  <label>Location (optional)</label>
                  <input
                    placeholder="Location"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className={styles.input}
                  />
                </div>
                <div className={styles.field}>
                  <label>Calendar color</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {EVENT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, color: c })}
                        title={c}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          border: form.color === c ? "3px solid #0f172a" : "2px solid #e2e8f0",
                          background: c,
                          cursor: "pointer",
                          padding: 0,
                        }}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>
                  <p className={styles.muted} style={{ marginTop: 6, fontSize: 12 }}>
                    Same color shows on the employee event button and calendar date.
                  </p>
                </div>
                <button type="submit" disabled={saving} className={styles.btnGreen}>
                  {saving ? "Saving…" : "Save Event"}
                </button>
              </form>
            </div>

            <div style={{ minWidth: 0, width: "100%" }}>
              <h2 className={tableStyles.pageTitle} style={{ marginTop: 0, marginBottom: 10 }}>
                {widgetHeading}
              </h2>
              <div className={leaveStyles.reqTableShell}>
                <div className={tableStyles.eventsScroll}>
                  {loading ? (
                    <div className={leaveStyles.loading}>Loading events…</div>
                  ) : (
                    <table className={`${leaveStyles.reqTable} ${tableStyles.eventsTableFit}`}>
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Color</th>
                          <th>Schedule</th>
                          <th>Location</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.length === 0 ? (
                          <tr>
                            <td colSpan={6} className={leaveStyles.reqEmpty}>
                              No events yet.
                            </td>
                          </tr>
                        ) : (
                          events.map((ev) => (
                            <tr key={ev.id}>
                              <td>
                                <div style={{ fontWeight: 700, color: "#0f766e" }}>{ev.title}</div>
                                {ev.description ? (
                                  <div
                                    className={tableStyles.cellMuted}
                                    style={{ marginTop: 4, whiteSpace: "normal" }}
                                    title={ev.description}
                                  >
                                    {ev.description}
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                <span
                                  title={ev.color || ""}
                                  style={{
                                    display: "inline-block",
                                    width: 16,
                                    height: 16,
                                    borderRadius: 999,
                                    background: ev.color || EVENT_COLORS[0],
                                    border: "1px solid #e2e8f0",
                                    verticalAlign: "middle",
                                  }}
                                />
                              </td>
                              <td className={tableStyles.cellMuted} style={{ whiteSpace: "normal" }}>
                                {new Date(ev.start_at).toLocaleString()}
                                {ev.end_at ? ` – ${new Date(ev.end_at).toLocaleString()}` : ""}
                                <div style={{ marginTop: 4, fontSize: 11 }}>
                                  {ev.is_all_day ? "All day" : "Timed"}
                                </div>
                              </td>
                              <td className={tableStyles.cellMuted} title={ev.location || undefined}>
                                {ev.location || "—"}
                              </td>
                              <td>
                                <span className={`${styles.badge} ${styles.badgeApproved}`}>
                                  {ev.status}
                                </span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(ev.id)}
                                  disabled={deletingId === ev.id}
                                  className={`${tableStyles.deptBtn} ${tableStyles.deptBtnDelete}`}
                                >
                                  {deletingId === ev.id ? "…" : "Delete"}
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.card} style={{ marginTop: 16 }}>
            <h2 className={styles.cardTitle}>Reminders</h2>
            <form
              onSubmit={handleAddReminder}
              style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}
            >
              <input
                required
                placeholder="Enter reminder message..."
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                className={styles.input}
                style={{ flex: 1, minWidth: 200 }}
              />
              <button type="submit" disabled={reminderSaving} className={styles.btnGreen}>
                {reminderSaving ? "Adding…" : "Add Reminder"}
              </button>
            </form>
            <div className={leaveStyles.reqTableShell}>
              <div className={tableStyles.eventsScroll} style={{ maxHeight: 280 }}>
                {reminders.length === 0 ? (
                  <div className={leaveStyles.reqEmpty}>No reminders yet.</div>
                ) : (
                  <table className={`${leaveStyles.reqTable} ${tableStyles.eventsTableFit}`}>
                    <thead>
                      <tr>
                        <th style={{ width: "80%" }}>Message</th>
                        <th style={{ width: "20%" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reminders.map((reminder) => (
                        <tr key={reminder.id}>
                          <td style={{ whiteSpace: "normal" }}>{reminder.message}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleDeleteReminder(reminder.id)}
                              disabled={deletingReminderId === reminder.id}
                              className={`${tableStyles.deptBtn} ${tableStyles.deptBtnDelete}`}
                            >
                              {deletingReminderId === reminder.id ? "…" : "Delete"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <CompanyPolicySection />
          </div>
        </div>
      </div>
    </OptionalAdminShell>
  );
}
