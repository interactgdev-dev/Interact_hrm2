"use client";

import { fetchShellBranding } from "../shell-branding-api";
import { fetchEmployeeHierarchy, type HierarchyPerson } from "../employee-hierarchy-api";
import DashboardHomeView from "./DashboardHomeView";
import {
  getLastAdminMessage,
  hasUnreadAdminReply,
  loadTicketSeenMap,
  saveTicketSeen,
  type TicketThreadMessage,
} from "../../lib/ticket-thread";
import { ATTENDANCE_DATA_CHANGED } from "../../lib/ui-sync/breakPrayerDataRefresh";
import type { TicketCategory } from "../../lib/ticket-catalog";
import { resolveEventColor } from "../../lib/event-colors";
import {
  getDateStringInTimeZone,
  getParts,
  SERVER_TIMEZONE,
} from "../../lib/timezone";
import { useRouter } from "next/navigation";
import React from "react";

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
  const [liveClock, setLiveClock] = React.useState(() =>
    new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: SERVER_TIMEZONE,
    })
  );
  const [employeeName, setEmployeeName] = React.useState("Employee");
  const [profilePhoto, setProfilePhoto] = React.useState<string | null>(null);
  const [profileContact, setProfileContact] = React.useState<{
    email: string;
    phone: string;
    location: string;
  }>({ email: "", phone: "", location: "" });

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

  React.useLayoutEffect(() => {
    const empId =
      localStorage.getItem("employeeId") || localStorage.getItem("loginId") || "";
    setEmployeeId(empId);
    setEmployeeName(localStorage.getItem("employeeName") || "Employee");
    if (empId) setTicketSeenMap(loadTicketSeenMap(empId));
  }, []);

  React.useEffect(() => {
    const tick = () => {
      setLiveClock(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: SERVER_TIMEZONE,
        })
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/employee_contacts?employeeId=${encodeURIComponent(employeeId)}`, {
        cache: "no-store",
      }).then((r) => r.json()),
      fetchShellBranding().catch(() => null),
    ]).then(([contactData, branding]) => {
      if (cancelled) return;
      const c = contactData?.success ? contactData.contact : null;
      const city = [c?.city, c?.country].filter(Boolean).join(", ");
      setProfileContact({
        email: c?.email_work || c?.email_other || "",
        phone: c?.phone_mobile || c?.phone_work || c?.phone_home || "",
        location: city || "—",
      });
      if (branding?.employeeAvatars?.[employeeId]) {
        setProfilePhoto(branding.employeeAvatars[employeeId]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

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

  const monthAttendanceStats = React.useMemo(() => {
    let present = 0;
    let absent = 0;
    let halfDays = 0;
    const y = todayParts.year;
    const m = todayParts.month;
    for (let d = 1; d <= todayParts.day; d++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const wd = weekdayIndexKarachi(key);
      if (wd === 0 || wd === 6) continue;
      const row = attendanceByDate.get(key);
      if (!row?.clock_in) {
        if (key < todayKey) absent++;
        continue;
      }
      const h = workHours(row);
      if (h > 0 && h < 4) halfDays++;
      else present++;
    }
    const total = present + absent + halfDays;
    const pct = total > 0 ? Math.round((present / total) * 100) : 0;
    return { present, absent, halfDays, pct };
  }, [attendanceByDate, todayParts.year, todayParts.month, todayParts.day, todayKey, liveTick]);

  const clockedInLabel = React.useMemo(() => {
    if (!todayRecord?.clock_in) return "Not clocked in yet";
    const parts = getParts(todayRecord.clock_in, SERVER_TIMEZONE);
    if (!parts) return "Clocked in";
    const h12 = parts.hour % 12 || 12;
    const ampm = parts.hour >= 12 ? "PM" : "AM";
    return `Clocked In: ${String(h12).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} ${ampm}`;
  }, [todayRecord]);

  const profileInitials = (employeeName || "E")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

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
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void fetchEvents(eventsCal.year);
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(load, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(load, 100);
    }
    return () => {
      if (idleId !== undefined && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [eventsCal.year, fetchEvents]);

  return (
    <DashboardHomeView
      employeeId={employeeId}
      employeeName={employeeName}
      profilePhoto={profilePhoto}
      onAvatarUpdated={(url) => setProfilePhoto(url)}
      profileContact={profileContact}
      liveClock={liveClock}
      clockedInLabel={clockedInLabel}
      monthAttendanceStats={monthAttendanceStats}
      leaveBalance={leaveBalance}
      eventsCal={eventsCal}
      eventsMonthOffset={eventsMonthOffset}
      todayDay={todayParts.day}
      setEventsMonthOffset={setEventsMonthOffset}
      ticketWidgetItems={ticketWidgetItems}
      ticketSeenMap={ticketSeenMap}
      newReplyCount={newReplyCount}
      openTicketPage={openTicketPage}
      onNavigate={(path) => router.push(path)}
    />
  );
}