"use client";
import React from "react";
import { useRouter } from "next/navigation";
import LayoutDashboard from "../layout-dashboard";
import styles from "./dashboard.module.css";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { employeeInitials } from "../../lib/employee-photo-shared";
import {
  FaUsers,
  FaUserCheck,
  FaBriefcase,
  FaChartLine,
  FaUserPlus,
  FaCalendarAlt,
  FaBirthdayCake,
  FaBell,
  FaClipboardList,
  FaBolt,
  FaSun,
  FaHourglassHalf,
  FaGift,
  FaDollarSign,
  FaTicketAlt,
} from "react-icons/fa";

import { categoryLabel, ticketTypeLabel, type TicketCategory } from "../../lib/ticket-catalog";

type Ticket = {
  id: number;
  ticket_number: string;
  employee_name: string;
  category: TicketCategory;
  ticket_type: string;
  subject: string | null;
  status: string;
  requested_at: string;
  form_data?: Record<string, unknown> | null;
};

const quickLinks = [
  { label: "Add Employee", action: "/add-employee", icon: <FaUserPlus /> },
  { label: "Leave Requests", action: "/admin/tickets", icon: <FaCalendarAlt /> },
  { label: "Ticket Inbox", action: "/admin/tickets", icon: <FaTicketAlt /> },
  { label: "Recruitment", action: "/recruitment", icon: <FaBriefcase /> },
];

type Leave = {
  id: number;
  employee_name: string;
  leave_category: string;
  status: string;
  start_date: string;
  end_date: string;
  requested_at?: string;
};

type FinancialRequest = {
  id: number;
  employee_id: string;
  employee_name: string;
  request_type: "advance" | "loan";
  amount: number;
  status: string;
  requested_at: string;
  photo?: string | null;
  initials?: string;
};

type DayChart = {
  label: string;
  pct: number;
  isToday: boolean;
};

function last5Weekdays(): Date[] {
  const out: Date[] = [];
  const d = new Date();
  while (out.length < 5) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.unshift(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

function dayLabel(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatToday() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function AnimatedValue({ value }: { value: string }) {
  const numeric = parseInt(value.replace(/[^\d]/g, ""), 10) || 0;
  const suffix = value.includes("%") ? "%" : "";
  const [n, setN] = React.useState(0);

  React.useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 700;
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * numeric));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [numeric]);

  return (
    <>
      {n}
      {suffix}
    </>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 280;
  const h = 36;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <svg className={styles.sparkline} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#611f69" />
          <stop offset="100%" stopColor="#611f69" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon className={styles.sparklineArea} points={area} />
      <polyline
        points={line}
        className={styles.sparklineLine}
        fill="none"
        stroke="#611f69"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [leaves, setLeaves] = React.useState<Leave[]>([]);
  const [financialRequests, setFinancialRequests] = React.useState<FinancialRequest[]>([]);
  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = React.useState(false);
  const [ticketPulseIds, setTicketPulseIds] = React.useState<number[]>([]);
  const [loadingLeaves, setLoadingLeaves] = React.useState(false);
  const [loadingFinancial, setLoadingFinancial] = React.useState(false);
  const [pulseIds, setPulseIds] = React.useState<number[]>([]);
  const [finPulseIds, setFinPulseIds] = React.useState<number[]>([]);
  const [stats, setStats] = React.useState([
    { label: "Employees", value: "0", badge: "Team size" },
    { label: "Attendance", value: "0%", badge: "Today" },
    { label: "Open Roles", value: "3", badge: "Hiring" },
    { label: "On Leave", value: "0", badge: "Today" },
  ]);
  const [weeklyAttendance, setWeeklyAttendance] = React.useState("0%");
  const [weekChart, setWeekChart] = React.useState<DayChart[]>([
    { label: "Mon", pct: 0, isToday: false },
    { label: "Tue", pct: 0, isToday: false },
    { label: "Wed", pct: 0, isToday: false },
    { label: "Thu", pct: 0, isToday: false },
    { label: "Fri", pct: 0, isToday: false },
  ]);
  const [employeeSnapshot, setEmployeeSnapshot] = React.useState({
    active: 0,
    onLeave: 0,
    probation: 0,
  });
  const [announcements, setAnnouncements] = React.useState<any[]>([]);
  const [reminders, setReminders] = React.useState<any[]>([]);
  const [birthdays, setBirthdays] = React.useState<string[]>([]);
  const [pendingAppraisals, setPendingAppraisals] = React.useState<
    Array<{ employee_id: number; employee_name: string; cycle_label: string; due_date: string; has_open_assignment: boolean }>
  >([]);
  const [loadingAppraisals, setLoadingAppraisals] = React.useState(false);
  const leavesRef = React.useRef<Leave[]>([]);
  const finRef = React.useRef<FinancialRequest[]>([]);
  const ticketsRef = React.useRef<Ticket[]>([]);
  const timerRef = React.useRef<number | null>(null);
  const finTimerRef = React.useRef<number | null>(null);
  const ticketTimerRef = React.useRef<number | null>(null);

  const pendingLeaves = React.useMemo(
    () => leaves.filter((l) => (l.status || "").toLowerCase() === "pending"),
    [leaves],
  );

  const pendingLeaveTickets = React.useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.ticket_type === "leave" && (t.status || "").toLowerCase() === "pending"
      ),
    [tickets],
  );

  const leaveInboxCount = pendingLeaveTickets.length + pendingLeaves.length;

  const pendingFinancial = React.useMemo(
    () => financialRequests.filter((r) => (r.status || "").toLowerCase() === "pending"),
    [financialRequests],
  );

  const pendingTickets = React.useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.ticket_type !== "leave" && (t.status || "").toLowerCase() === "pending"
      ),
    [tickets],
  );
  const snapshotTotal = Math.max(
    employeeSnapshot.active + employeeSnapshot.onLeave + employeeSnapshot.probation,
    1,
  );
  const todayPct = parseInt(stats[1].value, 10) || 0;
  const chartValues = weekChart.map((d) => d.pct);

  const formatDate = React.useCallback((value: string) => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
  }, []);

  const fetchPendingAppraisals = React.useCallback(async () => {
    try {
      setLoadingAppraisals(true);
      const res = await fetch("/api/appraisals/pending", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        setPendingAppraisals(Array.isArray(data.pending) ? data.pending : []);
      }
    } catch (err) {
      console.error("appraisals fetch", err);
    } finally {
      setLoadingAppraisals(false);
    }
  }, []);

  const fetchLeaves = React.useCallback(async () => {
    try {
      setLoadingLeaves(true);
      const res = await fetch("/api/leaves", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        const next: Leave[] = data.leaves || [];
        const prevIds = new Set(leavesRef.current.map((l) => l.id));
        const newOnes = next.filter((l) => !prevIds.has(l.id)).map((l) => l.id);
        setLeaves(next);
        leavesRef.current = next;
        if (newOnes.length) {
          setPulseIds(newOnes);
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setPulseIds([]), 3500);
        }
      }
    } catch (err) {
      console.error("leaves fetch", err);
    } finally {
      setLoadingLeaves(false);
    }
  }, []);

  const fetchFinancialRequests = React.useCallback(async () => {
    try {
      setLoadingFinancial(true);
      const res = await fetch("/api/financial-requests?status=pending", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        const next: FinancialRequest[] = data.requests || [];
        const prevIds = new Set(finRef.current.map((r) => r.id));
        const newOnes = next.filter((r) => !prevIds.has(r.id)).map((r) => r.id);
        setFinancialRequests(next);
        finRef.current = next;
        if (newOnes.length) {
          setFinPulseIds(newOnes);
          if (finTimerRef.current) window.clearTimeout(finTimerRef.current);
          finTimerRef.current = window.setTimeout(() => setFinPulseIds([]), 3500);
        }
      }
    } catch (err) {
      console.error("financial requests fetch", err);
    } finally {
      setLoadingFinancial(false);
    }
  }, []);

  const fetchTickets = React.useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoadingTickets(true);
      const res = await fetch("/api/employee-tickets?status=pending&limit=20", {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.success) {
        const next: Ticket[] = data.tickets || [];
        const prevIds = new Set(ticketsRef.current.map((t) => t.id));
        const newOnes = next.filter((t) => !prevIds.has(t.id)).map((t) => t.id);
        setTickets(next);
        ticketsRef.current = next;
        if (newOnes.length) {
          setTicketPulseIds(newOnes);
          if (ticketTimerRef.current) window.clearTimeout(ticketTimerRef.current);
          ticketTimerRef.current = window.setTimeout(() => setTicketPulseIds([]), 3500);
        }
      }
    } catch (err) {
      console.error("tickets fetch", err);
    } finally {
      if (!opts?.silent) setLoadingTickets(false);
    }
  }, []);

  const fetchEmployeeCount = React.useCallback(async () => {
    try {
      const res = await fetch("/api/employee-list", { cache: "no-store" });
      const data = await res.json();
      if (data?.success && data.employees) {
        const employeeCount = data.employees.filter((emp: any) => {
          const status = String(emp?.status || "").toLowerCase();
          return status === "active" || status === "enabled";
        }).length;
        setStats((prev) => [
          { label: "Employees", value: employeeCount.toString(), badge: "Team size" },
          prev[1],
          prev[2],
          prev[3],
        ]);
      }
    } catch (err) {
      console.error("employee count fetch", err);
    }
  }, []);

  const fetchTodayAttendance = React.useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = await empRes.json();
      const totalEmployees =
        empData.success && empData.employees ? empData.employees.length : 0;

      if (totalEmployees === 0) {
        setStats((prev) => [
          prev[0],
          { label: "Attendance", value: "0%", badge: "Today" },
          prev[2],
          prev[3],
        ]);
        return;
      }

      const attRes = await fetch(`/api/attendance?date=${today}`, { cache: "no-store" });
      const attData = await attRes.json();
      const todayClockIns =
        attData.success && attData.attendance
          ? attData.attendance.filter((a: any) => a.clock_in).length
          : 0;

      const attendancePercentage = Math.round((todayClockIns / totalEmployees) * 100);

      setStats((prev) => [
        prev[0],
        { label: "Attendance", value: `${attendancePercentage}%`, badge: "Today" },
        prev[2],
        prev[3],
      ]);
    } catch (err) {
      console.error("today attendance fetch", err);
    }
  }, []);

  const fetchWeekChart = React.useCallback(async () => {
    try {
      const weekdays = last5Weekdays();
      const todayStr = new Date().toISOString().split("T")[0];
      const fromDate = weekdays[0].toISOString().split("T")[0];
      const toDate = weekdays[weekdays.length - 1].toISOString().split("T")[0];

      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = await empRes.json();
      const totalEmployees =
        empData.success && empData.employees ? empData.employees.length : 0;

      if (totalEmployees === 0) {
        setWeekChart(
          weekdays.map((d) => ({
            label: dayLabel(d),
            pct: 0,
            isToday: d.toISOString().split("T")[0] === todayStr,
          })),
        );
        return;
      }

      const attRes = await fetch(
        `/api/attendance?fromDate=${fromDate}&toDate=${toDate}`,
        { cache: "no-store" },
      );
      const attData = await attRes.json();
      const records =
        attData.success && attData.attendance ? attData.attendance : [];

      const chart = weekdays.map((d) => {
        const dateStr = d.toISOString().split("T")[0];
        const unique = new Set(
          records
            .filter((a: any) => {
              const ad = (a.date || a.attendance_date || "").toString().slice(0, 10);
              return ad === dateStr && a.clock_in;
            })
            .map((a: any) => a.employee_id),
        ).size;
        return {
          label: dayLabel(d),
          pct: Math.round((unique / totalEmployees) * 100),
          isToday: dateStr === todayStr,
        };
      });

      setWeekChart(chart);
    } catch (err) {
      console.error("week chart fetch", err);
    }
  }, []);

  const fetchWeeklyAttendance = React.useCallback(async () => {
    try {
      const today = new Date();
      const dayOfWeek = today.getDay();
      let lastFriday = new Date(today);
      if (dayOfWeek === 0) lastFriday.setDate(today.getDate() - 2);
      else if (dayOfWeek === 1) lastFriday.setDate(today.getDate() - 3);
      else lastFriday.setDate(today.getDate() - (dayOfWeek - 5));

      const lastMonday = new Date(lastFriday);
      lastMonday.setDate(lastFriday.getDate() - 4);

      const fromDate = lastMonday.toISOString().split("T")[0];
      const toDate = lastFriday.toISOString().split("T")[0];

      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = await empRes.json();
      const totalEmployees =
        empData.success && empData.employees ? empData.employees.length : 0;

      if (totalEmployees === 0) {
        setWeeklyAttendance("0%");
        return;
      }

      const attRes = await fetch(
        `/api/attendance?fromDate=${fromDate}&toDate=${toDate}`,
        { cache: "no-store" },
      );
      const attData = await attRes.json();
      const weeklyRecords =
        attData.success && attData.attendance ? attData.attendance : [];

      const uniqueEmployees = new Set(
        weeklyRecords.filter((a: any) => a.clock_in).map((a: any) => a.employee_id),
      ).size;

      const weeklyPercentage = Math.round((uniqueEmployees / totalEmployees) * 100);
      setWeeklyAttendance(`${weeklyPercentage}%`);
    } catch (err) {
      console.error("weekly attendance fetch", err);
    }
  }, []);

  const fetchEmployeeSnapshot = React.useCallback(async () => {
    try {
      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = await empRes.json();

      if (!empData.success || !empData.employees) {
        setEmployeeSnapshot({ active: 0, onLeave: 0, probation: 0 });
        return;
      }

      const employees = empData.employees;
      const todayStr = new Date().toISOString().split("T")[0];

      const leaveRes = await fetch("/api/leaves", { cache: "no-store" });
      const leaveData = await leaveRes.json();
      const leavesList =
        leaveData.success && leaveData.leaves ? leaveData.leaves : [];

      const employeesOnLeaveToday = new Set(
        leavesList
          .filter((l: any) => {
            const startDate = l.start_date
              ? new Date(l.start_date).toISOString().split("T")[0]
              : "";
            const endDate = l.end_date
              ? new Date(l.end_date).toISOString().split("T")[0]
              : "";
            const status = (l.status || "").toLowerCase();
            return (
              status === "approved" && startDate <= todayStr && todayStr <= endDate
            );
          })
          .map((l: any) => l.employee_id),
      );

      let activeCount = 0;
      let probationCount = 0;

      employees.forEach((emp: any) => {
        const status = (emp.status || "").toLowerCase();
        const empStatus = (emp.employment_status || "").toLowerCase();
        if (empStatus === "probation") probationCount++;
        else if (status === "active" || status === "enabled") activeCount++;
      });

      const onLeaveCount = employeesOnLeaveToday.size;
      const finalActiveCount = Math.max(0, activeCount - onLeaveCount);

      setEmployeeSnapshot({
        active: finalActiveCount,
        onLeave: onLeaveCount,
        probation: probationCount,
      });

      setStats((prev) => [
        prev[0],
        prev[1],
        prev[2],
        { label: "On Leave", value: onLeaveCount.toString(), badge: "Today" },
      ]);
    } catch (err) {
      console.error("employee snapshot fetch", err);
    }
  }, []);

  const fetchAnnouncementsAndReminders = React.useCallback(async () => {
    try {
      const eventsRes = await fetch("/api/events", { cache: "no-store" });
      const eventsData = await eventsRes.json();
      setAnnouncements(
        eventsData.success && eventsData.events ? eventsData.events : [],
      );

      const remindersRes = await fetch("/api/reminders", { cache: "no-store" });
      const remindersData = await remindersRes.json();
      setReminders(
        remindersData.success && remindersData.reminders
          ? remindersData.reminders
          : [],
      );
    } catch (err) {
      console.error("announcements and reminders fetch", err);
    }
  }, []);

  const fetchUpcomingBirthdays = React.useCallback(async () => {
    try {
      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = await empRes.json();

      if (!empData.success || !empData.employees) {
        setBirthdays([]);
        return;
      }

      const employees = empData.employees;
      const today = new Date();
      const upcomingBdayList: { name: string; date: Date }[] = [];

      employees.forEach((emp: any) => {
        if (!emp.dob) return;
        const dobDate = new Date(emp.dob);
        if (isNaN(dobDate.getTime())) return;

        const bdayMonth = dobDate.getMonth();
        const bdayDate = dobDate.getDate();
        let bdayThisYear = new Date(today.getFullYear(), bdayMonth, bdayDate);
        if (bdayThisYear < today) {
          bdayThisYear = new Date(today.getFullYear() + 1, bdayMonth, bdayDate);
        }
        const daysUntil = Math.ceil(
          (bdayThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntil >= 0 && daysUntil <= 30) {
          upcomingBdayList.push({
            name:
              emp.first_name && emp.last_name
                ? `${emp.first_name} ${emp.last_name}`
                : emp.first_name || emp.pseudonym || "Employee",
            date: bdayThisYear,
          });
        }
      });

      upcomingBdayList.sort((a, b) => a.date.getTime() - b.date.getTime());
      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      setBirthdays(
        upcomingBdayList.map(
          (b) =>
            `${b.name} — ${monthNames[b.date.getMonth()]} ${b.date.getDate()}`,
        ),
      );
    } catch (err) {
      console.error("upcoming birthdays fetch", err);
    }
  }, []);

  React.useEffect(() => {
    fetchLeaves();
    fetchFinancialRequests();
    fetchTickets();
    fetchPendingAppraisals();
    fetchEmployeeCount();
    fetchTodayAttendance();
    fetchWeeklyAttendance();
    fetchWeekChart();
    fetchEmployeeSnapshot();
    fetchAnnouncementsAndReminders();
    fetchUpcomingBirthdays();

    const dataInterval = setInterval(() => {
      fetchTodayAttendance();
      fetchWeeklyAttendance();
      fetchWeekChart();
      fetchEmployeeSnapshot();
      fetchAnnouncementsAndReminders();
      fetchUpcomingBirthdays();
    }, 30000);

    if (typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data.toString());
        if (msg?.type === "leave_update") {
          fetchLeaves();
          fetchEmployeeSnapshot();
        }
        if (msg?.type === "financial_request_update") {
          fetchFinancialRequests();
        }
        if (msg?.type === "ticket_update" || msg?.type === "ticket_created") {
          void fetchTickets({ silent: true });
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      clearInterval(dataInterval);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (finTimerRef.current) window.clearTimeout(finTimerRef.current);
      if (ticketTimerRef.current) window.clearTimeout(ticketTimerRef.current);
    };
  }, [
    fetchLeaves,
    fetchFinancialRequests,
    fetchTickets,
    fetchEmployeeCount,
    fetchTodayAttendance,
    fetchWeeklyAttendance,
    fetchWeekChart,
    fetchEmployeeSnapshot,
    fetchAnnouncementsAndReminders,
    fetchUpcomingBirthdays,
  ]);

  return (
    <LayoutDashboard>
      <div className={styles.page}>
        <div className={styles.headerBanner}>
          <div className={styles.dateChip}>
            <span className={styles.dateChipDot} />
            {formatToday()} · Live sync
          </div>
          <header className={styles.header}>
            <div className={styles.headerText}>
              <p className={styles.greeting}>{timeGreeting()}</p>
              <h1 className={styles.title}>Welcome back, Admin</h1>
              <p className={styles.subtitle}>
                Hiring, attendance, and engagement — all in one clean workspace.
              </p>
            </div>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => router.push("/add-employee")}
              >
                <FaUserPlus /> Add employee
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => router.push("/admin/events")}
              >
                <FaCalendarAlt /> View events
              </button>
            </div>
          </header>
        </div>

        <div className={styles.insightRow}>
          <div className={styles.insightChip}>
            <span className={styles.insightIcon}>
              <FaSun />
            </span>
            <span>
              <strong>{todayPct}%</strong> of team checked in today
            </span>
          </div>
          <div className={styles.insightChip}>
            <span className={styles.insightIcon}>
              <FaHourglassHalf />
            </span>
            <span>
              <strong>{leaveInboxCount}</strong> leave request
              {leaveInboxCount === 1 ? "" : "s"} pending review
            </span>
          </div>
          <div className={styles.insightChip}>
            <span className={styles.insightIcon}>
              <FaTicketAlt />
            </span>
            <span>
              <strong>{pendingTickets.length}</strong> support ticket
              {pendingTickets.length === 1 ? "" : "s"} pending
            </span>
          </div>
          <div className={styles.insightChip}>
            <span className={styles.insightIcon}>
              <FaDollarSign />
            </span>
            <span>
              <strong>{pendingFinancial.length}</strong> payroll request
              {pendingFinancial.length === 1 ? "" : "s"} pending
            </span>
          </div>
          <div className={styles.insightChip}>
            <span className={styles.insightIcon}>
              <FaClipboardList />
            </span>
            <span>
              <strong>{pendingAppraisals.length}</strong> appraisal
              {pendingAppraisals.length === 1 ? "" : "s"} due
            </span>
          </div>
          <div className={styles.insightChip}>
            <span className={styles.insightIcon}>
              <FaGift />
            </span>
            <span>
              <strong>{birthdays.length}</strong> birthday
              {birthdays.length === 1 ? "" : "s"} in the next 30 days
            </span>
          </div>
        </div>

        <div className={styles.kpiRow}>
          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIcon} ${styles.kpiIconPurple}`}>
              <FaUsers />
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValue}>
                <AnimatedValue value={stats[0].value} />
              </div>
              <div className={styles.kpiLabel}>{stats[0].label}</div>
              <span className={styles.kpiBadge}>{stats[0].badge}</span>
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIcon} ${styles.kpiIconBlue}`}>
              <FaUserCheck />
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValue}>
                <AnimatedValue value={stats[1].value} />
              </div>
              <div className={styles.kpiLabel}>{stats[1].label}</div>
              <span className={styles.kpiBadge}>{stats[1].badge}</span>
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIcon} ${styles.kpiIconGold}`}>
              <FaBriefcase />
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValue}>
                <AnimatedValue value={stats[2].value} />
              </div>
              <div className={styles.kpiLabel}>{stats[2].label}</div>
              <span className={styles.kpiBadge}>{stats[2].badge}</span>
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIcon} ${styles.kpiIconGreen}`}>
              <FaChartLine />
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValue}>
                <AnimatedValue value={weeklyAttendance} />
              </div>
              <div className={styles.kpiLabel}>Weekly avg</div>
              <span className={styles.kpiBadge}>Past week</span>
            </div>
          </div>
        </div>

        <div className={styles.mainGrid}>
          <div className={styles.col}>
            <section className={`${styles.card} ${styles.cardDelay1}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaChartLine />
                  </span>
                  <h2 className={styles.cardTitle}>Attendance trend</h2>
                </div>
                <span className={`${styles.pill} ${styles.pillLive}`}>Live</span>
              </div>
              <div className={styles.chartRow}>
                <div className={styles.chartMain}>
                  <div className={styles.chartWrap}>
                    <div className={styles.chartBars}>
                      <div className={styles.chartGrid} aria-hidden>
                        <div className={styles.chartGridLine} />
                        <div className={styles.chartGridLine} />
                        <div className={styles.chartGridLine} />
                        <div className={styles.chartGridLine} />
                      </div>
                      {weekChart.map((day, i) => (
                        <div
                          key={day.label}
                          className={styles.chartCol}
                          title={`${day.label}: ${day.pct}% attendance`}
                          style={{ animationDelay: `${i * 0.06}s` }}
                        >
                          <span className={styles.chartPct}>{day.pct}%</span>
                          <div className={styles.chartBarTrack}>
                            <div
                              className={`${styles.chartBar} ${day.isToday ? styles.chartBarToday : ""}`}
                              style={{
                                height: `${Math.max(day.pct, 4)}%`,
                                animationDelay: `${0.1 + i * 0.08}s`,
                              }}
                            />
                          </div>
                          <span className={styles.chartLabel}>{day.label}</span>
                        </div>
                      ))}
                    </div>
                    <Sparkline data={chartValues} />
                    <div className={styles.chartLegend}>
                      <span>
                        <span
                          className={styles.legendDot}
                          style={{ background: "var(--slack-purple)" }}
                        />
                        Weekdays
                      </span>
                      <span>
                        <span
                          className={styles.legendDot}
                          style={{ background: "var(--slack-blue)" }}
                        />
                        Today
                      </span>
                      <span>Peak: {Math.max(...chartValues, 0)}%</span>
                    </div>
                  </div>
                </div>
                <div className={styles.donutPanel}>
                  <div
                    className={styles.donut}
                    style={{
                      background: `conic-gradient(var(--slack-blue) 0% ${todayPct}%, #eef0f2 ${todayPct}% 100%)`,
                    }}
                  >
                    <div className={styles.donutHole}>
                      <span className={styles.donutValue}>
                        <AnimatedValue value={stats[1].value} />
                      </span>
                      <span className={styles.donutLabel}>Today</span>
                    </div>
                  </div>
                  <p className={styles.donutCaption}>Check-in rate across your team</p>
                </div>
              </div>
            </section>

            <section className={`${styles.card} ${styles.cardDelay2}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaUsers />
                  </span>
                  <h2 className={styles.cardTitle}>Employee snapshot</h2>
                </div>
                <span className={`${styles.pill} ${styles.pillLive}`}>Live</span>
              </div>
              <div className={styles.snapshotGrid}>
                <div className={styles.snapRing}>
                  <div className={styles.snapRingValue}>
                    <AnimatedValue value={String(employeeSnapshot.active)} />
                  </div>
                  <div className={styles.snapRingLabel}>Active</div>
                </div>
                <div className={styles.snapRing}>
                  <div className={styles.snapRingValue}>
                    <AnimatedValue value={String(employeeSnapshot.onLeave)} />
                  </div>
                  <div className={styles.snapRingLabel}>On leave</div>
                </div>
                <div className={styles.snapRing}>
                  <div className={styles.snapRingValue}>
                    <AnimatedValue value={String(employeeSnapshot.probation)} />
                  </div>
                  <div className={styles.snapRingLabel}>Probation</div>
                </div>
              </div>
              <div className={styles.snapshotBars}>
                <div className={styles.snapRow}>
                  <div className={styles.snapMeta}>
                    <span className={styles.snapLabel}>Active</span>
                    <span className={styles.snapValue}>{employeeSnapshot.active}</span>
                  </div>
                  <div className={styles.snapTrack}>
                    <div
                      className={`${styles.snapFill} ${styles.snapFillPurple}`}
                      style={{
                        width: `${(employeeSnapshot.active / snapshotTotal) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className={styles.snapRow}>
                  <div className={styles.snapMeta}>
                    <span className={styles.snapLabel}>On leave</span>
                    <span className={styles.snapValue}>{employeeSnapshot.onLeave}</span>
                  </div>
                  <div className={styles.snapTrack}>
                    <div
                      className={`${styles.snapFill} ${styles.snapFillBlue}`}
                      style={{
                        width: `${(employeeSnapshot.onLeave / snapshotTotal) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className={styles.snapRow}>
                  <div className={styles.snapMeta}>
                    <span className={styles.snapLabel}>Probation</span>
                    <span className={styles.snapValue}>{employeeSnapshot.probation}</span>
                  </div>
                  <div className={styles.snapTrack}>
                    <div
                      className={`${styles.snapFill} ${styles.snapFillGold}`}
                      style={{
                        width: `${(employeeSnapshot.probation / snapshotTotal) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className={`${styles.card} ${styles.cardDelay3}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaClipboardList />
                  </span>
                  <h2 className={styles.cardTitle}>Pending appraisals</h2>
                </div>
                <span className={`${styles.pill} ${styles.pillLive}`}>
                  {loadingAppraisals ? "…" : `${pendingAppraisals.length} due`}
                </span>
              </div>
              <ul className={`${styles.list} ${styles.listScrollable}`}>
                {pendingAppraisals.length === 0 && (
                  <li
                    className={styles.listItem}
                    onClick={() => router.push("/admin/pending-appraisals")}
                  >
                    <div className={styles.listItemTitle}>No appraisals due</div>
                    <div className={styles.listItemMeta}>Open pending appraisals</div>
                  </li>
                )}
                {pendingAppraisals.slice(0, 5).map((row) => (
                  <li
                    key={`${row.employee_id}-${row.cycle_label}`}
                    className={styles.listItem}
                    onClick={() => router.push("/admin/pending-appraisals")}
                  >
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{row.employee_name}</span>
                      <span className={styles.badge}>
                        {row.has_open_assignment ? "Issued" : "Due"}
                      </span>
                    </div>
                    <div className={styles.listItemMeta}>
                      {row.cycle_label} · due {row.due_date}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className={`${styles.card} ${styles.cardDelay3}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaClipboardList />
                  </span>
                  <h2 className={styles.cardTitle}>Leave requests</h2>
                </div>
                <span className={`${styles.pill} ${styles.pillLive}`}>
                  {loadingTickets || loadingLeaves ? "…" : `${leaveInboxCount} pending`}
                </span>
              </div>
              <ul className={`${styles.list} ${styles.listScrollable}`}>
                {leaveInboxCount === 0 && (
                  <li
                    className={styles.listItem}
                    onClick={() => router.push("/admin/tickets")}
                  >
                    <div className={styles.listItemTitle}>No pending requests</div>
                    <div className={styles.listItemMeta}>Open leave ticket inbox</div>
                  </li>
                )}
                {pendingLeaveTickets.slice(0, 5).map((ticket) => {
                  const fd = ticket.form_data || {};
                  const leaveCategory = String(fd.leave_category || "leave");
                  const startDate = String(fd.start_date || "");
                  const endDate = String(fd.end_date || "");
                  return (
                    <li
                      key={`ticket-leave-${ticket.id}`}
                      className={`${styles.listItem} ${ticketPulseIds.includes(ticket.id) ? styles.listItemNew : ""}`}
                      onClick={() => router.push("/admin/tickets")}
                    >
                      <div className={styles.listItemTop}>
                        <span className={styles.listItemTitle}>
                          {ticket.ticket_number}
                        </span>
                        <span className={styles.badge}>Pending</span>
                      </div>
                      <div className={styles.listItemMeta}>
                        {ticket.employee_name} · {leaveCategory}
                      </div>
                      <div className={styles.listItemMeta} style={{ marginTop: 4 }}>
                        {startDate
                          ? `${formatDate(startDate)}${endDate ? ` → ${formatDate(endDate)}` : ""}`
                          : ticket.subject || "Leave request"}
                      </div>
                    </li>
                  );
                })}
                {pendingLeaves
                  .slice(0, Math.max(0, 5 - pendingLeaveTickets.length))
                  .map((leave) => (
                    <li
                      key={`legacy-leave-${leave.id}`}
                      className={`${styles.listItem} ${pulseIds.includes(leave.id) ? styles.listItemNew : ""}`}
                      onClick={() => router.push("/leave")}
                    >
                      <div className={styles.listItemTop}>
                        <span className={styles.listItemTitle}>
                          {leave.employee_name || "Employee"}
                        </span>
                        <span className={styles.badge}>Pending</span>
                      </div>
                      <div className={styles.listItemMeta}>
                        {leave.leave_category} · {formatDate(leave.start_date)} →{" "}
                        {formatDate(leave.end_date)}
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          </div>

          <div className={styles.col}>
            <section className={`${styles.card} ${styles.cardDelay1}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaBolt />
                  </span>
                  <h2 className={styles.cardTitle}>Quick actions</h2>
                </div>
              </div>
              <div className={styles.quickGrid}>
                {quickLinks.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={styles.quickLink}
                    onClick={() => router.push(item.action)}
                  >
                    <span className={styles.quickLinkIcon}>{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className={`${styles.card} ${styles.cardDelay2}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaTicketAlt />
                  </span>
                  <h2 className={styles.cardTitle}>Support tickets</h2>
                </div>
                <span className={styles.pill}>
                  {loadingTickets ? "…" : `${pendingTickets.length} pending`}
                </span>
              </div>
              <ul className={`${styles.list} ${styles.listScrollable}`}>
                {pendingTickets.length === 0 && (
                  <li
                    className={styles.listItem}
                    onClick={() => router.push("/admin/tickets")}
                  >
                    <div className={styles.listItemTitle}>No pending tickets</div>
                    <div className={styles.listItemMeta}>Open ticket inbox</div>
                  </li>
                )}
                {pendingTickets.slice(0, 5).map((ticket) => (
                  <li
                    key={ticket.id}
                    className={`${styles.listItem} ${ticketPulseIds.includes(ticket.id) ? styles.listItemNew : ""}`}
                    onClick={() => router.push("/admin/tickets")}
                  >
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>
                        {ticket.ticket_number}
                      </span>
                      <span className={styles.badge}>Pending</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      {ticket.employee_name} · {ticket.subject}
                    </div>
                    <div className={styles.listItemMeta} style={{ marginTop: 4 }}>
                      {categoryLabel(ticket.category)} ·{" "}
                      {ticketTypeLabel(ticket.category, ticket.ticket_type)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className={`${styles.card} ${styles.cardDelay2}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaDollarSign />
                  </span>
                  <h2 className={styles.cardTitle}>Payroll requests</h2>
                </div>
                <span className={styles.pill}>
                  {loadingFinancial ? "…" : `${pendingFinancial.length} pending`}
                </span>
              </div>
              <ul className={`${styles.list} ${styles.listScrollable}`}>
                {pendingFinancial.length === 0 && (
                  <li
                    className={styles.listItem}
                    onClick={() => router.push("/admin/financial-requests")}
                  >
                    <div className={styles.listItemTitle}>No pending requests</div>
                    <div className={styles.listItemMeta}>Tap to open payroll inbox</div>
                  </li>
                )}
                {pendingFinancial.slice(0, 4).map((req) => (
                  <li
                    key={req.id}
                    className={`${styles.listItem} ${finPulseIds.includes(req.id) ? styles.listItemNew : ""}`}
                    onClick={() => router.push("/admin/financial-requests")}
                  >
                    <div className={styles.listItemTop}>
                      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <EmployeeAvatar
                          name={req.employee_name}
                          initials={req.initials || employeeInitials(req.employee_name)}
                          photo={req.photo}
                          size="sm"
                        />
                        <span className={styles.listItemTitle}>{req.employee_name}</span>
                      </span>
                      <span className={styles.badge}>Pending</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      {req.request_type === "advance" ? "Advance" : "Loan"} · PKR{" "}
                      {Number(req.amount).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className={`${styles.card} ${styles.cardDelay3}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaBirthdayCake />
                  </span>
                  <h2 className={styles.cardTitle}>Upcoming birthdays</h2>
                </div>
                <span className={`${styles.pill} ${styles.pillMuted}`}>30 days</span>
              </div>
              <ul className={`${styles.list} ${styles.listScrollable}`}>
                {birthdays.length === 0 ? (
                  <li className={styles.emptyState}>No birthdays in the next 30 days</li>
                ) : (
                  birthdays.map((item) => (
                    <li key={item} className={styles.listItem}>
                      <div className={styles.listItemTitle}>{item}</div>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className={`${styles.card} ${styles.cardDelay4}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <span className={styles.cardIcon}>
                    <FaBell />
                  </span>
                  <h2 className={styles.cardTitle}>Announcements</h2>
                </div>
                <span className={`${styles.pill} ${styles.pillLive}`}>Live</span>
              </div>
              <ul className={`${styles.list} ${styles.listScrollable}`}>
                {announcements.length === 0 && reminders.length === 0 && (
                  <li className={styles.emptyState}>No announcements or reminders</li>
                )}
                {reminders.map((reminder) => (
                  <li key={`reminder-${reminder.id}`} className={styles.listItem}>
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{reminder.message}</span>
                      <span className={`${styles.badge} ${styles.badgeReminder}`}>
                        Reminder
                      </span>
                    </div>
                  </li>
                ))}
                {announcements.map((announcement) => (
                  <li key={`announcement-${announcement.id}`} className={styles.listItem}>
                    <div className={styles.listItemTitle}>{announcement.title}</div>
                    {announcement.description && (
                      <div className={styles.listItemMeta}>{announcement.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </LayoutDashboard>
  );
}
