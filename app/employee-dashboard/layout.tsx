"use client";
import React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FaTachometerAlt,
  FaUser,
  FaUsers,
  FaSearch,
  FaTicketAlt,
} from "react-icons/fa";
import styles from "../layout-dashboard.module.css";
import empStyles from "./emp-shell.module.css";
import { ClockBreakPrayerWidget } from "../components/ClockBreakPrayer";
import { TardyNoteWidget } from "../components/TardyNoteWidget";
import { fetchShellBranding } from "../shell-branding-api";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { EmployeeProfileMenu } from "./components/EmployeeProfileMenu";
import { InteractGlobeLogo } from "./components/InteractGlobeLogo";

function greetingLabel() {
  const h = new Date().getHours();
  if (h < 12) return "Welcome Back";
  if (h < 17) return "Welcome Back";
  return "Welcome Back";
}

function formatHeroDateTime() {
  const d = new Date();
  const date = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} | ${time}`;
}

/** Isolated so typing does not re-render ClockBreakPrayer / dashboard children. */
function HeroSearch() {
  const [searchQuery, setSearchQuery] = React.useState("");
  return (
    <label className={empStyles.heroSearch}>
      <FaSearch className={empStyles.heroSearchIcon} aria-hidden />
      <input
        type="search"
        className={empStyles.heroSearchInput}
        placeholder="Search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        aria-label="Search"
      />
    </label>
  );
}

const employeeTabs = [
  { name: "Employee Dashboard", path: "/employee-dashboard", icon: <FaTachometerAlt /> },
  { name: "My Team", path: "/employee-dashboard/my-team", icon: <FaUsers /> },
  { name: "My Info", path: "/employee-dashboard/my-info", icon: <FaUser /> },
  { name: "Generate Ticket", path: "/employee-dashboard/generate-ticket", icon: <FaTicketAlt /> },
];

/** Routes where the clock/break dock is visible. Widget stays mounted on all
 *  employee routes so Dashboard ↔ Team ↔ Info ↔ Time does not remount sync/timers. */
const CLOCK_WIDGET_VISIBLE_PATHS = new Set([
  "/employee-dashboard",
  "/employee-dashboard/time",
]);

export default function EmployeeDashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [employeeName, setEmployeeName] = React.useState<string>("");
  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [heroDateTime, setHeroDateTime] = React.useState(formatHeroDateTime);
  const showClockBar =
    pathname != null && CLOCK_WIDGET_VISIBLE_PATHS.has(pathname);
  const isDashboardHome = pathname === "/employee-dashboard";
  const isTimePage = pathname === "/employee-dashboard/time";
  const [todayStatusRoot, setTodayStatusRoot] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    const id = window.setInterval(() => setHeroDateTime(formatHeroDateTime()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Portal target lives in page children; loading.tsx has no #emp-today-status-root.
  // Keep watching until (and whenever) the home view mounts the slot.
  React.useLayoutEffect(() => {
    if (!isDashboardHome) {
      setTodayStatusRoot(null);
      return;
    }
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      const el = document.getElementById("emp-today-status-root");
      if (el) setTodayStatusRoot((prev) => (prev === el ? prev : el));
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [isDashboardHome]);

  // Resolve employeeId before paint so Clock/Break/Prayer can mount immediately.
  React.useLayoutEffect(() => {
    const loginId = localStorage.getItem("loginId");
    if (!loginId) {
      window.location.href = "/auth";
      return;
    }
    const cachedId = localStorage.getItem("employeeId");
    const cachedName = localStorage.getItem("employeeName");
    setEmployeeId(cachedId || loginId);
    if (cachedName) setEmployeeName(cachedName);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const loginId = localStorage.getItem("loginId");
    if (!loginId) return;

    let apiUrl = "/api/hrm_employees?";
    if (loginId.includes("@")) {
      apiUrl += `email=${loginId}`;
    } else {
      apiUrl += `username=${loginId}`;
    }
    Promise.all([
      fetch(apiUrl).then((res) => res.json()).catch(() => ({ success: false })),
      fetch(`/api/hrm_employees?employeeId=${loginId}`).then((res) => res.json()).catch(() => ({ success: false })),
    ])
      .then(([data1, data2]) => {
        const data = data1.success ? data1 : data2;
        if (data.success && data.employee) {
          const name =
            (data.employee.first_name || "") +
            (data.employee.last_name ? " " + data.employee.last_name : "");
          const trimmedName = name.trim() || "Employee";
          const empId = String(data.employee.id || data.employee.employee_id || loginId);
          setEmployeeName(trimmedName);
          setEmployeeId(empId);
          localStorage.setItem("employeeId", empId);
          localStorage.setItem("employeeName", trimmedName);
        } else {
          setEmployeeName((prev) => prev || "Employee");
        }
      })
      .catch(() => {
        setEmployeeName((prev) => prev || "Employee");
      });
  }, []);

  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [employeeAvatar, setEmployeeAvatar] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetchShellBranding()
      .then((branding) => {
        if (employeeId) {
          setEmployeeAvatar(branding.employeeAvatars[employeeId] ?? null);
        }
      })
      .catch(() => {
        /* keep placeholder */
      });
  }, [employeeId]);

  React.useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const initials = (employeeName || "E")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const clockWidget =
    employeeId ? (
      <ClockBreakPrayerWidget
        key="emp-clock-widget"
        employeeId={employeeId}
        employeeName={employeeName || "Employee"}
        variant={isDashboardHome ? "todayStatus" : "slack"}
      />
    ) : null;

  return (
    <div className={`${styles.layout} ${empStyles.noTopbar} ${empStyles.modernShell}`}>
      {sidebarOpen ? (
        <div
          className={styles.sidebarOverlay}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={`${styles.sidebar} ${empStyles.sidebarFull} ${empStyles.sidebarPdf} ${sidebarOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={empStyles.sidebarBrand}>
          <InteractGlobeLogo className={empStyles.sidebarGlobe} />
          <div className={empStyles.sidebarBrandText}>
            <span className={empStyles.sidebarBrandName}>INTERACT</span>
            <span className={empStyles.sidebarBrandSub}>GLOBAL</span>
          </div>
        </div>

        <nav className={`${styles.nav} ${styles.navEmployee} ${empStyles.sidebarNav}`}>
          {employeeTabs.map((tab, idx) => {
            const isActive =
              tab.path === "/employee-dashboard"
                ? pathname === tab.path
                : pathname === tab.path || (pathname?.startsWith(tab.path + "/") ?? false);
            return (
              <Link
                key={tab.path || idx}
                href={tab.path}
                prefetch
                className={
                  isActive
                    ? `${styles.navItem} ${styles.navItemActive} ${empStyles.navItemPdf} ${empStyles.navItemPdfActive}`
                    : `${styles.navItem} ${empStyles.navItemPdf}`
                }
                onClick={(e) => {
                  if (isActive) {
                    e.preventDefault();
                  }
                }}
              >
                <span className={`${styles.navIcon} ${empStyles.navIconPdf}`}>{tab.icon}</span>
                <span>{tab.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className={`${styles.contentArea} ${empStyles.contentFull} ${empStyles.contentModern}`}>
        {isDashboardHome ? (
          <div className={empStyles.heroStrip}>
            <div className={empStyles.heroStripInner}>
              <header className={empStyles.hero}>
                <div className={empStyles.heroLeft}>
                  <button
                    type="button"
                    className={empStyles.mobileMenuBtn}
                    aria-label="Toggle menu"
                    onClick={() => setSidebarOpen((open) => !open)}
                  >
                    &#9776;
                  </button>
                  <div className={empStyles.heroMain}>
                    <h1 className={empStyles.heroTitle}>
                      {greetingLabel()},{" "}
                      <span className={empStyles.heroNameAccent}>{employeeName || "Employee"}!</span>
                    </h1>
                    <span className={empStyles.heroDate}>{heroDateTime}</span>
                  </div>
                </div>

                <div className={empStyles.heroRight}>
                  <HeroSearch />
                  <EmployeeProfileMenu
                    employeeId={employeeId}
                    onAvatarUpdated={(dataUrl) => setEmployeeAvatar(dataUrl)}
                  />
                </div>
              </header>
            </div>
          </div>
        ) : (
          <div className={empStyles.subPageBar}>
            <button
              type="button"
              className={empStyles.mobileMenuBtn}
              aria-label="Toggle menu"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              &#9776;
            </button>
            <div className={empStyles.subPageProfile}>
              <EmployeeAvatar
                name={employeeName || "Employee"}
                initials={initials}
                photo={employeeAvatar}
                size="sm"
              />
              <span>{employeeName || "Employee"}</span>
              <EmployeeProfileMenu
                employeeId={employeeId}
                onAvatarUpdated={(dataUrl) => setEmployeeAvatar(dataUrl)}
              />
            </div>
          </div>
        )}

        {employeeId ? (
          isDashboardHome ? (
            // Wait for portal target — do NOT mount in hidden dock first (that caused double sync + late buttons)
            todayStatusRoot ? createPortal(clockWidget, todayStatusRoot) : null
          ) : (
            <div
              className={`${empStyles.attendanceDock}${showClockBar ? "" : ` ${empStyles.attendanceDockHidden}`}`}
              aria-hidden={!showClockBar}
            >
              <div className={empStyles.attendanceDockInner}>
                <div className={empStyles.dockCard}>
                  {clockWidget}
                  {isTimePage ? (
                    <div style={{ marginTop: 12 }}>
                      <TardyNoteWidget employeeId={employeeId} variant="slack" />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )
        ) : null}

        <main className={`${styles.main} ${empStyles.employeeMain}`}>{children}</main>
      </div>
    </div>
  );
}
