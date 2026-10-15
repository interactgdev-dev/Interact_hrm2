"use client";
import React from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { EmployeeShellProvider, markEmployeePortal } from "@/lib/access-control/employee-shell";
import {
  employeeDisplayNameFromRecord,
  sanitizeEmployeeDisplayName,
} from "@/lib/employee-login-lookup";
import { EmployeeSessionProvider } from "./employee-session-context";
import {
  FaTachometerAlt,
  FaUser,
  FaUsers,
  FaSearch,
  FaTicketAlt,
  FaClipboardList,
  FaCalendarAlt,
  FaDollarSign,
  FaCog,
  FaCoffee,
  FaFileAlt,
  FaEdit,
  FaKey,
} from "react-icons/fa";
import styles from "../layout-dashboard.module.css";
import empStyles from "./emp-shell.module.css";
import { fetchShellBranding } from "../shell-branding-api";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { EmployeeProfileMenu } from "./components/EmployeeProfileMenu";
import { InteractGlobeLogo } from "./components/InteractGlobeLogo";
import { syncInteractGuardBind } from "./sync-interact-guard";
import { GuardPresenceFaceHost } from "./GuardPresenceFaceHost";
import {
  ensureFaceModelsLoaded,
  prefetchFaceModelAssets,
  preloadFaceRuntime,
} from "@/lib/face-client-engine";

/** Heavy clock/biometric UI — load only when dashboard home needs it. */
const ClockBreakPrayerWidget = dynamic(
  () =>
    import("../components/ClockBreakPrayer").then((m) => m.ClockBreakPrayerWidget),
  { ssr: false }
);

function greetingLabel() {
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

type NavTab = { name: string; path: string; icon: React.ReactNode };
type MenuItem = { name?: string; path?: string };

const ACCESS_MENU_CACHE_KEY = "employeeAccessMenuCache";

const BASE_EMPLOYEE_TABS: NavTab[] = [
  { name: "Employee Dashboard", path: "/employee-dashboard", icon: <FaTachometerAlt /> },
  { name: "My Info", path: "/employee-dashboard/my-info", icon: <FaUser /> },
  { name: "My Team", path: "/employee-dashboard/my-team", icon: <FaUsers /> },
  { name: "Generate Ticket", path: "/employee-dashboard/generate-ticket", icon: <FaTicketAlt /> },
];

function buildAccessTabsFromPayload(
  menu: MenuItem[],
  permissions: string[],
): NavTab[] {
  const basePaths = new Set(BASE_EMPLOYEE_TABS.map((t) => t.path));
  const tabs: NavTab[] = [];
  if (permissions.includes("ops.tickets.view")) {
    tabs.push({
      name: "Ticket Inbox",
      path: "/employee-dashboard/tickets",
      icon: iconForPath("/employee-dashboard/tickets", "Ticket Inbox"),
    });
  }
  for (const item of menu) {
    const path = String(item.path || "");
    const name = String(item.name || "");
    if (!path || !name || basePaths.has(path)) continue;
    if (tabs.some((t) => t.path === path)) continue;
    tabs.push({ name, path, icon: iconForPath(path, name) });
  }
  return tabs;
}

function readCachedAccessTabs(employeeId: string): NavTab[] {
  if (typeof window === "undefined" || !employeeId) return [];
  try {
    const raw = localStorage.getItem(ACCESS_MENU_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      employeeId?: string;
      menu?: MenuItem[];
      permissions?: string[];
    };
    if (String(parsed.employeeId || "") !== String(employeeId)) return [];
    return buildAccessTabsFromPayload(
      Array.isArray(parsed.menu) ? parsed.menu : [],
      Array.isArray(parsed.permissions) ? parsed.permissions : [],
    );
  } catch {
    return [];
  }
}

function writeAccessMenuCache(
  employeeId: string,
  menu: MenuItem[],
  permissions: string[],
  roleSlug: string,
) {
  try {
    localStorage.setItem(
      ACCESS_MENU_CACHE_KEY,
      JSON.stringify({ employeeId, menu, permissions, roleSlug }),
    );
    localStorage.setItem("accessPermissions", JSON.stringify(permissions));
    localStorage.setItem("accessRoleSlug", roleSlug);
  } catch {
    /* ignore */
  }
}

function iconForPath(path: string, name: string): React.ReactNode {
  if (path.includes("my-team") || name.includes("Team")) return <FaUsers />;
  if (path.includes("leave") || name.includes("Leave") || path.includes("calendar")) {
    return <FaCalendarAlt />;
  }
  if (path.includes("break") || path.includes("prayer")) return <FaCoffee />;
  if (path.includes("ticket") || name.includes("Ticket")) return <FaTicketAlt />;
  if (
    path.includes("payroll") ||
    path.includes("commission") ||
    path.includes("advance") ||
    path.includes("loan") ||
    path.includes("financial")
  ) {
    return <FaDollarSign />;
  }
  if (path.includes("system-control")) return <FaCog />;
  if (path.includes("credential") || path.includes("face-enrollment")) return <FaKey />;
  if (path.includes("files") || path.includes("formats")) return <FaFileAlt />;
  if (path.includes("employee-list") || path.includes("add-employee") || path.includes("departments")) {
    return <FaUsers />;
  }
  if (path.includes("manage-") || path.includes("shift")) return <FaEdit />;
  if (path.includes("monthly") || path.includes("summary") || path.includes("tungsten") || path.includes("presence")) {
    return <FaFileAlt />;
  }
  return <FaClipboardList />;
}

const PREFETCH_PATHS = [
  "/employee-dashboard",
  "/employee-dashboard/my-team",
  "/employee-dashboard/my-info",
  "/employee-dashboard/generate-ticket",
  "/employee-dashboard/time",
  "/employee-dashboard/attendance",
];

export default function EmployeeDashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [employeeName, setEmployeeName] = React.useState<string>("");
  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [employeePseudonym, setEmployeePseudonym] = React.useState<string>("");
  const [heroDateTime, setHeroDateTime] = React.useState(formatHeroDateTime);
  const isDashboardHome = pathname === "/employee-dashboard";
  const [todayStatusRoot, setTodayStatusRoot] = React.useState<HTMLElement | null>(null);
  const [accessTabs, setAccessTabs] = React.useState<NavTab[]>([]);

  React.useEffect(() => {
    const id = window.setInterval(() => setHeroDateTime(formatHeroDateTime()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Warm face models while employee uses dashboard — idle Guard check skips cold download.
  React.useEffect(() => {
    preloadFaceRuntime();
    prefetchFaceModelAssets();
    void ensureFaceModelsLoaded().catch(() => undefined);
  }, []);

  React.useEffect(() => {
    for (const path of PREFETCH_PATHS) {
      try {
        router.prefetch(path);
      } catch {
        /* ignore */
      }
    }
  }, [router]);

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

  React.useLayoutEffect(() => {
    const loginId = localStorage.getItem("loginId");
    if (!loginId) {
      window.location.href = "/auth";
      return;
    }
    const cachedId = localStorage.getItem("employeeId");
    const cachedName = sanitizeEmployeeDisplayName(
      localStorage.getItem("employeeName"),
      "",
    );
    setEmployeeId(cachedId || loginId);
    if (cachedName) setEmployeeName(cachedName);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const loginId = localStorage.getItem("loginId");
    if (!loginId) return;

    let apiUrl = "/api/hrm_employees?";
    if (loginId.includes("@")) {
      apiUrl += `email=${encodeURIComponent(loginId)}`;
    } else if (/^\d+$/.test(loginId)) {
      apiUrl += `employeeId=${encodeURIComponent(loginId)}`;
    } else {
      apiUrl += `username=${encodeURIComponent(loginId)}`;
    }
    Promise.all([
      fetch(apiUrl).then((res) => res.json()).catch(() => ({ success: false })),
      fetch(`/api/hrm_employees?employeeId=${encodeURIComponent(loginId)}`)
        .then((res) => res.json())
        .catch(() => ({ success: false })),
    ])
      .then(([data1, data2]) => {
        const data = data1.success ? data1 : data2;
        if (data.success && data.employee) {
          const trimmedName = sanitizeEmployeeDisplayName(
            employeeDisplayNameFromRecord(data.employee),
            "Employee",
          );
          const empId = String(data.employee.id || data.employee.employee_id || loginId);
          const pseudo = String(data.employee.pseudonym || "").trim();
          setEmployeeName(trimmedName);
          setEmployeeId(empId);
          if (pseudo) setEmployeePseudonym(pseudo);
          markEmployeePortal(empId, trimmedName);
          try {
            localStorage.setItem("employeeName", trimmedName);
            if (/^\d+$/.test(empId)) localStorage.setItem("employeeId", empId);
            if (pseudo) localStorage.setItem("employeePseudonym", pseudo);
          } catch {
            /* ignore */
          }
          void syncInteractGuardBind({
            employeeId: empId,
            employeeName: trimmedName,
            pseudonym: pseudo || null,
          });
        } else {
          setEmployeeName((prev) => sanitizeEmployeeDisplayName(prev, "Employee"));
        }
      })
      .catch(() => {
        setEmployeeName((prev) => sanitizeEmployeeDisplayName(prev, "Employee"));
      });
  }, []);

  // Keep Interact Guard agent bound to this logged-in employee (auto id/name/pseudo).
  React.useEffect(() => {
    if (!employeeId || !/^\d+$/.test(employeeId)) return;
    const push = () => {
      void syncInteractGuardBind({
        employeeId,
        employeeName: employeeName || localStorage.getItem("employeeName"),
        pseudonym:
          employeePseudonym || localStorage.getItem("employeePseudonym") || null,
      });
    };
    push();
    const id = window.setInterval(push, 60_000);
    return () => window.clearInterval(id);
  }, [employeeId, employeeName, employeePseudonym]);

  // Paint cached permission links immediately (no empty sidebar flash), then refresh.
  React.useLayoutEffect(() => {
    if (!employeeId || !/^\d+$/.test(employeeId)) {
      setAccessTabs([]);
      return;
    }
    const cached = readCachedAccessTabs(employeeId);
    if (cached.length) setAccessTabs(cached);
  }, [employeeId]);

  // System Control permissions → extra sidebar links for this employee.
  React.useEffect(() => {
    if (!employeeId || !/^\d+$/.test(employeeId)) {
      setAccessTabs([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/access-control/me?employeeId=${encodeURIComponent(employeeId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.success) return;
        const menu = Array.isArray(data.menu) ? data.menu : [];
        const perms = Array.isArray(data.permissions) ? data.permissions : [];
        const tabs = buildAccessTabsFromPayload(menu, perms);
        setAccessTabs(tabs);
        writeAccessMenuCache(
          employeeId,
          menu,
          perms,
          String(data.role?.slug || ""),
        );
        for (const t of tabs) {
          try {
            router.prefetch(t.path);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {
        // Keep cached tabs on network error — don't wipe sidebar.
        if (!cancelled && readCachedAccessTabs(employeeId).length === 0) {
          setAccessTabs([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, router]);

  const employeeTabs = React.useMemo(() => {
    const ticketInbox = accessTabs.filter((t) => t.path === "/employee-dashboard/tickets");
    const rest = accessTabs.filter(
      (t) =>
        t.path !== "/employee-dashboard/my-team" &&
        t.path !== "/employee-dashboard/tickets",
    );
    const [home, myInfo, myTeam, generateTicket, ...tail] = BASE_EMPLOYEE_TABS;
    // Home → My Info → My Team → Generate Ticket → Ticket Inbox (HR) → …
    return [
      home,
      myInfo,
      myTeam,
      generateTicket,
      ...ticketInbox,
      ...tail,
      ...rest,
    ].filter(Boolean);
  }, [accessTabs]);

  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [employeeAvatar, setEmployeeAvatar] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!employeeId) return;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      void fetchShellBranding()
        .then((branding) => {
          if (!cancelled) setEmployeeAvatar(branding.employeeAvatars[employeeId] ?? null);
        })
        .catch(() => {
          /* keep placeholder */
        });
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(load, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(load, 400);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
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
    employeeId && isDashboardHome ? (
      <ClockBreakPrayerWidget
        key="emp-clock-widget"
        employeeId={employeeId}
        employeeName={employeeName || "Employee"}
        variant="todayStatus"
      />
    ) : null;

  return (
    <EmployeeShellProvider>
    <EmployeeSessionProvider
      employeeId={employeeId}
      employeeName={employeeName || "Employee"}
      setEmployeeId={setEmployeeId}
      setEmployeeName={setEmployeeName}
    >
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
                  // Soft client nav — layout stays mounted so sidebar does not reload.
                  if (isActive) {
                    e.preventDefault();
                  }
                }}
              >
                <span className={`${styles.navIcon} ${empStyles.navIconPdf}`}>{tab.icon}</span>
                {tab.name === "Employee Dashboard" ? (
                  <span className={`${empStyles.navLabelPdf} ${empStyles.navLabelStacked}`}>
                    <span className={empStyles.navLabelLine}>Employee</span>
                    <span className={empStyles.navLabelLine}>Dashboard</span>
                  </span>
                ) : (
                  <span className={empStyles.navLabelPdf}>{tab.name}</span>
                )}
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

        {employeeId && isDashboardHome && todayStatusRoot
          ? createPortal(clockWidget, todayStatusRoot)
          : null}

        <main className={`${styles.main} ${empStyles.employeeMain}`}>{children}</main>
        {employeeId && /^\d+$/.test(employeeId) ? (
          <GuardPresenceFaceHost
            employeeId={employeeId}
            employeeName={employeeName || "Employee"}
          />
        ) : null}
      </div>
    </div>
    </EmployeeSessionProvider>
    </EmployeeShellProvider>
  );
}
