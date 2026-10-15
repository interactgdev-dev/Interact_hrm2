/**
 * System Control columns share the same permission catalog.
 * Scope is encoded on the stored key:
 *   - plain key                  → Own department
 *   - key + @all_departments     → All departments
 * Legacy `data.scope.all_departments` still expands company-wide.
 */

export type PermissionScopeColumn = "own" | "all";

export const ALL_DEPARTMENTS_KEY_SUFFIX = "@all_departments";

/** Standalone legacy toggle (kept for existing saved grants). */
export const LEGACY_ALL_DEPARTMENTS_SCOPE_KEY = "data.scope.all_departments";

export function isAllDepartmentsScopedKey(key: string): boolean {
  const k = String(key || "");
  return k === LEGACY_ALL_DEPARTMENTS_SCOPE_KEY || k.endsWith(ALL_DEPARTMENTS_KEY_SUFFIX);
}

export function basePermissionKey(key: string): string {
  const k = String(key || "").trim();
  if (!k) return "";
  if (k === LEGACY_ALL_DEPARTMENTS_SCOPE_KEY) return k;
  if (k.endsWith(ALL_DEPARTMENTS_KEY_SUFFIX)) {
    return k.slice(0, -ALL_DEPARTMENTS_KEY_SUFFIX.length);
  }
  return k;
}

export function toScopedPermissionKey(
  baseKey: string,
  scope: PermissionScopeColumn,
): string {
  const base = basePermissionKey(baseKey);
  if (!base || base === LEGACY_ALL_DEPARTMENTS_SCOPE_KEY) return base;
  return scope === "all" ? `${base}${ALL_DEPARTMENTS_KEY_SUFFIX}` : base;
}

/** True if the grant set enables this catalog permission (own and/or all). */
export function permissionSetHas(
  keys: Iterable<string> | Set<string> | null | undefined,
  catalogKey: string,
): boolean {
  if (!keys) return false;
  const base = basePermissionKey(catalogKey);
  if (!base) return false;
  const set = keys instanceof Set ? keys : new Set([...keys].map(String));
  return (
    set.has(base) ||
    set.has(`${base}${ALL_DEPARTMENTS_KEY_SUFFIX}`) ||
    (base === LEGACY_ALL_DEPARTMENTS_SCOPE_KEY && set.has(LEGACY_ALL_DEPARTMENTS_SCOPE_KEY))
  );
}

export function permissionSetHasScoped(
  keys: Iterable<string> | Set<string> | null | undefined,
  catalogKey: string,
  scope: PermissionScopeColumn,
): boolean {
  if (!keys) return false;
  const set = keys instanceof Set ? keys : new Set([...keys].map(String));
  return set.has(toScopedPermissionKey(catalogKey, scope));
}

/** Flatten stored keys to catalog base keys for menu / feature matching. */
export function catalogKeysFromStored(keys: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of keys) {
    const base = basePermissionKey(String(raw || ""));
    if (base && base !== LEGACY_ALL_DEPARTMENTS_SCOPE_KEY) out.add(base);
    if (String(raw) === LEGACY_ALL_DEPARTMENTS_SCOPE_KEY) {
      out.add(LEGACY_ALL_DEPARTMENTS_SCOPE_KEY);
    }
  }
  return [...out];
}

export function permissionGrantsAllDepartmentsScope(
  keys: Iterable<string>,
): boolean {
  for (const k of keys) {
    if (isAllDepartmentsScopedKey(String(k))) return true;
  }
  return false;
}

/** Clear All-column wording so "team" / "department" do not read as own-scope. */
const ALL_SCOPE_LABEL_BY_KEY: Record<string, string> = {
  "team.dashboard.view": "View all teams dashboard",
  "team.attendance.view": "View all team attendance",
  "team.breaks.view": "View all team breaks (break + prayer)",
  "team.leaves.view": "View all team leave applications",
  "team.management.assign": "Assign members across all teams",
  "department.attendance.view": "View all department attendance",
  "department.breaks.view": "View all department breaks (break + prayer)",
  "department.leaves.view": "View all department leave applications",
  "department.monthly.view": "View all department monthly attendance",
  "department.salary.view": "View all department salaries",
  "attendance.summary.view": "View all attendance summaries",
  "attendance.summary.export": "Export all attendance summaries",
  "attendance.manage.edit": "Edit all attendance records",
  "attendance.monthly.view": "View all monthly attendance",
  "attendance.monthly.export": "Export all deduction summaries",
  "attendance.breaks.manage": "Manage all breaks",
  "attendance.tungsten.view": "Tungsten IN/OUT (all departments)",
  "attendance.presence.view": "Presence / Idle (all departments)",
  "attendance.employee_report.view": "All employee attendance reports",
  "leave.list.view": "View leave requests (all departments)",
  "leave.approve.manager": "Approve leave (all departments)",
  "leave.approval_status.view": "View leave approval status (all departments)",
  "leave.balances.edit": "Edit leave balances (all departments)",
  "leave.calendar.view": "Leave calendar (all departments)",
  "leave.monthly_summary.view": "Monthly leave summary (all departments)",
  "payroll.monthly.view": "View all monthly payroll",
  "payroll.monthly.edit": "Edit all monthly payroll",
  "payroll.commissions": "Commissions (all departments)",
  "payroll.advance": "Advance (all departments)",
  "payroll.loan": "Loan (all departments)",
  "payroll.financial_requests.view": "Financial request inbox (all departments)",
  "people.employee_list.view": "View all employee lists",
  "people.employee.add": "Add employee (any department)",
  "people.credentials.manage": "Employee credentials (all departments)",
  "people.face_enrollment.manage": "Face enrollment (all departments)",
  "people.files.view": "Employee files (all departments)",
  "people.appraisals.view": "Pending appraisals (all departments)",
  "people.formats.view": "Formats library (all departments)",
  "people.recruitment.view": "Recruitment (all departments)",
  "shifts.scheduler.view": "Shift scheduler (all departments)",
  "shifts.management.view": "Shift management (all departments)",
  "ops.tickets.view": "Ticket inbox (all departments)",
  "ops.events.view": "Events (all departments)",
  "ops.departments.view": "View all departments",
  "ops.login_carousel.manage": "Login carousel",
  "ops.company_policy.view": "Company policy",
  "dashboard.view": "View main dashboard (all departments)",
  "admin.home.view": "View admin home (all departments)",
  "portal.my_info.view": "My Info",
  "portal.time.view": "Time / clock page",
  "portal.tickets.create": "Generate ticket",
  "portal.performance.view": "Performance",
  "system.control.access": "Open System Control",
  "system.permissions.edit": "Edit permission checkmarks",
  "system.users.assign": "Assign roles to employees",
  "system.org_chart.edit": "Edit org chart cards",
  "system.features.edit": "Edit global features toggles",
};

const ALL_SCOPE_MODULE_NAME: Record<string, string> = {
  team: "All teams",
  department: "All departments",
  attendance: "Attendance (all)",
  leave: "Leave / PTO (all)",
  people: "People (all)",
  payroll: "Payroll (all)",
  shifts: "Shifts (all)",
  ops: "Operations (all)",
  dashboard: "Dashboard (all)",
  portal: "Employee portal",
  system: "System Control",
};

/** Label shown in Own vs All columns (All column includes “all” / company-wide wording). */
export function labelForPermissionScope(
  catalogKey: string,
  baseLabel: string,
  scope: PermissionScopeColumn,
): string {
  if (scope !== "all") return baseLabel;
  const key = basePermissionKey(catalogKey);
  if (ALL_SCOPE_LABEL_BY_KEY[key]) return ALL_SCOPE_LABEL_BY_KEY[key];
  // Fallback: insert "all" after View/Edit/Manage when missing
  if (/^(view|edit|manage|export)\s/i.test(baseLabel) && !/\ball\b/i.test(baseLabel)) {
    return baseLabel.replace(/^(View|Edit|Manage|Export)\s+/i, (m) => `${m}all `);
  }
  if (!/\ball\b/i.test(baseLabel) && !/\ball departments\b/i.test(baseLabel)) {
    return `${baseLabel} (all departments)`;
  }
  return baseLabel;
}

export function moduleNameForPermissionScope(
  moduleId: string,
  baseName: string,
  scope: PermissionScopeColumn,
): string {
  if (scope !== "all") return baseName;
  return ALL_SCOPE_MODULE_NAME[moduleId] || `${baseName} (all)`;
}

