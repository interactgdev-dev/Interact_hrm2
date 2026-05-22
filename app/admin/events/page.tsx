"use client";
import React from "react";
import LayoutDashboard from "@/app/layout-dashboard";
import { CompanyPolicySection } from "../company-policy/CompanyPolicySection";

interface EventItem {
  id: number;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  is_all_day: number | boolean;
  location: string | null;
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

const initialForm = {
  title: "",
  description: "",
  start_at: "",
  end_at: "",
  is_all_day: false,
  location: "",
  status: "published",
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
    const ok = window.confirm("Delete this reminder?");
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
    const ok = window.confirm("Delete this event?");
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
    <LayoutDashboard>
      <div style={{ display: "flex", flexDirection: "column", gap: 32, width: "100%", maxWidth: 1200, margin: "0 auto", padding: "32px 0" }}>
        {/* Widget Settings */}
        <div style={{ background: "#f7faff", borderRadius: 16, boxShadow: "0 8px 32px rgba(10,31,68,0.10)", padding: 28, marginBottom: 0, border: "1px solid #e6e8f2" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: "1.35rem", color: "#1853b3", fontWeight: 700, letterSpacing: 0.5 }}>Widget Settings</h2>
            {headingSaving && <span style={{ fontSize: "1rem", color: "#6b7b9b" }}>Saving...</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <label style={{ fontSize: "1.05rem", fontWeight: 600, color: "#0f1d40", minWidth: "140px" }}>Widget Heading:</label>
            <select value={widgetHeading} onChange={handleHeadingChange} disabled={headingSaving} style={{ ...inputStyle, flex: 1, maxWidth: "340px", fontSize: "1.05rem", borderRadius: 10, background: "#fff", border: "1px solid #dbe7ff", boxShadow: "0 2px 8px rgba(10,31,68,0.04)", cursor: headingSaving ? "not-allowed" : "pointer" }}>
              <option value="Upcoming Events">Upcoming Events</option>
              <option value="Announcements">Announcements</option>
            </select>
          </div>
        </div>

        {/* Main Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(340px, 400px) 1fr", gap: 32, width: "100%" }}>
          {/* Add Event Card */}
          <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 8px 32px rgba(10,31,68,0.10)", padding: 28, border: "1px solid #e6e8f2" }}>
            <h2 style={{ margin: 0, fontSize: "1.18rem", color: "#1853b3", fontWeight: 700 }}>Add Event</h2>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
              <input required placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={{ ...inputStyle, fontSize: "1.05rem", borderRadius: 10, background: "#f7faff" }} />
              <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 80, fontSize: "1.05rem", borderRadius: 10, background: "#f7faff" }} />
              <label style={labelStyle}>Start At</label>
              <input required type="datetime-local" value={form.start_at} onChange={e => setForm({ ...form, start_at: e.target.value })} style={{ ...inputStyle, fontSize: "1.05rem", borderRadius: 10, background: "#f7faff" }} />
              <label style={labelStyle}>End At (optional)</label>
              <input type="datetime-local" value={form.end_at} onChange={e => setForm({ ...form, end_at: e.target.value })} style={{ ...inputStyle, fontSize: "1.05rem", borderRadius: 10, background: "#f7faff" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1.05rem" }}>
                <input type="checkbox" checked={!!form.is_all_day} onChange={e => setForm({ ...form, is_all_day: e.target.checked })} /> All day
              </label>
              <input placeholder="Location (optional)" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} style={{ ...inputStyle, fontSize: "1.05rem", borderRadius: 10, background: "#f7faff" }} />
              <button type="submit" disabled={saving} style={{ ...buttonStyle, fontSize: "1.05rem", borderRadius: 10, background: "linear-gradient(120deg, #1853b3, #8bf3ff)", color: "#fff", fontWeight: 700 }}>{saving ? "Saving..." : "Save Event"}</button>
            </form>
          </div>

          {/* Events List Card */}
          <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 8px 32px rgba(10,31,68,0.10)", padding: 28, border: "1px solid #e6e8f2" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: "1.18rem", color: "#1853b3", fontWeight: 700 }}>{widgetHeading}</h2>
              {loading && <span style={{ fontSize: "1rem", color: "#6b7b9b" }}>Loading...</span>}
            </div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              {events.length === 0 && <div style={{ color: "#6b7b9b", fontSize: "1.05rem" }}>No events yet.</div>}
              {events.map(ev => (
                <div key={ev.id} style={{ border: "1px solid #e6e8f2", borderRadius: 14, padding: 18, background: "#f7faff", boxShadow: "0 6px 18px rgba(10,31,68,0.05)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ fontWeight: 700, color: "#1853b3", fontSize: "1.08rem" }}>{ev.title}</div>
                    <button
                      type="button"
                      onClick={() => handleDelete(ev.id)}
                      disabled={deletingId === ev.id}
                      title="Delete event"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#c0392b",
                        cursor: deletingId === ev.id ? "not-allowed" : "pointer",
                        fontSize: "1.15rem",
                        padding: 4,
                      }}
                    >
                      {deletingId === ev.id ? "…" : "🗑"}
                    </button>
                  </div>
                  {ev.description && <div style={{ color: "#4a5775", fontSize: "1.05rem", marginTop: 2 }}>{ev.description}</div>}
                  <div style={{ color: "#6b7b9b", fontSize: "1.01rem", marginTop: 2 }}>
                    {new Date(ev.start_at).toLocaleString()} {ev.end_at ? ` - ${new Date(ev.end_at).toLocaleString()}` : ""}
                  </div>
                  {ev.location && <div style={{ color: "#7b86a3", fontSize: "0.98rem", marginTop: 2 }}>Location: {ev.location}</div>}
                  <div style={{ color: "#4a8b2c", fontSize: "0.95rem", marginTop: 2 }}>{ev.is_all_day ? "All day" : "Timed"} • {ev.status}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Reminders Card */}
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 8px 32px rgba(10,31,68,0.10)", padding: 28, border: "1px solid #e6e8f2", marginTop: 0 }}>
          <h2 style={{ margin: 0, fontSize: "1.18rem", color: "#1853b3", fontWeight: 700, marginBottom: 18 }}>Reminders</h2>
          <form onSubmit={handleAddReminder} style={{ display: "flex", gap: 14, marginBottom: 18 }}>
            <input 
              required 
              placeholder="Enter reminder message..." 
              value={reminderMessage} 
              onChange={e => setReminderMessage(e.target.value)} 
              style={{ ...inputStyle, flex: 1, fontSize: "1.05rem", borderRadius: 10, background: "#f7faff" }} 
            />
            <button type="submit" disabled={reminderSaving} style={{ ...buttonStyle, marginTop: 0, fontSize: "1.05rem", borderRadius: 10, background: "linear-gradient(120deg, #1853b3, #8bf3ff)", color: "#fff", fontWeight: 700, whiteSpace: "nowrap" }}>
              {reminderSaving ? "Adding..." : "Add Reminder"}
            </button>
          </form>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {reminders.length === 0 && <div style={{ color: "#6b7b9b", fontSize: "1.05rem" }}>No reminders yet.</div>}
            {reminders.map(reminder => (
              <div key={reminder.id} style={{ border: "1px solid #e6e8f2", borderRadius: 14, padding: 16, background: "#fef9f3", boxShadow: "0 6px 18px rgba(10,31,68,0.05)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ color: "#4a5775", fontSize: "1.05rem", lineHeight: 1.5 }}>{reminder.message}</div>
                <button
                  type="button"
                  onClick={() => handleDeleteReminder(reminder.id)}
                  disabled={deletingReminderId === reminder.id}
                  title="Delete reminder"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#c0392b",
                    cursor: deletingReminderId === reminder.id ? "not-allowed" : "pointer",
                    fontSize: "1.15rem",
                    padding: 4,
                  }}
                >
                  {deletingReminderId === reminder.id ? "…" : "🗑"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Company Policy Section Card */}
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 8px 32px rgba(10,31,68,0.10)", padding: 28, border: "1px solid #e6e8f2", marginTop: 0 }}>
          <CompanyPolicySection />
        </div>
      </div>
    </LayoutDashboard>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #dfe3eb",
  fontSize: "0.95rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 600,
  color: "#0f1d40",
};

const buttonStyle: React.CSSProperties = {
  marginTop: 4,
  padding: "12px 14px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(120deg, #0052cc, #0b74ff)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};
