import type { ReactNode } from "react";
import { catalogKeysFromStored, permissionSetHas } from "./permission-scope";

/** Permission key → links shown inside the employee dashboard shell (never admin chrome). */

export type AccessMenuItem = {
  permission: string;
  featureGate?: string;
  name: string;
  path: string;
  group?: "core" | "attendance" | "leave" | "payroll" | "team" | "system" | "ops" | "people" | "shifts";
};

/**
 * Exact permission → exact tab.
 * Break / Prayer only from breaks permissions (not from attendance.summary alone).
 * All privileged links stay under `/employee-dashboard/*`.
 */
export const ACCESS_MENU_REGISTRY: AccessMenuItem[] = [
  // ── Team ──
  {
    permission: "team.dashboard.view",
    name: "My Team",
    path: "/employee-dashboard/my-team",
    group: "team",
  },
  {
    permission: "team.attendance.view",
    name: "Attendance Summary",
    path: "/employee-dashboard/summaries",
    group: "attendance",
  },
  {
    permission: "team.breaks.view",
    name: "Break Summary",
    path: "/employee-dashboard/summaries?view=break",
    group: "attendance",
  },
  {
    permission: "team.breaks.view",
    name: "Prayer Break Summary",
    path: "/employee-dashboard/summaries?view=prayer",
    group: "attendance",
  },
  {
    permission: "team.leaves.view",
    name: "Leaves",
    path: "/employee-dashboard/leave-inbox",
    group: "leave",
  },

  // ── Department ──
  {
    permission: "department.attendance.view",
    name: "Attendance Summary",
    path: "/employee-dashboard/summaries",
    group: "attendance",
  },
  {
    permission: "department.breaks.view",
    name: "Break Summary",
    path: "/employee-dashboard/summaries?view=break",
    group: "attendance",
  },
  {
    permission: "department.breaks.view",
    name: "Prayer Break Summary",
    path: "/employee-dashboard/summaries?view=prayer",
    group: "attendance",
  },
  {
    permission: "department.leaves.view",
    name: "Leaves",
    path: "/employee-dashboard/leave-inbox",
    group: "leave",
  },
  {
    permission: "department.monthly.view",
    name: "Monthly Attendance",
    path: "/employee-dashboard/monthly-attendance",
    group: "attendance",
  },

  // ── Attendance ──
  {
    permission: "attendance.summary.view",
    name: "Attendance Summary",
    path: "/employee-dashboard/summaries",
    group: "attendance",
  },
  {
    permission: "attendance.manage.edit",
    name: "Manage Attendance",
    path: "/employee-dashboard/manage-attendance",
    group: "attendance",
  },
  {
    permission: "attendance.breaks.manage",
    name: "Manage Breaks",
    path: "/employee-dashboard/manage-breaks",
    group: "attendance",
  },
  {
    permission: "attendance.monthly.view",
    name: "Monthly Attendance",
    path: "/employee-dashboard/monthly-attendance",
    group: "attendance",
  },
  {
    permission: "attendance.tungsten.view",
    name: "Tungsten IN/OUT",
    path: "/employee-dashboard/tungsten-in-out",
    group: "attendance",
  },
  {
    permission: "attendance.presence.view",
    name: "Presence / Idle",
    path: "/employee-dashboard/presence-idle",
    group: "attendance",
  },
  {
    permission: "attendance.employee_report.view",
    name: "Employee Attendance Report",
    path: "/employee-dashboard/attendance",
    group: "attendance",
  },

  // ── Leave ──
  {
    permission: "leave.list.view",
    name: "Leaves",
    path: "/employee-dashboard/leave-inbox",
    group: "leave",
  },
  {
    permission: "leave.approval_status.view",
    name: "Leaves",
    path: "/employee-dashboard/leave-inbox",
    group: "leave",
  },
  {
    permission: "leave.approve.manager",
    name: "Leaves",
    path: "/employee-dashboard/leave-inbox",
    group: "leave",
  },
  {
    permission: "leave.balances.edit",
    name: "Manage Leaves",
    path: "/employee-dashboard/manage-leaves",
    group: "leave",
  },
  {
    permission: "leave.calendar.view",
    name: "Leave Calendar",
    path: "/employee-dashboard/calendar",
    group: "leave",
  },
  {
    permission: "leave.monthly_summary.view",
    name: "Monthly Leave Summary",
    path: "/employee-dashboard/monthly-leave-summary",
    group: "leave",
  },

  // ── Payroll ──
  {
    permission: "payroll.monthly.view",
    name: "Monthly Payroll",
    path: "/employee-dashboard/monthly-payroll",
    group: "payroll",
  },
  {
    permission: "payroll.commissions",
    name: "Commissions",
    path: "/employee-dashboard/commissions",
    group: "payroll",
  },
  {
    permission: "payroll.advance",
    name: "Advance",
    path: "/employee-dashboard/advance",
    group: "payroll",
  },
  {
    permission: "payroll.loan",
    name: "Loan",
    path: "/employee-dashboard/loan",
    group: "payroll",
  },
  {
    permission: "payroll.financial_requests.view",
    name: "Financial Requests",
    path: "/employee-dashboard/financial-requests",
    group: "payroll",
  },

  // ── People ──
  {
    permission: "people.employee_list.view",
    name: "Employee List",
    path: "/employee-dashboard/employee-list",
    group: "people",
  },
  {
    permission: "people.employee.add",
    name: "Add Employee",
    path: "/employee-dashboard/add-employee",
    group: "people",
  },
  {
    permission: "people.credentials.manage",
    name: "Employee Credentials",
    path: "/employee-dashboard/employee-credentials",
    group: "people",
  },
  {
    permission: "people.face_enrollment.manage",
    name: "Face Enrollment",
    path: "/employee-dashboard/face-enrollment",
    group: "people",
  },
  {
    permission: "people.files.view",
    name: "Employee Files",
    path: "/employee-dashboard/employee-files",
    group: "people",
  },
  {
    permission: "people.appraisals.view",
    name: "Pending Appraisals",
    path: "/employee-dashboard/pending-appraisals",
    group: "people",
  },
  {
    permission: "people.formats.view",
    name: "Formats Library",
    path: "/employee-dashboard/formats-library",
    group: "people",
  },
  {
    permission: "people.recruitment.view",
    name: "Recruitment",
    path: "/employee-dashboard/recruitment",
    group: "people",
  },

  // ── Shifts ──
  {
    permission: "shifts.scheduler.view",
    name: "Shift Scheduler",
    path: "/employee-dashboard/shift-scheduler",
    group: "shifts",
  },
  {
    permission: "shifts.management.view",
    name: "Shift Management",
    path: "/employee-dashboard/shift-management",
    group: "shifts",
  },

  // ── Ops ──
  {
    permission: "ops.tickets.view",
    featureGate: "tickets",
    name: "Ticket Inbox",
    path: "/employee-dashboard/tickets",
    group: "ops",
  },
  {
    permission: "ops.events.view",
    name: "Events",
    path: "/employee-dashboard/events",
    group: "ops",
  },
  {
    permission: "ops.departments.view",
    name: "Departments",
    path: "/employee-dashboard/departments",
    group: "ops",
  },
  {
    permission: "ops.login_carousel.manage",
    name: "Login Carousel",
    path: "/employee-dashboard/login-carousel",
    group: "ops",
  },
  {
    permission: "ops.company_policy.view",
    name: "Company Policy",
    path: "/employee-dashboard/company-policy",
    group: "ops",
  },

  // ── Portal ──
  {
    permission: "portal.tickets.create",
    featureGate: "tickets",
    name: "Generate Ticket",
    path: "/employee-dashboard/generate-ticket",
    group: "core",
  },
  {
    permission: "portal.my_info.view",
    name: "My Info",
    path: "/employee-dashboard/my-info",
    group: "core",
  },
  {
    permission: "portal.time.view",
    name: "Time",
    path: "/employee-dashboard/time",
    group: "attendance",
  },
  {
    permission: "portal.performance.view",
    name: "Performance",
    path: "/employee-dashboard/performance",
    group: "core",
  },

  // ── System ──
  {
    permission: "system.control.access",
    name: "System Control",
    path: "/employee-dashboard/system-control",
    group: "system",
  },
];

/** Old admin URLs → employee-shell equivalents (for bookmarks / stale links). */
export const ADMIN_PATH_TO_EMPLOYEE: Record<string, string> = {
  "/leave": "/employee-dashboard/leave-inbox",
  "/summaries": "/employee-dashboard/summaries",
  "/attendance/employee-report": "/employee-dashboard/attendance",
  "/add-employee": "/employee-dashboard/add-employee",
  "/recruitment": "/employee-dashboard/recruitment",
  "/performance": "/employee-dashboard/performance",
  "/admin/manage-leaves": "/employee-dashboard/manage-leaves",
  "/admin/monthly-attendance": "/employee-dashboard/monthly-attendance",
  "/admin/manage-attendance": "/employee-dashboard/manage-attendance",
  "/admin/manage-breaks": "/employee-dashboard/manage-breaks",
  "/admin/monthly-payroll": "/employee-dashboard/monthly-payroll",
  "/admin/commissions": "/employee-dashboard/commissions",
  "/admin/advance": "/employee-dashboard/advance",
  "/admin/loan": "/employee-dashboard/loan",
  "/admin/system-control": "/employee-dashboard/system-control",
  "/admin/tickets": "/employee-dashboard/tickets",
  "/admin/employee-list": "/employee-dashboard/employee-list",
  "/admin/employee-credentials": "/employee-dashboard/employee-credentials",
  "/admin/employee-files": "/employee-dashboard/employee-files",
  "/admin/face-enrollment": "/employee-dashboard/face-enrollment",
  "/admin/pending-appraisals": "/employee-dashboard/pending-appraisals",
  "/admin/formats-library": "/employee-dashboard/formats-library",
  "/admin/events": "/employee-dashboard/events",
  "/admin/departments": "/employee-dashboard/departments",
  "/admin/login-carousel": "/employee-dashboard/login-carousel",
  "/admin/company-policy": "/employee-dashboard/company-policy",
  "/admin/tungsten-in-out": "/employee-dashboard/tungsten-in-out",
  "/admin/presence-idle": "/employee-dashboard/presence-idle",
  "/admin/monthly-leave-summary": "/employee-dashboard/monthly-leave-summary",
  "/admin/calendar": "/employee-dashboard/calendar",
  "/admin/financial-requests": "/employee-dashboard/financial-requests",
  "/admin/shift-scheduler": "/employee-dashboard/shift-scheduler",
  "/admin/shift-management": "/employee-dashboard/shift-management",
};

export function buildMenuFromPermissions(
  permissions: string[],
  enabledFeatures: Record<string, boolean>,
): { name: string; path: string; group?: string }[] {
  const permSet = new Set(catalogKeysFromStored(permissions));
  const seenPath = new Set<string>();
  const out: { name: string; path: string; group?: string }[] = [];

  for (const item of ACCESS_MENU_REGISTRY) {
    if (!permissionSetHas(permSet, item.permission)) continue;
    if (item.featureGate && enabledFeatures[item.featureGate] === false) continue;
    // One tab per path — admin-style names, no Dept/Team duplicates
    if (seenPath.has(item.path)) continue;
    seenPath.add(item.path);
    out.push({ name: item.name, path: item.path, group: item.group });
  }
  return out;
}

export function allowedPathsFromPermissions(permissions: string[]): Set<string> {
  const permSet = new Set(catalogKeysFromStored(permissions));
  const paths = new Set<string>();
  for (const item of ACCESS_MENU_REGISTRY) {
    if (permissionSetHas(permSet, item.permission)) paths.add(item.path);
  }
  paths.add("/employee-dashboard");
  paths.add("/employee-dashboard/my-info");
  paths.add("/employee-dashboard/my-team");
  paths.add("/employee-dashboard/generate-ticket");
  return paths;
}

export function isPathAllowed(pathname: string, allowed: Set<string>): boolean {
  if (!pathname) return false;
  if (allowed.has(pathname)) return true;
  for (const p of allowed) {
    const base = p.split("?")[0];
    if (pathname === p || pathname === base || pathname.startsWith(`${base}/`)) return true;
  }
  return false;
}

type SidebarSubLink = { name: string; path: string; icon?: ReactNode };
type SidebarLink = {
  name: string;
  path?: string;
  icon?: ReactNode;
  dropdown?: SidebarSubLink[];
};
type SidebarGroup = { group: string; links: SidebarLink[] };

export function filterAdminSidebarByPaths(
  groups: SidebarGroup[],
  allowed: Set<string>,
): SidebarGroup[] {
  const out: SidebarGroup[] = [];
  for (const g of groups) {
    const links: SidebarLink[] = [];
    for (const link of g.links) {
      if (link.dropdown?.length) {
        const dropdown = link.dropdown.filter((d) => allowed.has(d.path));
        if (dropdown.length) links.push({ ...link, dropdown });
        continue;
      }
      if (link.path && allowed.has(link.path)) links.push(link);
    }
    if (links.length) out.push({ group: g.group, links });
  }
  return out;
}
