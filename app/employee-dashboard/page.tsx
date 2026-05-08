"use client";
import React from "react";
import { getParts, SERVER_TIMEZONE } from "../../lib/timezone";
// Company Policy widget/modal
function CompanyPolicyWidget() {
  const [policies, setPolicies] = React.useState<any[]>([]);
  const [modalOpen, setModalOpen] = React.useState<number | null>(null);
  React.useEffect(() => {
    fetch("/api/company-policies", { cache: "no-store" })
      .then(res => res.json())
      .then(data => setPolicies(Array.isArray(data.policies) ? data.policies : []));
  }, []);
  if (!policies.length) return null;
  return (
    <>
      <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#3e2b5c", marginBottom: 10, marginLeft: 2 }}>Company Policies</div>
      <div style={{ padding: 18, width: "100%", textAlign: "left", background: "#fff", borderRadius: 12, border: "1px solid #e6e8f2", boxShadow: "0 6px 14px rgba(10,31,68,0.06)" }}>
        {policies.map(policy => {
          const showReadMore = policy.description && policy.description.length > 80;
          return (
            <div key={policy.id} style={{ marginBottom: 18 }}>
              <div style={{ color: "#4a5775", fontSize: "1rem", marginBottom: 2, fontWeight: 600 }}>{policy.heading}</div>
              <div style={{ color: "#4a5775", fontSize: "0.97rem", minHeight: 32 }}>
                {showReadMore ? policy.description.slice(0, 80) + "..." : policy.description}
              </div>
              {showReadMore && (
                <div style={{ marginTop: 8 }}>
                  <a href="#" style={{ color: "#1853b3", fontSize: "0.97rem", textDecoration: "underline", fontWeight: 600 }} onClick={e => { e.preventDefault(); setModalOpen(policy.id); }}>Read more...</a>
                </div>
              )}
              {modalOpen === policy.id && (
                <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(15,29,64,0.18)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ background: "#fff", borderRadius: 22, boxShadow: "0 24px 64px rgba(30,78,170,0.18)", padding: 36, width: 540, height: 420, overflowY: "auto", position: "relative", border: "1px solid #e7e7ff", display: "flex", flexDirection: "column" }}>
                    <div style={{ fontWeight: 700, fontSize: "1.25rem", color: "#1853b3", marginBottom: 16, letterSpacing: 0.5 }}>{policy.heading}</div>
                    <div style={{ color: "#4a5775", fontSize: "1.07rem", lineHeight: 1.7, marginBottom: 28, flex: 1 }}>{policy.description}</div>
                    <button onClick={() => setModalOpen(null)} style={{ position: "absolute", top: 18, right: 18, background: "linear-gradient(120deg, #8bf3ff, #5b9bff)", color: "#0b1b40", border: "none", borderRadius: 10, padding: "10px 22px", fontWeight: 700, cursor: "pointer", fontSize: "1rem", boxShadow: "0 4px 16px rgba(30,78,170,0.10)" }}>Close</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
import { ClockBreakPrayerWidget } from "../components/ClockBreakPrayer";

export default function EmployeeDashboardPage() {
  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [employeeName, setEmployeeName] = React.useState("");
  const [calendarNow, setCalendarNow] = React.useState(() => new Date());

  const todayParts = React.useMemo(() => {
    const parts = getParts(calendarNow, SERVER_TIMEZONE);
    if (parts) return parts;

    const fallback = calendarNow;
    return {
      year: fallback.getFullYear(),
      month: fallback.getMonth() + 1,
      day: fallback.getDate(),
      hour: fallback.getHours(),
      minute: fallback.getMinutes(),
      second: fallback.getSeconds(),
    };
  }, [calendarNow]);

  React.useEffect(() => {
    const syncNow = () => setCalendarNow(new Date());
    const interval = setInterval(syncNow, 30000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    const onFocus = () => syncNow();
    const onPageShow = () => syncNow();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const loginId = localStorage.getItem("loginId");
    const cachedId = localStorage.getItem("employeeId");
    const cachedName = localStorage.getItem("employeeName");

    if (cachedId) setEmployeeId(cachedId);
    if (cachedName) setEmployeeName(cachedName);

    if (!loginId) return;
    let apiUrl = "/api/hrm_employees?";
    apiUrl += loginId.includes("@") ? `email=${loginId}` : `username=${loginId}`;

    Promise.all([
      fetch(apiUrl).then(res => res.json()).catch(() => ({ success: false })),
      fetch(`/api/hrm_employees?employeeId=${loginId}`).then(res => res.json()).catch(() => ({ success: false }))
    ]).then(([data1, data2]) => {
      const data = data1.success ? data1 : data2;
      if (data.success && data.employee) {
        const empId = data.employee.id || data.employee.employee_id || loginId;
        const empName = `${data.employee.first_name || ""} ${data.employee.middle_name || ""} ${data.employee.last_name || ""}`.trim();
        setEmployeeId(String(empId));
        setEmployeeName(empName);
        localStorage.setItem("employeeId", String(empId));
        localStorage.setItem("employeeName", empName);
      }
    });
  }, []);

  const gradientCard: React.CSSProperties = {
    background: "linear-gradient(135deg, #0f1d40 0%, #122b66 40%, #1853b3 100%)",
    borderRadius: 0,
    padding: "32px 32px 28px",
    color: "#e8f0ff",
    boxShadow: "0 20px 60px rgba(8, 25, 66, 0.35)",
    width: "100%"
  };

  const quickActionStyle: React.CSSProperties = {
    border: "none",
    borderRadius: 14,
    padding: "12px 16px",
    fontSize: "0.9rem",
    fontWeight: 700,
    color: "#0f1d40",
    cursor: "pointer",
    background: "#f7fafc",
    boxShadow: "0 8px 24px rgba(15,29,64,0.12)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease"
  };

  const infoPill: React.CSSProperties = {
    background: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: "0.92rem",
    color: "#dbe7ff",
    border: "1px solid rgba(255,255,255,0.12)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8
  };

  const calendarYear = todayParts.year;
  const calendarMonthIndex = todayParts.month - 1;
  const monthStartUtc = new Date(Date.UTC(calendarYear, calendarMonthIndex, 1));
  const monthName = new Intl.DateTimeFormat(undefined, {
    month: "long",
    timeZone: SERVER_TIMEZONE,
  }).format(new Date(Date.UTC(calendarYear, calendarMonthIndex, 1, 12, 0, 0)));
  const daysInMonth = new Date(Date.UTC(calendarYear, calendarMonthIndex + 1, 0)).getUTCDate();
  const leadingBlanks = monthStartUtc.getUTCDay();
  const calendarSlots = Array.from({ length: leadingBlanks + daysInMonth }, (_, idx) => {
    if (idx < leadingBlanks) return null;
    const day = idx - leadingBlanks + 1;
    const isToday = day === todayParts.day;
    return { day, isToday };
  });

  const [events, setEvents] = React.useState<Array<{ id: number; title: string; description?: string; start_at: string; end_at?: string | null; location?: string | null }>>([]);
  const [widgetHeading, setWidgetHeading] = React.useState("Upcoming Events");
  const [reminders, setReminders] = React.useState<Array<{ id: number; message: string }>>([]);

  const fetchEvents = React.useCallback(async () => {
    try {
      const res = await fetch("/api/events", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        setEvents(data.events || []);
        if (data.widgetHeading) setWidgetHeading(data.widgetHeading);
      }
    } catch (err) {
      console.error("events fetch", err);
    }
  }, []);

  const fetchReminders = React.useCallback(async () => {
    try {
      const res = await fetch("/api/reminders", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) setReminders(data.reminders || []);
    } catch (err) {
      console.error("reminders fetch", err);
    }
  }, []);

  React.useEffect(() => {
    fetchEvents();
    fetchReminders();
    if (typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    ws.onmessage = evt => {
      try {
        const msg = JSON.parse(evt.data.toString());
        if (msg?.type === "events_updated") fetchEvents();
        if (msg?.type === "reminders_updated") fetchReminders();
      } catch (_) {
        // ignore
      }
    };
    return () => ws.close();
  }, [fetchEvents, fetchReminders]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      width: "100%",
      background: "radial-gradient(circle at 20% 20%, #f0f6ff 0%, #eef2fb 28%, #f7fbff 55%, #ffffff 100%)",
      minHeight: "100vh",
      padding: 0
    }}>
      <div style={{ width: "100%", padding: 0, margin: 0 }}>
        <div style={gradientCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.95rem", opacity: 0.85 }}>Welcome back</div>
              <div style={{ fontSize: "1.7rem", fontWeight: 700, marginTop: 6 }}>{employeeName || "Your dashboard"}</div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span style={infoPill}>Small daily efforts compound into big wins. Keep going.</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={{ ...quickActionStyle, background: "linear-gradient(120deg, #8bf3ff, #5b9bff)", color: "#0b1b40" }} onClick={() => window.location.href = "/employee-dashboard/time"}>Time & Attendance</button>
              <button style={{ ...quickActionStyle, background: "linear-gradient(120deg, #ffd89b, #f7b733)", color: "#3d2600" }} onClick={() => window.location.href = "/employee-dashboard/leave"}>Leave Center</button>
            </div>
          </div>
          <div style={{ marginTop: 22, background: "rgba(255,255,255,0.08)", borderRadius: 0, padding: 18, border: "1px solid rgba(255,255,255,0.12)" }}>
            <ClockBreakPrayerWidget employeeId={employeeId} employeeName={employeeName} />
          </div>
        </div>
      </div>

      <div style={{ width: "100%", padding: "8px 20px 12px" }}>
        <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 14, boxShadow: "0 10px 28px rgba(10,31,68,0.08)", border: "1px solid #e6ecf5" }}>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#0f1d40", marginBottom: 8 }}>Quick Tasks</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button style={{ ...quickActionStyle, width: "100%" }} onClick={() => window.location.href = "/employee-dashboard/time"}>View Break Summary</button>
              <button style={{ ...quickActionStyle, width: "100%" }} onClick={() => window.location.href = "/employee-dashboard/leave"}>Request Time Off</button>
            </div>
          </div>

          <div style={{ background: "linear-gradient(145deg, #fdf2f8, #eef2ff)", borderRadius: 14, padding: 14, boxShadow: "0 10px 28px rgba(10,31,68,0.08)", border: "1px solid #e8e8ff" }}>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#531f7f", marginBottom: 10 }}>Reminders</div>
            {reminders.length === 0 ? (
              <div style={{ margin: 0, paddingLeft: 18, color: "#3e2b5c", lineHeight: 1.5 }}>No reminders at the moment.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, color: "#3e2b5c", lineHeight: 1.5 }}>
                {reminders.map(reminder => (
                  <li key={reminder.id}>{reminder.message}</li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ background: "linear-gradient(145deg, #e3fff4, #f6fffb)", borderRadius: 14, padding: 14, boxShadow: "0 10px 28px rgba(10,31,68,0.08)", border: "1px solid #dcf5ea" }}>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#0f5132", marginBottom: 10 }}>Shortcuts</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
              <button style={{ ...quickActionStyle, background: "#ffffff", color: "#0f1d40" }} onClick={() => window.location.href = "/employee-dashboard/time"}>Attendance</button>
              <button style={{ ...quickActionStyle, background: "#ffffff", color: "#0f1d40" }} onClick={() => window.location.href = "/employee-dashboard/leave"}>Leaves</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ width: "100%", padding: "12px 20px 20px" }}>
        <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 14, boxShadow: "0 10px 28px rgba(10,31,68,0.08)", border: "1px solid #e8ecf5" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#0f1d40" }}>{monthName} {calendarYear}</div>
              <div style={{ color: "#6b7b9b", fontSize: "0.9rem" }}>Calendar</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, textAlign: "center", color: "#6b7b9b", fontWeight: 700, fontSize: "0.85rem", marginBottom: 8 }}>
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(label => (
                <div key={label}>{label}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
              {calendarSlots.map((slot, idx) => (
                <div key={idx} style={{
                  minHeight: 48,
                  borderRadius: 10,
                  background: slot ? (slot.isToday ? "linear-gradient(135deg,#8bf3ff,#5b9bff)" : "#f7f9fc") : "transparent",
                  color: slot ? (slot.isToday ? "#0b1b40" : "#0f1d40") : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  boxShadow: slot && slot.isToday ? "0 10px 24px rgba(30,78,170,0.18)" : undefined,
                  border: slot && slot.isToday ? "1px solid rgba(11,27,64,0.15)" : "1px solid #eef1f7"
                }}>
                  {slot ? slot.day : ""}
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "linear-gradient(145deg, #f6f0ff, #eef7ff)", borderRadius: 14, padding: 14, boxShadow: "0 10px 28px rgba(10,31,68,0.08)", border: "1px solid #e7e7ff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#3e2b5c" }}>{widgetHeading}</div>
              <span style={{ fontSize: "0.9rem", color: "#6b7b9b" }}>Organization</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {events.length === 0 && (
                <div style={{ color: "#6b7b9b", fontSize: "0.95rem" }}>No upcoming events yet.</div>
              )}
              {events.map(ev => (
                <div key={ev.id} style={{ background: "#ffffff", borderRadius: 12, padding: 10, border: "1px solid #e6e8f2", boxShadow: "0 6px 14px rgba(10,31,68,0.06)" }}>
                  <div style={{ fontWeight: 700, color: "#1a2550", marginBottom: 4 }}>{ev.title}</div>
                  <div style={{ fontSize: "0.95rem", color: "#4a5775" }}>{new Date(ev.start_at).toLocaleString()}</div>
                  {/* End date removed as requested */}
                  {ev.location && <div style={{ fontSize: "0.9rem", color: "#7b86a3", marginTop: 2 }}>Location: {ev.location}</div>}
                  {ev.description && <div style={{ fontSize: "0.9rem", color: "#4a5775", marginTop: 4 }}>{ev.description}</div>}
                </div>
              ))}
              {/* Company Policy widget at bottom, aligned and styled */}
              <CompanyPolicyWidget />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
