"use client";
import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  FaInbox,
  FaClipboardList,
  FaCalendarAlt,
  FaWallet,
  FaChartLine,
  FaCreditCard,
  FaHandshake,
  FaNotesMedical,
  FaLandmark,
  FaCog,
  FaCoffee,
  FaFileAlt,
  FaEdit,
  FaKey,
  FaLock,
  FaUnlock,
} from "react-icons/fa";

const EMP_SIDEBAR_LOCK_KEY = "hrm-emp-sidebar-locked";
import styles from "../layout-dashboard.module.css";
import empStyles from "./emp-shell.module.css";
import { fetchShellBranding } from "../shell-branding-api";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { EmployeeProfileMenu } from "./components/EmployeeProfileMenu";
import { MedicalPackageBadge } from "./components/MedicalPackageBadge";
import { InteractGlobeLogo } from "./components/InteractGlobeLogo";
import { syncInteractGuardBind } from "./sync-interact-guard";
import {
  normalizeMedicalPackage,
  type MedicalPackageId,
} from "@/lib/medical-package";
import { fetchAccessControlMe } from "@/lib/access-control/me-client-cache";

/** Guard face challenge host — keep off the first-paint JS graph. */
const GuardPresenceFaceHost = dynamic(
  () =>
    import("./GuardPresenceFaceHost").then((m) => m.GuardPresenceFaceHost),
  { ssr: false, loading: () => null },
);

/** Mount face host only after idle so home clock buttons stay snappy on refresh. */
function DeferredGuardPresence({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const go = () => setReady(true);
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(go, { timeout: 5000 });
    } else {
      timeoutId = setTimeout(go, 2000);
    }
    return () => {
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);
  if (!ready) return null;
  return (
    <GuardPresenceFaceHost employeeId={employeeId} employeeName={employeeName} />
  );
}

function greetingLabel() {
  return "Welcome Back";
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

/** Match sidebar tab — summaries use distinct paths (/summaries/break). */
function navTabIsActive(
  pathname: string | null | undefined,
  searchParams: URLSearchParams | null,
  tabPath: string,
): boolean {
  const path = String(pathname || "");
  const rawTab = String(tabPath || "");
  const [tabBaseRaw, tabQuery = ""] = rawTab.split("?");
  const tabBase = tabBaseRaw || "";
  if (!tabBase) return false;

  if (tabBase === "/employee-dashboard") {
    return path === "/employee-dashboard";
  }

  // Exact path match (Break / Prayer / Attendance each have their own path).
  if (path === tabBase) return true;

  // Attendance hub root must NOT stay active on /summaries/break|prayer.
  if (
    tabBase === "/employee-dashboard/summaries" ||
    tabBase === "/summaries"
  ) {
    if (path === tabBase) {
      const view = searchParams?.get("view");
      return !view || view === "attendance";
    }
    return false;
  }

  // Child routes under a more specific tab path.
  if (path.startsWith(`${tabBase}/`)) return true;

  // Legacy menu cache still using ?view=break while URL is /summaries/break.
  if (tabQuery) {
    const want = new URLSearchParams(tabQuery).get("view");
    if (want && (path === `/employee-dashboard/summaries/${want}` || path === `/summaries/${want}`)) {
      return true;
    }
    if (
      want &&
      (path === "/employee-dashboard/summaries" || path === "/summaries")
    ) {
      const have = searchParams?.get("view") || "attendance";
      return have === want;
    }
  }

  return false;
}

/** Bump when menu paths change so stale localStorage links (e.g. ?view=) refresh. */
const ACCESS_MENU_CACHE_KEY = "employeeAccessMenuCache_v4";

const BASE_EMPLOYEE_TABS: NavTab[] = [
  { name: "Employee Dashboard", path: "/employee-dashboard", icon: <FaTachometerAlt /> },
  { name: "My Info", path: "/employee-dashboard/my-info", icon: <FaUser /> },
  { name: "My Team", path: "/employee-dashboard/my-team", icon: <FaUsers /> },
  { name: "Generate Ticket", path: "/employee-dashboard/generate-ticket", icon: <FaTicketAlt /> },
  { name: "My Ticket Inbox", path: "/employee-dashboard/my-tickets", icon: <FaInbox /> },
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
  if (path.includes("commission")) return <FaChartLine />;
  if (path.includes("advance")) return <FaCreditCard />;
  if (path.includes("loan")) return <FaHandshake />;
  if (path.includes("claims")) return <FaNotesMedical />;
  if (path.includes("payroll")) return <FaWallet />;
  if (path.includes("financial")) return <FaLandmark />;
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
  "/employee-dashboard/my-tickets",
  "/employee-dashboard/time",
  "/employee-dashboard/attendance",
  "/employee-dashboard/leave",
  "/employee-dashboard/summaries",
  "/employee-dashboard/monthly-attendance",
  "/employee-dashboard/tickets",
  "/employee-dashboard/employee-list",
  "/employee-dashboard/formats-library",
  "/employee-dashboard/employee-files",
];

function EmployeeSidebarNav({ tabs }: { tabs: NavTab[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <nav className={`${styles.nav} ${styles.navEmployee} ${empStyles.sidebarNav}`}>
      {tabs.map((tab, idx) => {
        const isActive = navTabIsActive(pathname, searchParams, tab.path);
        return (
          <Link
            key={tab.path || idx}
            href={tab.path}
            prefetch={false}
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
  );
}

export default function EmployeeDashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [employeeName, setEmployeeName] = React.useState<string>("");
  const [medicalPackage, setMedicalPackage] = React.useState<MedicalPackageId | null>(
    null,
  );
  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [employeePseudonym, setEmployeePseudonym] = React.useState<string>("");
  const isDashboardHome = pathname === "/employee-dashboard";
  const [accessTabs, setAccessTabs] = React.useState<NavTab[]>([]);

  // Prefetch common routes after first paint — don't contend with clock/menu APIs.
  React.useEffect(() => {
    const idle =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (
            window as Window & {
              requestIdleCallback: (
                cb: () => void,
                opts?: { timeout: number },
              ) => number;
            }
          ).requestIdleCallback
        : null;
    const run = () => {
      for (const path of PREFETCH_PATHS) {
        try {
          router.prefetch(path);
        } catch {
          /* ignore */
        }
      }
    };
    // Home clock/attendance first — prefetch only after a longer idle window.
    const id = idle ? idle(run, { timeout: 8000 }) : window.setTimeout(run, 3500);
    return () => {
      if (idle && typeof id === "number") {
        (
          window as Window & { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(id);
      } else {
        window.clearTimeout(id as number);
      }
    };
  }, [router]);

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
    const cachedPseudo = String(localStorage.getItem("employeePseudonym") || "").trim();
    // Prefer numeric employeeId so home clock mounts immediately on refresh.
    setEmployeeId(
      cachedId && /^\d+$/.test(cachedId) ? cachedId : loginId,
    );
    if (cachedName) setEmployeeName(cachedName);
    if (cachedPseudo) setEmployeePseudonym(cachedPseudo);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const loginId = localStorage.getItem("loginId");
    if (!loginId) return;

    const cachedId = localStorage.getItem("employeeId") || "";
    let apiUrl = "/api/hrm_employees?";
    if (cachedId && /^\d+$/.test(cachedId)) {
      apiUrl += `employeeId=${encodeURIComponent(cachedId)}`;
    } else if (loginId.includes("@")) {
      apiUrl += `email=${encodeURIComponent(loginId)}`;
    } else if (/^\d+$/.test(loginId)) {
      apiUrl += `employeeId=${encodeURIComponent(loginId)}`;
    } else {
      apiUrl += `username=${encodeURIComponent(loginId)}`;
    }

    // Single identity fetch (was dual Promise.all on every reload).
    fetch(apiUrl, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
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
        } else {
          setEmployeeName((prev) => sanitizeEmployeeDisplayName(prev, "Employee"));
        }
      })
      .catch(() => {
        setEmployeeName((prev) => sanitizeEmployeeDisplayName(prev, "Employee"));
      });
  }, []);

  // Medical package badge — defer so clock/menu APIs win first paint.
  React.useEffect(() => {
    if (!employeeId || !/^\d+$/.test(employeeId)) {
      setMedicalPackage(null);
      return;
    }
    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetch(`/api/employee_salaries?employeeId=${encodeURIComponent(employeeId)}`, {
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setMedicalPackage(normalizeMedicalPackage(data?.salary?.medical_package));
        })
        .catch(() => {
          if (!cancelled) setMedicalPackage(null);
        });
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(load, { timeout: 3000 });
    } else {
      timeoutId = setTimeout(load, 900);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [employeeId]);

  // Keep Interact Guard agent bound — defer first push so it doesn't fight clock APIs.
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
    const timeoutId = window.setTimeout(push, 1200);
    const id = window.setInterval(push, 60_000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(id);
    };
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
    fetchAccessControlMe(employeeId)
      .then((data) => {
        if (cancelled || !data?.success) return;
        const menu = Array.isArray(data.menu) ? data.menu : [];
        const perms = Array.isArray(data.permissions) ? data.permissions : [];
        const tabs = buildAccessTabsFromPayload(
          menu as MenuItem[],
          perms as string[],
        );
        setAccessTabs(tabs);
        writeAccessMenuCache(
          employeeId,
          menu as MenuItem[],
          perms as string[],
          String((data as { role?: { slug?: string } }).role?.slug || ""),
        );
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
    const [home, myInfo, myTeam, generateTicket, myTicketInbox, ...tail] =
      BASE_EMPLOYEE_TABS;
    // Home → My Info → My Team → Generate Ticket → My Ticket Inbox → Ticket Inbox (HR) → …
    return [
      home,
      myInfo,
      myTeam,
      generateTicket,
      myTicketInbox,
      ...ticketInbox,
      ...tail,
      ...rest,
    ].filter(Boolean);
  }, [accessTabs]);

  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [navPeek, setNavPeek] = React.useState(false);
  const [sidebarLocked, setSidebarLocked] = React.useState(false);
  const [isDesktopNav, setIsDesktopNav] = React.useState(true);
  const [employeeAvatar, setEmployeeAvatar] = React.useState<string | null>(null);
  const sidebarDockRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setSidebarLocked(window.localStorage.getItem(EMP_SIDEBAR_LOCK_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 901px)");
    const sync = () => setIsDesktopNav(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const sidebarVisible = isDesktopNav ? sidebarLocked || navPeek : sidebarOpen;
  const contentPushed = isDesktopNav && (sidebarLocked || navPeek);

  const toggleSidebarLock = React.useCallback(() => {
    setSidebarLocked((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(EMP_SIDEBAR_LOCK_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) {
        setNavPeek(true);
      } else {
        const overDock = Boolean(sidebarDockRef.current?.matches(":hover"));
        setNavPeek(overDock);
        requestAnimationFrame(() => {
          const active = document.activeElement as HTMLElement | null;
          if (active && sidebarDockRef.current?.contains(active)) {
            active.blur();
          }
        });
      }
      return next;
    });
  }, []);

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
    if (!sidebarLocked) setNavPeek(false);
    // pathname only — unlock must not snap-close under the cursor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const initials = (employeeName || "E")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <EmployeeShellProvider>
    <EmployeeSessionProvider
      employeeId={employeeId}
      employeeName={employeeName || "Employee"}
      setEmployeeId={setEmployeeId}
      setEmployeeName={setEmployeeName}
    >
    <div className={`${styles.layout} ${empStyles.noTopbar} ${empStyles.modernShell}`}>
      {sidebarOpen && !isDesktopNav ? (
        <div
          className={styles.sidebarOverlay}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      <div
        ref={sidebarDockRef}
        className={`${empStyles.sidebarDock} ${sidebarVisible ? empStyles.sidebarDockOpen : ""} ${sidebarLocked && isDesktopNav ? empStyles.sidebarDockLocked : ""}`}
        onMouseEnter={() => {
          if (isDesktopNav && !sidebarLocked) setNavPeek(true);
        }}
        onMouseLeave={() => {
          if (isDesktopNav && !sidebarLocked) setNavPeek(false);
        }}
      >
        <div className={empStyles.sidebarRail} aria-hidden title={sidebarLocked ? "Sidebar locked open" : "Hover to open menu"} />
        <aside
          className={`${styles.sidebar} ${empStyles.sidebarFull} ${empStyles.sidebarPdf} ${empStyles.sidebarSlide} ${
            sidebarVisible ? empStyles.sidebarSlideIn : ""
          } ${sidebarOpen && !isDesktopNav ? styles.sidebarOpen : ""}`}
        >
          <div className={empStyles.sidebarBrand}>
            <button
              type="button"
              className={`${empStyles.sidebarLockBtn}${sidebarLocked ? ` ${empStyles.sidebarLockBtnOn}` : ""}`}
              onClick={toggleSidebarLock}
              title={sidebarLocked ? "Unlock sidebar (slide in/out)" : "Lock sidebar open"}
              aria-pressed={sidebarLocked}
              aria-label={sidebarLocked ? "Unlock sidebar" : "Lock sidebar open"}
            >
              {sidebarLocked ? <FaLock aria-hidden /> : <FaUnlock aria-hidden />}
            </button>
            <InteractGlobeLogo className={empStyles.sidebarGlobe} />
            <div className={empStyles.sidebarBrandText}>
              <span className={empStyles.sidebarBrandName}>INTERACT</span>
              <span className={empStyles.sidebarBrandSub}>GLOBAL</span>
            </div>
          </div>

          <React.Suspense
            fallback={
              <nav className={`${styles.nav} ${styles.navEmployee} ${empStyles.sidebarNav}`}>
                {employeeTabs.map((tab, idx) => (
                  <Link
                    key={tab.path || idx}
                    href={tab.path}
                    prefetch
                    className={`${styles.navItem} ${empStyles.navItemPdf}`}
                  >
                    <span className={`${styles.navIcon} ${empStyles.navIconPdf}`}>{tab.icon}</span>
                    <span className={empStyles.navLabelPdf}>{tab.name}</span>
                  </Link>
                ))}
              </nav>
            }
          >
            <EmployeeSidebarNav tabs={employeeTabs} />
          </React.Suspense>
        </aside>
      </div>

      <div
        className={`${styles.contentArea} ${empStyles.contentFull} ${empStyles.contentModern} ${
          contentPushed ? empStyles.contentPushed : ""
        }`}
      >
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
                      <MedicalPackageBadge packageId={medicalPackage} size="md" />
                    </h1>
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
              <MedicalPackageBadge packageId={medicalPackage} size="sm" />
              <EmployeeProfileMenu
                employeeId={employeeId}
                onAvatarUpdated={(dataUrl) => setEmployeeAvatar(dataUrl)}
              />
            </div>
          </div>
        )}

        <main className={`${styles.main} ${empStyles.employeeMain}`}>{children}</main>
        {employeeId && /^\d+$/.test(employeeId) ? (
          <DeferredGuardPresence
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
