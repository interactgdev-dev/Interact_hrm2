/**
 * HR department access defaults + salary privacy helpers.
 * Protocol applies only when the viewer's department chip is HR.
 */

import { orgDeptChipLabel } from "@/app/admin/roles-permissions/system-control-data";
import {
  isCeoOrgRole,
  isManagerOrgRole,
  isTeamLeadOrgRole,
  normalizeOrgRole,
  ORG_ROLE_DB,
} from "@/lib/org-role";
import { permissionSetHas } from "@/lib/access-control/permission-scope";
import { detectDeptHeadHint } from "@/lib/dept-heads";

/** System Control → Features keys that gate access merges. */
export const FEATURE_HR_DEPARTMENT_DEFAULTS = "hr_department_defaults";
export const FEATURE_ALL_EMPLOYEE_DASHBOARD = "all_employee_dashboard";

/** Tabs / ops every HR employee gets automatically (no System Control). */
export const HR_DEPARTMENT_DEFAULT_PERMISSIONS: string[] = [
  "attendance.summary.view",
  "attendance.breaks.manage",
  "attendance.monthly.view",
  "attendance.manage.edit",
  "department.attendance.view",
  "department.breaks.view",
  "department.leaves.view",
  "department.monthly.view",
  "leave.list.view",
  "leave.approval_status.view",
  "leave.monthly_summary.view",
  "payroll.monthly.view",
  "payroll.advance",
  "payroll.loan",
  "people.employee_list.view",
  "portal.tickets.create",
  "portal.my_info.view",
];

/** All HR staff — company HR ticket inbox (view). Approve is Manager-only. */
export const HR_TICKET_VIEW_PERMISSIONS: string[] = ["ops.tickets.view"];

/** HR Manager / Team Lead — approve leave + ticket moderation. */
export const HR_TICKET_MODERATOR_PERMISSIONS: string[] = [
  "ops.tickets.view",
  "leave.approve",
];

/** Managers only — features / roles update in System Control. */
export const MANAGER_SYSTEM_CONTROL_PERMISSIONS: string[] = [
  "system.control.access",
  "system.permissions.edit",
  "system.users.assign",
  "system.org_chart.edit",
  "system.features.edit",
];

/** Manager toggle in Permissions: see salaries of own department (at/below own level). */
export const DEPT_SALARY_VIEW_PERMISSION = "department.salary.view";

const ROLE_RANK: Record<string, number> = {
  [ORG_ROLE_DB.CEO]: 1,
  [ORG_ROLE_DB.MANAGER]: 2,
  HOD: 2,
  [ORG_ROLE_DB.TEAM_LEAD]: 3,
  [ORG_ROLE_DB.OFFICER]: 4,
};

export function isHrDepartment(departmentName: string | null | undefined): boolean {
  return orgDeptChipLabel(departmentName) === "HR";
}

function roleRank(role: unknown): number {
  const n = normalizeOrgRole(role);
  return ROLE_RANK[n] ?? 99;
}

/** Target is higher in org than viewer (e.g. Manager above Officer). */
export function isOrgSeniorOf(targetRole: unknown, viewerRole: unknown): boolean {
  return roleRank(targetRole) < roleRank(viewerRole);
}

/** Non-HR Team Lead / Manager — Leaves page (not Ticket Inbox). */
export const DEPT_LEAVE_PAGE_PERMISSIONS: string[] = [
  "leave.list.view",
  "leave.approve.manager",
  "leave.approval_status.view",
  "department.leaves.view",
];

export function mergeHrAccessPermissions(opts: {
  permissions: string[];
  departmentName: string | null | undefined;
  orgRole: string | null | undefined;
  accessRoleSlugs?: string[] | null;
  /** Optional — used to detect Joe / Max / Mubeen even if role is not BOD/CEO. */
  firstName?: string | null;
  lastName?: string | null;
  /**
   * System Control → Features: "HR department auto permissions".
   * When false, skip auto-merging HR_DEPARTMENT_DEFAULT_PERMISSIONS / HR ticket pack.
   */
  hrDepartmentDefaultsEnabled?: boolean;
  /**
   * System Control → Features: "All profiles → employee dashboard".
   * When true, strip role menus so everyone keeps the base employee shell.
   * Managers/CEO still keep system.* so Features can be turned OFF again.
   */
  allEmployeeDashboardEnabled?: boolean;
}): string[] {
  const manager = isManagerOrgRole(opts.orgRole);
  const teamLead = isTeamLeadOrgRole(opts.orgRole);
  const ceo = isCeoOrgRole(opts.orgRole);
  const headHint = detectDeptHeadHint(opts.firstName, opts.lastName);
  const deptHeadCeo = ceo || Boolean(headHint);

  // Master switch: everyone → default employee dashboard (no role menus).
  if (opts.allEmployeeDashboardEnabled) {
    const set = new Set<string>();
    for (const k of opts.permissions.filter(Boolean)) {
      if (k.startsWith("system.")) set.add(k);
    }
    if (manager || deptHeadCeo) {
      for (const k of MANAGER_SYSTEM_CONTROL_PERMISSIONS) set.add(k);
    } else {
      for (const k of [...set]) {
        if (k.startsWith("system.")) set.delete(k);
      }
    }
    return [...set];
  }

  const set = new Set(opts.permissions.filter(Boolean));
  const hr = isHrDepartment(opts.departmentName);
  const hrDefaultsOn = opts.hrDepartmentDefaultsEnabled !== false;
  const slugs = (opts.accessRoleSlugs || []).map((s) =>
    String(s || "").trim().toLowerCase()
  );

  // Joe / Max / Mubeen (and BOD/CEO): leave tickets in Ticket Inbox — not Leaves page.
  if (deptHeadCeo) {
    for (const k of HR_TICKET_VIEW_PERMISSIONS) set.add(k);
    for (const k of HR_TICKET_MODERATOR_PERMISSIONS) set.add(k);
    for (const k of DEPT_LEAVE_PAGE_PERMISSIONS) set.delete(k);
    set.delete("leave.list.view");
    set.delete("leave.approve.manager");
    set.delete("department.leaves.view");
  } else if (hr && hrDefaultsOn) {
    for (const k of HR_DEPARTMENT_DEFAULT_PERMISSIONS) set.add(k);
    // All HR staff see Ticket Inbox. Manager / Team Lead may approve leave.
    for (const k of HR_TICKET_VIEW_PERMISSIONS) set.add(k);
    const hrLeadSlug = slugs.some(
      (s) =>
        s === "hr_manager" ||
        s === "team_lead_hr" ||
        s.includes("hr_manager") ||
        s.includes("team_lead_hr")
    );
    if (manager || teamLead || hrLeadSlug) {
      for (const k of HR_TICKET_MODERATOR_PERMISSIONS) set.add(k);
      for (const k of DEPT_LEAVE_PAGE_PERMISSIONS) set.add(k);
    } else {
      // Officers: inbox yes, leave approve no.
      set.delete("leave.approve");
      set.delete("leave.approve.manager");
    }
  } else if (manager || teamLead) {
    // Other departments: leave approve/reject on Leaves page only — never Ticket Inbox.
    // Single-step only (two-step disabled globally).
    for (const k of DEPT_LEAVE_PAGE_PERMISSIONS) set.add(k);
    set.delete("ops.tickets.view");
  }

  if (manager || deptHeadCeo) {
    for (const k of MANAGER_SYSTEM_CONTROL_PERMISSIONS) set.add(k);
  } else {
    for (const k of [...set]) {
      if (k.startsWith("system.")) set.delete(k);
    }
  }

  return [...set];
}

/** Read ON/OFF for the two access master switches from loaded global features. */
export function accessFeatureFlagsFrom(
  features: { key: string; on?: boolean }[] | null | undefined,
): {
  hrDepartmentDefaultsEnabled: boolean;
  allEmployeeDashboardEnabled: boolean;
} {
  const byKey = new Map(
    (features || []).map((f) => [String(f.key || "").trim(), Boolean(f.on)]),
  );
  return {
    // Missing row → OFF (gradual rollout default).
    hrDepartmentDefaultsEnabled: byKey.get(FEATURE_HR_DEPARTMENT_DEFAULTS) === true,
    // Missing row → ON (everyone starts on employee dashboard until turned off).
    allEmployeeDashboardEnabled: byKey.has(FEATURE_ALL_EMPLOYEE_DASHBOARD)
      ? byKey.get(FEATURE_ALL_EMPLOYEE_DASHBOARD) === true
      : true,
  };
}

export type SalaryVisibilityInput = {
  viewerId: string;
  targetId: string;
  viewerPermissions: string[];
  viewerOrgRole: string | null | undefined;
  targetOrgRole: string | null | undefined;
  viewerDepartmentName: string | null | undefined;
  targetDepartmentName: string | null | undefined;
};

/**
 * Who may see another employee's salary amount / bank fields.
 *
 * - Own salary: always
 * - CEO: always
 * - HR protocol: may see OTHER departments (payroll work); within HR hide
 *   colleagues / seniors / juniors unless `department.salary.view` is on,
 *   and never show someone ranked above you
 * - Non-HR: same-dept only with `department.salary.view`, never seniors
 */
export function canViewEmployeeSalary(input: SalaryVisibilityInput): boolean {
  const viewerId = String(input.viewerId || "").trim();
  const targetId = String(input.targetId || "").trim();
  if (!viewerId || !targetId) return false;
  if (viewerId === targetId) return true;
  if (isCeoOrgRole(input.viewerOrgRole)) return true;

  const perms = input.viewerPermissions;
  // Monthly Payroll menu itself requires this — sheet needs every basic amount.
  if (
    permissionSetHas(perms, "payroll.monthly.view") ||
    permissionSetHas(perms, "payroll.monthly.edit")
  ) {
    return true;
  }

  const hasDeptSalary = permissionSetHas(perms, DEPT_SALARY_VIEW_PERMISSION);
  const viewerHr = isHrDepartment(input.viewerDepartmentName);
  const targetHr = isHrDepartment(input.targetDepartmentName);
  const senior = isOrgSeniorOf(input.targetOrgRole, input.viewerOrgRole);

  // Never show someone above you in the hierarchy (non-payroll contexts)
  if (senior) return false;

  if (viewerHr) {
    // HR without payroll perm: still need dept salary toggle for same-HR peers
    if (!targetHr) return false;
    return hasDeptSalary;
  }

  // Non-HR managers: own department only when toggle is on
  if (!hasDeptSalary) return false;
  const vChip = orgDeptChipLabel(input.viewerDepartmentName);
  const tChip = orgDeptChipLabel(input.targetDepartmentName);
  if (!vChip || !tChip) return false;
  return vChip.toLowerCase() === tChip.toLowerCase();
}

export function redactSalaryRow<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const k of [
    "amount",
    "basic_salary",
    "basicSalary",
    "account_number",
    "accountNumber",
    "routing_number",
    "routingNumber",
    "deposit_amount",
    "depositAmount",
    "pay_grade",
    "payGrade",
  ]) {
    if (k in out) (out as Record<string, unknown>)[k] = null;
  }
  (out as Record<string, unknown>).salary_hidden = true;
  return out;
}
