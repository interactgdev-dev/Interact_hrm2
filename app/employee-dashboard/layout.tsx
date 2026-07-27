"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaTachometerAlt, FaUser, FaUsers, FaSearch } from "react-icons/fa";
import styles from "../layout-dashboard.module.css";
import empStyles from "./emp-shell.module.css";
import { ClockBreakPrayerWidget } from "../components/ClockBreakPrayer";
import { TardyNoteWidget } from "../components/TardyNoteWidget";
import { fetchShellBranding } from "../shell-branding-api";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { EmployeeProfileMenu } from "./components/EmployeeProfileMenu";
import { HeroProfileAvatar } from "./components/HeroProfileAvatar";
import { InteractGlobeLogo } from "./components/InteractGlobeLogo";

function greetingLabel() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function formatHeroDate() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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
  { name: "Dashboard", path: "/employee-dashboard", icon: <FaTachometerAlt /> },
  { name: "My Team", path: "/employee-dashboard/my-team", icon: <FaUsers /> },
  { name: "My Info", path: "/employee-dashboard/my-info", icon: <FaUser /> },
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
  const showClockBar =
    pathname != null && CLOCK_WIDGET_VISIBLE_PATHS.has(pathname);
  const isDashboardHome = pathname === "/employee-dashboard";
  const isTimePage = pathname === "/employee-dashboard/time";

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const loginId = localStorage.getItem("loginId");
    if (!loginId) {
      window.location.href = "/auth";
      return;
    }

    const cachedId = localStorage.getItem("employeeId");
    const cachedName = localStorage.getItem("employeeName");
    if (cachedId) setEmployeeId(cachedId);
    else setEmployeeId(loginId);
    if (cachedName) setEmployeeName(cachedName);

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
          setEmployeeName("Employee");
        }
      })
      .catch(() => {
        setEmployeeName("Employee");
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

  return (
    <div className={`${styles.layout} ${empStyles.noTopbar}`}>
      <div className={empStyles.topAccent} aria-hidden />
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

      <div className={`${styles.contentArea} ${empStyles.contentFull}`}>
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
                  <div className={empStyles.heroAvatar}>
                    <HeroProfileAvatar
                      employeeId={employeeId}
                      name={employeeName || "Employee"}
                      initials={initials}
                      photo={employeeAvatar}
                      onAvatarUpdated={(url) => setEmployeeAvatar(url)}
                    />
                  </div>
                  <div className={empStyles.heroMain}>
                    <p className={empStyles.heroKicker}>{greetingLabel()}</p>
                    <h1 className={empStyles.heroTitle}>{employeeName || "Employee"}</h1>
                    <span className={empStyles.heroDate}>{formatHeroDate()}</span>
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
          <div
            className={`${empStyles.attendanceDock}${showClockBar ? "" : ` ${empStyles.attendanceDockHidden}`}`}
            aria-hidden={!showClockBar}
          >
            <div className={empStyles.attendanceDockInner}>
              <div className={empStyles.dockCard}>
                <ClockBreakPrayerWidget
                  employeeId={employeeId}
                  employeeName={employeeName || "Employee"}
                  variant="slack"
                />
                {isTimePage ? (
                  <div style={{ marginTop: 12 }}>
                    <TardyNoteWidget employeeId={employeeId} variant="slack" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <main className={`${styles.main} ${empStyles.employeeMain}`}>{children}</main>
      </div>
    </div>
  );
}
