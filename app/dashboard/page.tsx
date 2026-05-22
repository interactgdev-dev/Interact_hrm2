"use client";
import React from "react";
import { useRouter } from "next/navigation";
import LayoutDashboard from "../layout-dashboard";
import styles from "./dashboard.module.css";

const quickLinks = [
  { label: "Add Employee", action: "/add-employee" },
  { label: "Leave Requests", action: "/leave" },
  { label: "Recruitment", action: "/recruitment" },
];

const recruitment = [
  "Software Engineer — 2 candidates",
  "HR Manager — 1 candidate",
  "Accountant — 1 candidate",
];

const announcements = [
  "New HR policies are live.",
  "Company townhall on Dec 22.",
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

export default function DashboardPage() {
  const router = useRouter();
  const [leaves, setLeaves] = React.useState<Leave[]>([]);
  const [loadingLeaves, setLoadingLeaves] = React.useState(false);
  const [pulseIds, setPulseIds] = React.useState<number[]>([]);
  const [stats, setStats] = React.useState([
    { label: "Employees", value: "0", badge: "+0 this week" },
    { label: "Attendance", value: "0%", badge: "Today" },
    { label: "Open Roles", value: "3", badge: "Hiring" },
  ]);
  const [weeklyAttendance, setWeeklyAttendance] = React.useState("0%");
  const [employeeSnapshot, setEmployeeSnapshot] = React.useState({
    active: 0,
    onLeave: 0,
    probation: 0
  });
  const [announcements, setAnnouncements] = React.useState<any[]>([]);
  const [reminders, setReminders] = React.useState<any[]>([]);
  const [birthdays, setBirthdays] = React.useState<string[]>([]);
  const leavesRef = React.useRef<Leave[]>([]);
  const timerRef = React.useRef<number | null>(null);

  const pendingLeaves = React.useMemo(() => leaves.filter((l) => (l.status || "").toLowerCase() === "pending"), [leaves]);

  const formatDate = React.useCallback((value: string) => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
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

  // Fetch employee count
  const fetchEmployeeCount = React.useCallback(async () => {
    try {
      const res = await fetch("/api/employee-list", { cache: "no-store" });
      const data = await res.json();
      if (data?.success && data.employees) {
        const employeeCount = data.employees.length;
        setStats(prev => [
          { label: "Employees", value: employeeCount.toString(), badge: "+0 this week" },
          prev[1],
          prev[2],
        ]);
      }
    } catch (err) {
      console.error("employee count fetch", err);
    }
  }, []);

  // Calculate today's attendance percentage
  const fetchTodayAttendance = React.useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get total employees
      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = await empRes.json();
      const totalEmployees = empData.success && empData.employees ? empData.employees.length : 0;
      
      if (totalEmployees === 0) {
        setStats(prev => [
          prev[0],
          { label: "Attendance", value: "0%", badge: "Today" },
          prev[2],
        ]);
        return;
      }
      
      // Get today's attendance (employees with clock_in today)
      const attRes = await fetch(`/api/attendance?date=${today}`, { cache: "no-store" });
      const attData = await attRes.json();
      const todayClockIns = attData.success && attData.attendance ? 
        attData.attendance.filter((a: any) => a.clock_in).length : 0;
      
      const attendancePercentage = Math.round((todayClockIns / totalEmployees) * 100);
      
      setStats(prev => [
        prev[0],
        { label: "Attendance", value: `${attendancePercentage}%`, badge: "Today" },
        prev[2],
      ]);
    } catch (err) {
      console.error("today attendance fetch", err);
    }
  }, []);

  // Calculate weekly attendance (Mon-Fri of last week, excluding Sat-Sun)
  const fetchWeeklyAttendance = React.useCallback(async () => {
    try {
      // Get last Monday to Friday (5 working days)
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
      
      // Calculate last Friday
      let lastFriday = new Date(today);
      if (dayOfWeek === 0) {
        // If today is Sunday, go back to Friday (2 days)
        lastFriday.setDate(today.getDate() - 2);
      } else if (dayOfWeek === 1) {
        // If today is Monday, go back to Friday of previous week (3 days)
        lastFriday.setDate(today.getDate() - 3);
      } else {
        // Otherwise, go back to Friday of current week
        lastFriday.setDate(today.getDate() - (dayOfWeek - 5));
      }
      
      // Calculate last Monday (5 days before Friday)
      const lastMonday = new Date(lastFriday);
      lastMonday.setDate(lastFriday.getDate() - 4);
      
      const fromDate = lastMonday.toISOString().split('T')[0];
      const toDate = lastFriday.toISOString().split('T')[0];
      
      // Get total employees
      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = empRes.json();
      const totalEmployees = (await empData).success && (await empData).employees ? 
        (await empData).employees.length : 0;
      
      if (totalEmployees === 0) {
        setWeeklyAttendance("0%");
        return;
      }
      
      // Get attendance for the week
      const attRes = await fetch(`/api/attendance?fromDate=${fromDate}&toDate=${toDate}`, { 
        cache: "no-store" 
      });
      const attData = await attRes.json();
      const weeklyRecords = attData.success && attData.attendance ? attData.attendance : [];
      
      // Count unique employees who clocked in during the week
      const uniqueEmployees = new Set(
        weeklyRecords.filter((a: any) => a.clock_in).map((a: any) => a.employee_id)
      ).size;
      
      // Calculate 5 working days average
      const weeklyPercentage = Math.round((uniqueEmployees / totalEmployees) * 100);
      setWeeklyAttendance(`${weeklyPercentage}%`);
    } catch (err) {
      console.error("weekly attendance fetch", err);
    }
  }, []);

  // Fetch employee snapshot (Active, On Leave, Probation)
  const fetchEmployeeSnapshot = React.useCallback(async () => {
    try {
      const empRes = await fetch("/api/employee-list", { cache: "no-store" });
      const empData = await empRes.json();
      
      if (!empData.success || !empData.employees) {
        setEmployeeSnapshot({ active: 0, onLeave: 0, probation: 0 });
        return;
      }

      const employees = empData.employees;
      
      // Get today's date
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      // Fetch leaves for today
      const leaveRes = await fetch("/api/leaves", { cache: "no-store" });
      const leaveData = await leaveRes.json();
      const leaves = leaveData.success && leaveData.leaves ? leaveData.leaves : [];
      
      // Find employees on leave today (start_date <= today <= end_date)
      const employeesOnLeaveToday = new Set(
        leaves
          .filter((l: any) => {
            const startDate = l.start_date ? new Date(l.start_date).toISOString().split('T')[0] : "";
            const endDate = l.end_date ? new Date(l.end_date).toISOString().split('T')[0] : "";
            const status = (l.status || "").toLowerCase();
            // Check if leave is approved and today falls within the date range
            return status === "approved" && 
                   startDate <= todayStr && todayStr <= endDate;
          })
          .map((l: any) => l.employee_id)
      );

      // Count employees by status
      let activeCount = 0;
      let probationCount = 0;

      employees.forEach((emp: any) => {
        const status = (emp.status || "").toLowerCase();
        const empStatus = (emp.employment_status || "").toLowerCase();
        
        if (empStatus === "probation") {
          probationCount++;
        } else if (status === "active" || status === "enabled") {
          activeCount++;
        }
      });

      // Active employees = total active - those on leave today
      const onLeaveCount = employeesOnLeaveToday.size;
      const finalActiveCount = Math.max(0, activeCount - onLeaveCount);

      setEmployeeSnapshot({
        active: finalActiveCount,
        onLeave: onLeaveCount,
        probation: probationCount
      });
    } catch (err) {
      console.error("employee snapshot fetch", err);
    }
  }, []);

  // Fetch announcements and reminders
  const fetchAnnouncementsAndReminders = React.useCallback(async () => {
    try {
      // Fetch events (announcements)
      const eventsRes = await fetch("/api/events", { cache: "no-store" });
      const eventsData = await eventsRes.json();
      const events = eventsData.success && eventsData.events ? eventsData.events : [];
      setAnnouncements(events);

      // Fetch reminders
      const remindersRes = await fetch("/api/reminders", { cache: "no-store" });
      const remindersData = await remindersRes.json();
      const remindersArray = remindersData.success && remindersData.reminders ? remindersData.reminders : [];
      setReminders(remindersArray);
    } catch (err) {
      console.error("announcements and reminders fetch", err);
    }
  }, []);

  // Fetch and calculate upcoming birthdays
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
      const todayMonth = today.getMonth();
      const todayDate = today.getDate();
      
      // Calculate birthdays for next 30 days
      const upcomingBdayList: { name: string; date: Date }[] = [];
      
      employees.forEach((emp: any) => {
        if (!emp.dob) return;
        
        const dobDate = new Date(emp.dob);
        if (isNaN(dobDate.getTime())) return; // Invalid date
        
        const bdayMonth = dobDate.getMonth();
        const bdayDate = dobDate.getDate();
        
        // Check if birthday is in next 30 days
        let daysUntilBirthday = 0;
        let bdayThisYear = new Date(today.getFullYear(), bdayMonth, bdayDate);
        
        if (bdayThisYear < today) {
          // Birthday already passed this year, check next year
          bdayThisYear = new Date(today.getFullYear() + 1, bdayMonth, bdayDate);
        }
        
        daysUntilBirthday = Math.ceil((bdayThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilBirthday >= 0 && daysUntilBirthday <= 30) {
          upcomingBdayList.push({
            name: emp.first_name && emp.last_name ? 
              `${emp.first_name} ${emp.last_name}` : 
              (emp.first_name || emp.pseudonym || "Employee"),
            date: bdayThisYear
          });
        }
      });
      
      // Sort by date
      upcomingBdayList.sort((a, b) => a.date.getTime() - b.date.getTime());
      
      // Format for display
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const formattedBirthdays = upcomingBdayList.map(bday => 
        `${bday.name} — ${monthNames[bday.date.getMonth()]} ${bday.date.getDate()}`
      );
      
      setBirthdays(formattedBirthdays);
    } catch (err) {
      console.error("upcoming birthdays fetch", err);
    }
  }, []);

  React.useEffect(() => {
    fetchLeaves();
    fetchEmployeeCount();
    fetchTodayAttendance();
    fetchWeeklyAttendance();
    fetchEmployeeSnapshot();
    fetchAnnouncementsAndReminders();
    fetchUpcomingBirthdays();
    
    // Refresh data every 30 seconds for real-time updates
    const dataInterval = setInterval(() => {
      fetchTodayAttendance();
      fetchWeeklyAttendance();
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
      } catch (_) {
        // ignore malformed
      }
    };
    return () => {
      ws.close();
      clearInterval(dataInterval);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [fetchLeaves, fetchEmployeeCount, fetchTodayAttendance, fetchWeeklyAttendance, fetchEmployeeSnapshot, fetchAnnouncementsAndReminders, fetchUpcomingBirthdays]);

  return (
    <LayoutDashboard>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <span className={styles.heroBadge}>Admin overview</span>
            <h1 className={styles.heroTitle}>Welcome back, Admin</h1>
            <p className={styles.heroSubtitle}>
              Keep an eye on hiring, attendance, and employee engagement in one place.
            </p>
            <div className={styles.heroActions}>
              <button className={styles.primaryButton} onClick={() => router.push("/add-employee")}>Add employee</button>
              <button className={styles.ghostButton} onClick={() => router.push("/admin/events")}>View events</button>
            </div>
          </div>
          <div className={styles.heroStats}>
            {stats.map((item) => (
              <div key={item.label} className={styles.heroStat}>
                <div className={styles.heroStatValue}>{item.value}</div>
                <div className={styles.heroStatLabel}>{item.label}</div>
                <span className={styles.heroStatBadge}>{item.badge}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Quick actions</h2>
            </div>
            <div className={styles.quickActions}>
              {quickLinks.map((item) => (
                <button key={item.label} className={styles.quickChip} onClick={() => router.push(item.action)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Employee snapshot</h2>
              <span className={styles.pill}>Live</span>
            </div>
            <div className={styles.metricsRow}>
              <div className={styles.metricBlock}>
                <div className={styles.metricValue}>{employeeSnapshot.active}</div>
                <div className={styles.metricLabel}>Active</div>
              </div>
              <div className={styles.metricBlock}>
                <div className={styles.metricValue}>{employeeSnapshot.onLeave}</div>
                <div className={styles.metricLabel}>On leave</div>
              </div>
              <div className={styles.metricBlock}>
                <div className={styles.metricValue}>{employeeSnapshot.probation}</div>
                <div className={styles.metricLabel}>Probation</div>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Recruitment</h2>
              <span className={styles.pill}>3 open</span>
            </div>
            <ul className={`${styles.list} ${styles.listScrollable}`} style={{ minHeight: 220 }}>
              {recruitment.map((item) => (
                <li key={item} className={styles.listItem}>{item}</li>
              ))}
            </ul>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Attendance</h2>
              <span className={styles.pill}>Live</span>
            </div>
            <div className={styles.metricsRow}>
              <div className={styles.metricBlock}>
                <div className={styles.metricValue}>{stats[1].value}</div>
                <div className={styles.metricLabel}>Today</div>
              </div>
              <div className={styles.metricBlock}>
                <div className={styles.metricValue}>{weeklyAttendance}</div>
                <div className={styles.metricLabel}>Past Week</div>
              </div>
              <div className={styles.metricBlock}>
                <div className={styles.metricValue}>09:02</div>
                <div className={styles.metricLabel}>Avg. check-in</div>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Leave requests</h2>
              <span className={styles.pill}>{loadingLeaves ? "Loading" : "Live"}</span>
            </div>
            <ul className={`${styles.list} ${styles.listScrollable}`} style={{ minHeight: 220 }}>
              {pendingLeaves.length === 0 && (
                <li className={styles.listItem} onClick={() => router.push("/leave")}>
                  <div className={styles.listItemTitle}>No new leave requests</div>
                  <div className={styles.listItemMeta}>Tap to view leave page</div>
                </li>
              )}
              {pendingLeaves.slice(0, 1).map((leave) => {
                const isNew = pulseIds.includes(leave.id);
                return (
                  <li
                    key={leave.id}
                    className={`${styles.listItem} ${isNew ? styles.listItemNew : ""}`}
                    onClick={() => router.push("/leave")}
                  >
                    <div className={styles.listItemTop}>
                      <span className={styles.listItemTitle}>{leave.employee_name || "Employee"}</span>
                      <span className={styles.badge}>Pending</span>
                    </div>
                    <div className={styles.listItemMeta}>
                      {leave.leave_category} • {formatDate(leave.start_date)} → {formatDate(leave.end_date)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Upcoming birthdays</h2>
              <span className={styles.pill}>Live</span>
            </div>
            <ul className={`${styles.list} ${styles.listScrollable}`} style={{ minHeight: 220 }}>
              {birthdays.length === 0 && (
                <li className={styles.listItem}>
                  <div className={styles.listItemTitle}>No upcoming birthdays in the next 30 days</div>
                </li>
              )}
              {birthdays.map((item) => (
                <li key={item} className={styles.listItem}>{item}</li>
              ))}
            </ul>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Announcements & Reminders</h2>
              <span className={styles.pill}>Live</span>
            </div>
            <ul className={`${styles.list} ${styles.listScrollable}`} style={{ minHeight: 220 }}>
              {announcements.length === 0 && reminders.length === 0 && (
                <li className={styles.listItem}>
                  <div className={styles.listItemTitle}>No announcements or reminders</div>
                </li>
              )}
              
              {reminders.length > 0 && (
                <>
                  {reminders.map((reminder) => (
                    <li key={`reminder-${reminder.id}`} className={styles.listItem}>
                      <div className={styles.listItemTitle} style={{ color: "#e74c3c", fontWeight: "600" }}>
                        🔔 {reminder.message}
                      </div>
                    </li>
                  ))}
                </>
              )}
              
              {announcements.length > 0 && (
                <>
                  {announcements.map((announcement) => (
                    <li key={`announcement-${announcement.id}`} className={styles.listItem}>
                      <div className={styles.listItemTitle}>{announcement.title}</div>
                      {announcement.description && (
                        <div className={styles.listItemMeta}>{announcement.description}</div>
                      )}
                    </li>
                  ))}
                </>
              )}
            </ul>
          </div>
        </section>
      </div>
    </LayoutDashboard>
  );
}
