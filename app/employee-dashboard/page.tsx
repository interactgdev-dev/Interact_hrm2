"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  FaClock,
  FaCalendarAlt,
  FaUsers,
  FaTicketAlt,
} from "react-icons/fa";
import {
  getDateStringInTimeZone,
  getParts,
  SERVER_TIMEZONE,
} from "../../lib/timezone";
import { resolveEventColor } from "../../lib/event-colors";
import type { TicketCategory } from "../../lib/ticket-catalog";
import {
  getLastAdminMessage,
  hasUnreadAdminReply,
  loadTicketSeenMap,
  saveTicketSeen,
  type TicketThreadMessage,
} from "../../lib/ticket-thread";
import { ATTENDANCE_DATA_CHANGED } from "../../lib/ui-sync/breakPrayerDataRefresh";
import { formatDashboardHoursOnly } from "../../lib/attendance-display";
import styles from "./employee-dashboard.module.css";
import { fetchEmployeeHierarchy, type HierarchyPerson } from "../employee-hierarchy-api";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { TardyNoteWidget } from "../components/TardyNoteWidget";

type AttendanceRow = {
  id?: number;
  date?: string;
  clock_in?: string | null;
  clock_out?: string | null;
  is_late?: boolean;
  late_minutes?: number;
};

type DayChart = {
  label: string;
  dateKey: string;
  hours: number;
  status: "onTime" | "tardy" | "absent" | "pending" | "upcoming";
  lateMinutes: number;
  isToday: boolean;
};

type LeaveBalance = {
  annual: number;
  annualAllowance: number;
  bereavement: number;
  bereavementAllowance: number;
};

type TicketWidgetRow = {
  id: number;
  ticket_number: string;
  subject: string | null;
  status: string;
  category: TicketCategory;
  ticket_type: string;
  messages?: TicketThreadMessage[];
  updated_at: string;
};

function ticketStatusLabel(status: string, ticketType?: string) {
  if (ticketType === "leave" && status === "resolved") return "approved";
  return status.replace("_", " ");
}

function addDaysToDateKey(dateKey: string, daysToAdd: number) {
  const [yearStr, monthStr, dayStr] = dateKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return dateKey;
  const utc = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

function weekdayIndexKarachi(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return -1;
  const instant = new Date(Date.UTC(y, m - 1, d, 7, 0, 0));
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: SERVER_TIMEZONE,
    weekday: "short",
  }).format(instant);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

/** Mon → Fri of the work week containing anchorKey (Karachi). */
function workWeekMonFriKeys(anchorKey: string): string[] {
  const wd = weekdayIndexKarachi(anchorKey);
  if (wd < 0) return [];
  const daysFromMonday = wd === 0 ? 6 : wd - 1;
  const monday = addDaysToDateKey(anchorKey, -daysFromMonday);
  return Array.from({ length: 5 }, (_, i) => addDaysToDateKey(monday, i));
}

function dayLabelFromKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const instant = new Date(Date.UTC(y, m - 1, d, 7, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SERVER_TIMEZONE,
    weekday: "short",
  }).format(instant);
}

function recordDateKey(record: AttendanceRow) {
  if (record.clock_in) {
    const fromClock = getDateStringInTimeZone(record.clock_in, SERVER_TIMEZONE);
    if (fromClock) return fromClock;
  }
  if (record.date) {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(String(record.date));
    if (m) return m[0];
  }
  return "";
}

function workHours(record: AttendanceRow): number {
  if (!record.clock_in) return 0;
  const inParts = getParts(record.clock_in, SERVER_TIMEZONE);
  if (!inParts) return 0;
  const start = Date.UTC(
    inParts.year,
    inParts.month - 1,
    inParts.day,
    inParts.hour,
    inParts.minute,
    inParts.second
  );
  let end: number;
  if (record.clock_out) {
    const outParts = getParts(record.clock_out, SERVER_TIMEZONE);
    if (!outParts) return 0;
    end = Date.UTC(
      outParts.year,
      outParts.month - 1,
      outParts.day,
      outParts.hour,
      outParts.minute,
      outParts.second
    );
  } else {
    const nowParts = getParts(new Date(), SERVER_TIMEZONE);
    if (!nowParts) return 0;
    end = Date.UTC(
      nowParts.year,
      nowParts.month - 1,
      nowParts.day,
      nowParts.hour,
      nowParts.minute,
      nowParts.second
    );
  }
  return Math.max(0, (end - start) / 3600000);
}

function StatValue({ value }: { value: string }) {
  return <>{value}</>;
}

type DashboardEvent = {
  id: number | string;
  title: string;
  description?: string;
  start_at: string;
  location?: string | null;
  color?: string | null;
  source?: string;
};

function eventDateKey(startAt: string) {
  // Holidays use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss — prefer the date prefix.
  if (/^\d{4}-\d{2}-\d{2}/.test(startAt)) return startAt.slice(0, 10);
  return getDateStringInTimeZone(startAt, SERVER_TIMEZONE) || "";
}

const ProgressRing = React.memo(function ProgressRing({
  pct,
  color,
  size = 54,
  children,
}: {
  pct: number;
  color: string;
  size?: number;
  children?: React.ReactNode;
}) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c - (clamped / 100) * c;

  return (
    <div className={styles.ringWrap} style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={styles.ringArc}
        />
      </svg>
      {children ? <div className={styles.ringCenter}>{children}</div> : null}
    </div>
  );
});

function CompanyPolicyWidget() {
  const [policies, setPolicies] = React.useState<
    Array<{ id: number; heading: string; description: string }>
  >([]);
  const [modalOpen, setModalOpen] = React.useState<number | null>(null);

  React.useEffect(() => {
    fetch("/api/company-policies", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) =>
        setPolicies(Array.isArray(data.policies) ? data.policies : [])
      );
  }, []);

  if (!policies.length) return null;

  const active = policies.find((p) => p.id === modalOpen);

  return (
    <div className={styles.policyBlock}>
      <p className={styles.cardTitle} style={{ marginBottom: 10, fontSize: 13 }}>Company policies</p>
      {policies.map((policy) => {
        const showReadMore =
          policy.description && policy.description.length > 80;
        return (
          <div key={policy.id} className={styles.policyItem}>
            <div className={styles.policyHead}>{policy.heading}</div>
            <div className={styles.policyBody}>
              {showReadMore
                ? policy.description.slice(0, 80) + "..."
                : policy.description}
            </div>
            {showReadMore && (
              <button
                type="button"
                className={styles.policyMore}
                onClick={() => setModalOpen(policy.id)}
              >
                Read more
              </button>
            )}
          </div>
        );
      })}
      {active && (
        <div
          className={styles.modalBg}
          onClick={() => setModalOpen(null)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setModalOpen(null)}
            >
              Close
            </button>
            <h3 className={styles.modalTitle}>{active.heading}</h3>
            <p className={styles.policyBody}>{active.description}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeeDashboardPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = React.useState("");
  const [calendarNow, setCalendarNow] = React.useState(() => new Date());
  const [eventsMonthOffset, setEventsMonthOffset] = React.useState(0);
  const eventsYearRef = React.useRef(new Date().getFullYear());
  const [attendance, setAttendance] = React.useState<AttendanceRow[]>([]);
  const [leaveBalance, setLeaveBalance] = React.useState<LeaveBalance>({
    annual: 0,
    annualAllowance: 20,
    bereavement: 0,
    bereavementAllowance: 3,
  });
  const [events, setEvents] = React.useState<DashboardEvent[]>([]);
  const [holidays, setHolidays] = React.useState<DashboardEvent[]>([]);
  const [widgetHeading, setWidgetHeading] = React.useState("Upcoming Events");
  const [reminders, setReminders] = React.useState<
    Array<{ id: number; message: string }>
  >([]);
  const [teamMembers, setTeamMembers] = React.useState<HierarchyPerson[]>([]);
  const [tickets, setTickets] = React.useState<TicketWidgetRow[]>([]);
  const [loadingTickets, setLoadingTickets] = React.useState(false);
  const [ticketPulseIds, setTicketPulseIds] = React.useState<number[]>([]);
  const [ticketSeenMap, setTicketSeenMap] = React.useState<Record<number, string>>({});
  const ticketsRef = React.useRef<TicketWidgetRow[]>([]);
  const ticketTimerRef = React.useRef<number | null>(null);

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

  const todayKey = React.useMemo(
    () => getDateStringInTimeZone(calendarNow, SERVER_TIMEZONE),
    [calendarNow]
  );

  React.useEffect(() => {
    const syncNow = () => setCalendarNow(new Date());
    const interval = setInterval(syncNow, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", syncNow);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", syncNow);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const empId =
      localStorage.getItem("employeeId") || localStorage.getItem("loginId") || "";
    setEmployeeId(empId);
    if (empId) setTicketSeenMap(loadTicketSeenMap(empId));
  }, []);

  const fetchTickets = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!employeeId) return;
    try {
      if (!opts?.silent) setLoadingTickets(true);
      const res = await fetch(
        `/api/employee-tickets?employeeId=${encodeURIComponent(employeeId)}&limit=20&ts=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data?.success) {
        const next: TicketWidgetRow[] = data.tickets || [];
        const prev = ticketsRef.current;
        const pulseIds: number[] = [];
        next.forEach((t) => {
          if (t.ticket_type === "leave") return;
          const lastAdmin = getLastAdminMessage(t.messages ?? []);
          const prevTicket = prev.find((p) => p.id === t.id);
          const prevAdmin = prevTicket ? getLastAdminMessage(prevTicket.messages ?? []) : null;
          if (lastAdmin && (!prevAdmin || prevAdmin.id !== lastAdmin.id)) {
            pulseIds.push(t.id);
          }
        });
        setTickets(next);
        ticketsRef.current = next;
        if (pulseIds.length) {
          setTicketPulseIds(pulseIds);
          if (ticketTimerRef.current) window.clearTimeout(ticketTimerRef.current);
          ticketTimerRef.current = window.setTimeout(() => setTicketPulseIds([]), 3500);
        }
      }
    } catch (err) {
      console.error("tickets fetch", err);
    } finally {
      if (!opts?.silent) setLoadingTickets(false);
    }
  }, [employeeId]);

  const openTicketPage = React.useCallback(
    (ticket?: TicketWidgetRow) => {
      if (ticket && ticket.ticket_type !== "leave") {
        const lastAdmin = getLastAdminMessage(ticket.messages ?? []);
        if (lastAdmin && employeeId) {
          saveTicketSeen(employeeId, ticket.id, lastAdmin.id);
          setTicketSeenMap((prev) => ({ ...prev, [ticket.id]: lastAdmin.id }));
        }
      }
      // Always open My tickets page (full list + replies) — do not auto-open a modal
      router.push("/employee-dashboard/generate-ticket");
    },
    [employeeId, router]
  );

  const fetchAttendance = React.useCallback(async () => {
    if (!employeeId) return;
    try {
      const today = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
      const monthStart = `${today.slice(0, 7)}-01`;
      const weekMonday = workWeekMonFriKeys(today)[0] ?? monthStart;
      const fromDate = monthStart < weekMonday ? monthStart : weekMonday;
      const res = await fetch(
        `/api/attendance?employeeId=${encodeURIComponent(employeeId)}&fromDate=${fromDate}&toDate=${today}&ts=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.success) setAttendance(data.attendance || []);
    } catch (err) {
      console.error("attendance fetch", err);
    }
  }, [employeeId]);

  const fetchLeaveBalance = React.useCallback(async () => {
    if (!employeeId) return;
    try {
      const res = await fetch(
        `/api/leave-balance?employee_id=${employeeId}&ts=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.success) {
        setLeaveBalance({
          annual: data.annualBalance ?? 0,
          annualAllowance: data.annualAllowance ?? 20,
          bereavement: data.bereavementBalance ?? 0,
          bereavementAllowance: 3,
        });
      }
    } catch (err) {
      console.error("leave balance fetch", err);
    }
  }, [employeeId]);

  const fetchEvents = React.useCallback(async (year?: number) => {
    try {
      const y = year ?? new Date().getFullYear();
      const res = await fetch(`/api/events?year=${y}`, { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        setEvents(data.events || []);
        setHolidays(
          (data.holidays || []).map((h: DashboardEvent) => ({
            ...h,
            source: h.source || "us_holiday",
          }))
        );
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
    if (!employeeId) return;
    // Attendance first (hours chart) — rest deferred so route paint stays snappy
    void fetchAttendance();
    const runSecondary = () => {
      void fetchLeaveBalance();
      void fetchTickets();
      void fetchEmployeeHierarchy(employeeId).then((data) => {
        if (!data) return;
        setTeamMembers(data.teamMembers);
      });
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(runSecondary, { timeout: 1800 });
    } else {
      timeoutId = setTimeout(runSecondary, 120);
    }
    return () => {
      if (idleId !== undefined && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [employeeId, fetchAttendance, fetchLeaveBalance, fetchTickets]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    const connect = () => {
      if (cancelled) return;
      void fetchReminders();
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data.toString());
          if (msg?.type === "events_updated") fetchEvents(eventsYearRef.current);
          if (msg?.type === "reminders_updated") fetchReminders();
          if (msg?.type === "leave_update") fetchLeaveBalance();
          if (msg?.type === "ticket_update" || msg?.type === "ticket_created") {
            void fetchTickets({ silent: true });
          }
        } catch {
          /* ignore */
        }
      };
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(connect, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(connect, 200);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
      ws?.close();
    };
  }, [fetchEvents, fetchReminders, fetchLeaveBalance, fetchTickets]);

  React.useEffect(() => {
    const onAttendance = () => {
      fetchAttendance();
    };
    window.addEventListener(ATTENDANCE_DATA_CHANGED, onAttendance);
    return () =>
      window.removeEventListener(ATTENDANCE_DATA_CHANGED, onAttendance);
  }, [fetchAttendance]);

  const attendanceByDate = React.useMemo(() => {
    const map = new Map<string, AttendanceRow>();
    attendance.forEach((row) => {
      const key = recordDateKey(row);
      if (!key) return;
      const existing = map.get(key);
      if (!existing || workHours(row) > workHours(existing)) map.set(key, row);
    });
    return map;
  }, [attendance]);

  const weekDayKeys = React.useMemo(() => workWeekMonFriKeys(todayKey), [todayKey]);

  const todayRecord = attendanceByDate.get(todayKey);
  const isClockedIn = Boolean(todayRecord?.clock_in && !todayRecord?.clock_out);

  // Tick while clocked in so hours stay live — 5s avoids freezing the whole dashboard every second
  const [liveTick, setLiveTick] = React.useState(0);
  React.useEffect(() => {
    if (!isClockedIn) return;
    const id = setInterval(() => setLiveTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [isClockedIn]);

  const weekChart: DayChart[] = React.useMemo(() => {
    return weekDayKeys.map((key) => {
      const isToday = key === todayKey;
      if (key > todayKey) {
        return {
          label: dayLabelFromKey(key),
          dateKey: key,
          hours: 0,
          status: "upcoming" as const,
          lateMinutes: 0,
          isToday,
        };
      }
      const record = attendanceByDate.get(key);
      if (!record?.clock_in) {
        const status = isToday ? ("pending" as const) : ("absent" as const);
        return {
          label: dayLabelFromKey(key),
          dateKey: key,
          hours: 0,
          status,
          lateMinutes: 0,
          isToday,
        };
      }
      const hours = workHours(record);
      const status = record.is_late ? ("tardy" as const) : ("onTime" as const);
      return {
        label: dayLabelFromKey(key),
        dateKey: key,
        hours,
        status,
        lateMinutes: record.late_minutes || 0,
        isToday,
      };
    });
  }, [weekDayKeys, attendanceByDate, todayKey, liveTick]);

  const maxChartHours = Math.max(8, ...weekChart.map((d) => d.hours), 1);

  const todayHours = React.useMemo(() => {
    return todayRecord ? workHours(todayRecord) : 0;
  }, [todayRecord, liveTick]);
  const todayStatus = !todayRecord?.clock_in
    ? "Not clocked in"
    : todayRecord.is_late
      ? `Late · ${todayRecord.late_minutes || 0}m`
      : "On time";

  const monthStart = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-01`;
  const monthTardies = React.useMemo(() => {
    let count = 0;
    attendanceByDate.forEach((row, key) => {
      if (key >= monthStart && key <= todayKey && row.is_late) count++;
    });
    return count;
  }, [attendanceByDate, monthStart, todayKey]);

  const calendarYear = todayParts.year;
  const calendarMonthIndex = todayParts.month - 1;
  const monthName = new Intl.DateTimeFormat(undefined, {
    month: "long",
    timeZone: SERVER_TIMEZONE,
  }).format(new Date(Date.UTC(calendarYear, calendarMonthIndex, 1, 12, 0, 0)));
  const calendarSlots = React.useMemo(() => {
    const monthStartUtc = new Date(Date.UTC(calendarYear, calendarMonthIndex, 1));
    const daysInMonth = new Date(
      Date.UTC(calendarYear, calendarMonthIndex + 1, 0)
    ).getUTCDate();
    const leadingBlanks = monthStartUtc.getUTCDay();
    return Array.from({ length: leadingBlanks + daysInMonth }, (_, idx) => {
      if (idx < leadingBlanks) return null;
      const day = idx - leadingBlanks + 1;
      const key = `${calendarYear}-${String(todayParts.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isToday = day === todayParts.day;
      const isTardy = attendanceByDate.get(key)?.is_late === true;
      return { day, isToday, isTardy };
    });
  }, [calendarYear, calendarMonthIndex, todayParts.month, todayParts.day, attendanceByDate]);

  const newReplyCount = React.useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.ticket_type !== "leave" &&
          hasUnreadAdminReply(t.id, t.messages, ticketSeenMap)
      ).length,
    [tickets, ticketSeenMap]
  );

  const ticketWidgetItems = React.useMemo(() => {
    return [...tickets]
      .filter((t) => {
        if (t.ticket_type === "leave") {
          const open = !["resolved", "rejected", "closed"].includes(t.status);
          return open;
        }
        const unread = hasUnreadAdminReply(t.id, t.messages, ticketSeenMap);
        const open = !["resolved", "rejected", "closed"].includes(t.status);
        const hasAdminReply = Boolean(getLastAdminMessage(t.messages ?? []));
        return unread || (open && hasAdminReply) || (open && t.status === "pending");
      })
      .sort((a, b) => {
        const aUnread =
          a.ticket_type !== "leave" && hasUnreadAdminReply(a.id, a.messages, ticketSeenMap)
            ? 1
            : 0;
        const bUnread =
          b.ticket_type !== "leave" && hasUnreadAdminReply(b.id, b.messages, ticketSeenMap)
            ? 1
            : 0;
        if (bUnread !== aUnread) return bUnread - aUnread;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice(0, 1);
  }, [tickets, ticketSeenMap]);

  const weekStats = React.useMemo(() => {
    let onTime = 0;
    let late = 0;
    let absent = 0;
    let totalHours = 0;
    let present = 0;
    weekChart.forEach((d) => {
      if (d.status === "upcoming") return;
      if (d.status === "onTime") {
        onTime++;
        totalHours += d.hours;
        present++;
      } else if (d.status === "tardy") {
        late++;
        totalHours += d.hours;
        present++;
      } else if (d.status === "absent") {
        absent++;
      }
    });
    const weekScore =
      weekChart.length === 0
        ? 0
        : Math.round(((onTime * 100 + late * 40) / weekChart.length));
    const avgHours = present > 0 ? totalHours / present : 0;
    return { onTime, late, absent, weekScore, avgHours };
  }, [weekChart]);

  const allCalendarEvents = React.useMemo(() => {
    const merged: DashboardEvent[] = [
      ...events.map((ev) => ({ ...ev, source: ev.source || "company" })),
      ...holidays,
    ];
    return merged.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
  }, [events, holidays]);

  const eventsCal = React.useMemo(() => {
    const base = new Date(Date.UTC(todayParts.year, todayParts.month - 1 + eventsMonthOffset, 1, 12, 0, 0));
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth() + 1;
    const monthLabel = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(base);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const byDay = new Map<number, { title: string; color: string; id: string | number }[]>();
    allCalendarEvents.forEach((ev, i) => {
      const key = eventDateKey(ev.start_at);
      if (!key) return;
      const [y, m, d] = key.split("-").map(Number);
      if (y !== year || m !== month) return;
      const list = byDay.get(d) || [];
      list.push({
        id: ev.id,
        title: ev.title || "Event",
        color: resolveEventColor(ev, i),
      });
      byDay.set(d, list);
    });
    const slots = Array.from({ length: leading + daysInMonth }, (_, idx) => {
      if (idx < leading) return null;
      const day = idx - leading + 1;
      return { day, tags: byDay.get(day) || [] };
    });
    return { year, month, monthLabel, slots };
  }, [todayParts.year, todayParts.month, eventsMonthOffset, allCalendarEvents]);

  /** Sidebar: next upcoming US / company events with distinct palette colors. */
  const sidebarEvents = React.useMemo(() => {
    const todayKey = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-${String(todayParts.day).padStart(2, "0")}`;
    const upcoming = allCalendarEvents
      .filter((ev) => {
        const key = eventDateKey(ev.start_at);
        return key && key >= todayKey;
      })
      .slice(0, 5);

    if (upcoming.length > 0) {
      return upcoming.map((ev, i) => ({
        ...ev,
        // Keep a stable chip color: prefer saved color, else cycle palette by slot
        color: resolveEventColor(ev, i),
      }));
    }

    // Rare empty fallback — same colorful layout as the PDF mock
    return [
      { id: -1, title: "Lunch", start_at: "", color: "#25c6da" },
      { id: -2, title: "Go Home", start_at: "", color: "#45aef0" },
      { id: -3, title: "Do Homework", start_at: "", color: "#ffb22c" },
      { id: -4, title: "Work On UI Design", start_at: "", color: "#e03756" },
      { id: -5, title: "Sleep Tight", start_at: "", color: "#7c4dff" },
    ] as DashboardEvent[];
  }, [allCalendarEvents, todayParts]);

  const jumpCalendarToEvent = React.useCallback(
    (ev: DashboardEvent) => {
      const key = eventDateKey(ev.start_at);
      if (!key) return;
      const [y, m] = key.split("-").map(Number);
      if (!y || !m) return;
      setEventsMonthOffset((y - todayParts.year) * 12 + (m - todayParts.month));
    },
    [todayParts.year, todayParts.month]
  );

  React.useEffect(() => {
    eventsYearRef.current = eventsCal.year;
    void fetchEvents(eventsCal.year);
  }, [eventsCal.year, fetchEvents]);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {/* Row: Generate Tickets | My Tickets | Reminders */}
        <section className={styles.topTrio}>
          <div
            className={styles.generateCard}
            role="button"
            tabIndex={0}
            onClick={() => router.push("/employee-dashboard/generate-ticket?type=leave")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push("/employee-dashboard/generate-ticket?type=leave");
              }
            }}
          >
            <img
              className={styles.generateIcon}
              src="/generate-ticket-icon.png"
              alt=""
              width={56}
              height={46}
              draggable={false}
            />
            <span className={styles.generateBtn}>Generate Tickets</span>
          </div>

          <article
            className={`${styles.panelCard} ${styles.ticketsPanel}`}
            role="button"
            tabIndex={0}
            onClick={() => openTicketPage()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openTicketPage();
              }
            }}
          >
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>My tickets</h2>
              <button
                type="button"
                className={styles.viewAll}
                onClick={(e) => {
                  e.stopPropagation();
                  router.push("/employee-dashboard/generate-ticket");
                }}
              >
                View all
              </button>
            </div>
            {newReplyCount > 0 ? (
              <span className={styles.replyBadge}>
                {newReplyCount} New {newReplyCount === 1 ? "Reply" : "Replies"}
              </span>
            ) : null}
            <ul className={styles.ticketList}>
              {ticketWidgetItems.length === 0 ? (
                <li className={styles.ticketItem}>
                  <div className={styles.ticketEmpty}>No pending tickets</div>
                </li>
              ) : (
                ticketWidgetItems.map((ticket) => {
                  const isLeave = ticket.ticket_type === "leave";
                  const unread =
                    !isLeave &&
                    hasUnreadAdminReply(ticket.id, ticket.messages, ticketSeenMap);
                  const lastAdmin = isLeave
                    ? null
                    : getLastAdminMessage(ticket.messages ?? []);
                  return (
                    <li
                      key={ticket.id}
                      className={styles.ticketItem}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTicketPage(ticket);
                      }}
                    >
                      <div className={styles.ticketTop}>
                        <span className={styles.ticketNum}>{ticket.ticket_number}</span>
                        <span className={unread ? styles.badgeNew : styles.badgeMuted}>
                          {unread ? "New reply" : ticketStatusLabel(ticket.status, ticket.ticket_type)}
                        </span>
                      </div>
                      <div className={styles.ticketSub}>{ticket.subject}</div>
                      {lastAdmin ? (
                        <div className={styles.ticketPreview}>Admin: {lastAdmin.body}</div>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
          </article>

          <article className={`${styles.panelCard} ${styles.remindersCard}`}>
            <h2 className={styles.panelTitle}>Reminders</h2>
            {reminders.length === 0 ? (
              <p className={styles.empty}>No Reminders</p>
            ) : (
              <ul className={styles.simpleList}>
                {reminders.map((r) => (
                  <li key={r.id}>{r.message}</li>
                ))}
              </ul>
            )}
          </article>
        </section>

        {employeeId ? <TardyNoteWidget employeeId={employeeId} variant="slack" /> : null}

        {/* Row: Upcoming Events + 2x2 stats */}
        <section className={styles.midSplit}>
          <div className={styles.eventsWrap}>
            <h2 className={styles.eventsHeading}>{widgetHeading || "Upcoming Events"}</h2>
            <article className={styles.eventsCard}>
              <div className={styles.eventsBody}>
                <div className={styles.eventsSidebar}>
                  <button type="button" className={styles.eventsHeaderBtn}>
                    Events &amp; Schedules
                  </button>
                  {sidebarEvents.map((ev, i) => {
                    const color = resolveEventColor(ev, i);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        className={`${styles.eventSideBtn} ${i === 3 ? styles.eventSideBtnTall : ""}`}
                        style={{ background: color }}
                        title={ev.start_at ? new Date(ev.start_at).toLocaleString() : undefined}
                        onClick={() => jumpCalendarToEvent(ev)}
                      >
                        <span className={styles.eventArrow} aria-hidden>
                          →
                        </span>
                        <span className={styles.eventSideLabel}>
                          {(ev.title || "Event").toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className={styles.eventsCal}>
                  <div className={styles.eventsCalToolbar}>
                    <div className={styles.eventsCalNav}>
                      <button type="button" onClick={() => setEventsMonthOffset((v) => v - 1)}>
                        Prev
                      </button>
                      <button type="button" onClick={() => setEventsMonthOffset((v) => v + 1)}>
                        Next
                      </button>
                      <button type="button" onClick={() => setEventsMonthOffset(0)}>
                        Today
                      </button>
                    </div>
                    <div className={styles.eventsCalMonth}>{eventsCal.monthLabel}</div>
                    <div className={styles.eventsCalViews}>
                      <span className={styles.eventsCalViewActive}>Month</span>
                      <span>Week</span>
                      <span>Day</span>
                    </div>
                  </div>
                  <div className={styles.eventsCalDays}>
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                  <div className={styles.eventsCalGrid}>
                    {eventsCal.slots.map((slot, idx) =>
                      !slot ? (
                        <div key={idx} className={styles.eventsCalBlank} />
                      ) : (
                        <div
                          key={idx}
                          className={`${styles.eventsCalCell}${slot.tags.length ? ` ${styles.eventsCalCellHasEvent}` : ""}`}
                          style={
                            slot.tags[0]
                              ? ({
                                  ["--event-color" as string]: slot.tags[0].color,
                                } as React.CSSProperties)
                              : undefined
                          }
                          title={slot.tags.map((t) => t.title).join(", ") || undefined}
                        >
                          <span className={styles.eventsCalNum}>{slot.day}</span>
                          {slot.tags.slice(0, 2).map((tag, ti) => (
                            <span
                              key={ti}
                              className={styles.eventsCalTag}
                              style={{ background: tag.color }}
                              title={tag.title}
                            >
                              {tag.title.length > 9 ? `${tag.title.slice(0, 8)}…` : tag.title}
                            </span>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </article>
          </div>

          <div className={styles.statGrid}>
            <button
              type="button"
              className={`${styles.statTile} ${styles.statPurple}`}
              onClick={() => router.push("/employee-dashboard/time")}
            >
              <span className={styles.statBlob} aria-hidden />
              <span className={styles.statIconCircle} aria-hidden>
                <FaClock />
              </span>
              <div className={styles.statBig}>
                <StatValue value={formatDashboardHoursOnly(todayHours)} />
              </div>
              <div className={styles.statName}>Hours Today</div>
              <div className={styles.statSub}>{todayStatus}</div>
            </button>

            <button
              type="button"
              className={`${styles.statTile} ${styles.statBlue}`}
              onClick={() => router.push("/employee-dashboard/generate-ticket?type=leave")}
            >
              <span className={styles.statBlob} aria-hidden />
              <span className={styles.statIconCircle} aria-hidden>
                <FaCalendarAlt />
              </span>
              <div className={styles.statBig}>
                <StatValue value={String(leaveBalance.annual)} />
              </div>
              <div className={styles.statName}>Annual Leaves</div>
              <div className={styles.statSub}>of {leaveBalance.annualAllowance} Days</div>
            </button>

            <button
              type="button"
              className={`${styles.statTile} ${styles.statGreen}`}
              onClick={() => router.push("/employee-dashboard/generate-ticket?type=leave")}
            >
              <span className={styles.statBlob} aria-hidden />
              <span className={styles.statIconCircle} aria-hidden>
                <FaCalendarAlt />
              </span>
              <div className={styles.statBig}>
                <StatValue value={String(leaveBalance.bereavement)} />
              </div>
              <div className={styles.statName}>Bereavement Leaves</div>
              <div className={styles.statSub}>of {leaveBalance.bereavementAllowance} Days</div>
            </button>

            <button
              type="button"
              className={`${styles.statTile} ${styles.statOrange}`}
              onClick={() => router.push("/employee-dashboard/time")}
            >
              <span className={styles.statBlob} aria-hidden />
              <span className={styles.statIconCircle} aria-hidden>
                <FaClock />
              </span>
              <div className={styles.statBig}>
                <StatValue value={String(monthTardies).padStart(2, "0")} />
              </div>
              <div className={styles.statName}>Tardies</div>
              <div className={styles.statSub}>This Month</div>
            </button>
          </div>
        </section>

        {/* Row: Calendar | People | Quick Actions */}
        <section className={styles.bottomTrio}>
          <article className={`${styles.panelCard} ${styles.calCard}`}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{monthName}</h2>
              <span className={styles.latePill}>Late days marked</span>
            </div>
            <div className={styles.calDays}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className={styles.calCells}>
              {calendarSlots.map((slot, idx) => {
                if (!slot) return <div key={idx} className={`${styles.calCell} ${styles.calBlank}`} />;
                return (
                  <div
                    key={idx}
                    className={`${styles.calCell} ${slot.isToday ? styles.calToday : ""} ${slot.isTardy && !slot.isToday ? styles.calLate : ""}`}
                  >
                    {slot.day}
                  </div>
                );
              })}
            </div>
          </article>

          <article className={`${styles.panelCard} ${styles.peopleCard}`}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>People</h2>
              <button
                type="button"
                className={styles.viewAll}
                onClick={() => router.push("/employee-dashboard/my-team")}
              >
                View all
              </button>
            </div>
            {teamMembers.length > 0 ? (
              <div className={styles.teamGrid}>
                {teamMembers.slice(0, 6).map((m) => (
                  <div key={m.id} className={styles.teamMember} title={m.name}>
                    <EmployeeAvatar name={m.name} initials={m.initials} photo={m.photo} size="sm" />
                    <span className={styles.teamMemberName}>{m.name.split(" ")[0]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No direct reports</p>
            )}
          </article>

          <article className={`${styles.panelCard} ${styles.actionsCard}`}>
            <h2 className={styles.panelTitle}>Quick actions</h2>
            <div className={styles.actionList}>
              <button type="button" className={styles.actionBtn} onClick={() => router.push("/employee-dashboard/time")}>
                <span className={`${styles.actionIcon} ${styles.actionGreen}`}><FaClock /></span>
                Time &amp; attendance
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => router.push("/employee-dashboard/generate-ticket?type=leave")}
              >
                <span className={`${styles.actionIcon} ${styles.actionPurple}`}><FaTicketAlt /></span>
                Generate ticket
              </button>
              <button type="button" className={styles.actionBtn} onClick={() => router.push("/employee-dashboard/my-team")}>
                <span className={`${styles.actionIcon} ${styles.actionBlue}`}><FaUsers /></span>
                My team
              </button>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

