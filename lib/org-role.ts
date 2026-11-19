/** Overall org role on `hrm_employees.role` (Add Employee). Permissions stay in System Control. */

import {
  LEGACY_ALL_DEPARTMENTS_SCOPE_KEY,
  basePermissionKey,
  isAllDepartmentsScopedKey,
  permissionGrantsAllDepartmentsScope,
} from "@/lib/access-control/permission-scope";

export const ORG_ROLE_DB = {
  CEO: "BOD/CEO",
  MANAGER: "Management",
  TEAM_LEAD: "Leader",
  OFFICER: "Officer",
} as const;

export type OrgRoleDbValue =
  (typeof ORG_ROLE_DB)[keyof typeof ORG_ROLE_DB];

/** UI options for Add Employee (value = DB enum). */
export const ORG_ROLE_OPTIONS: { value: OrgRoleDbValue; label: string }[] = [
  { value: ORG_ROLE_DB.OFFICER, label: "Officer" },
  { value: ORG_ROLE_DB.TEAM_LEAD, label: "Team Lead" },
  { value: ORG_ROLE_DB.MANAGER, label: "Manager" },
  { value: ORG_ROLE_DB.CEO, label: "CEO" },
];

export function normalizeOrgRole(role: unknown): OrgRoleDbValue {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  if (!r) return ORG_ROLE_DB.OFFICER;
  if (r === "bod/ceo" || r.includes("ceo") || r.includes("bod") || r.includes("board")) {
    return ORG_ROLE_DB.CEO;
  }
  if (r === "management" || r === "manager" || r.includes("manager")) {
    return ORG_ROLE_DB.MANAGER;
  }
  if (
    r === "leader" ||
    r === "team lead" ||
    r === "team_lead" ||
    r.includes("lead") ||
    r.includes("supervisor")
  ) {
    return ORG_ROLE_DB.TEAM_LEAD;
  }
  if (r === "hod" || r.includes("head of")) {
    // Legacy HOD → treat as Manager for scope
    return ORG_ROLE_DB.MANAGER;
  }
  return ORG_ROLE_DB.OFFICER;
}

export function orgRoleLabel(role: unknown): string {
  const v = normalizeOrgRole(role);
  return ORG_ROLE_OPTIONS.find((o) => o.value === v)?.label || "Officer";
}

export function isCeoOrgRole(role: unknown): boolean {
  return normalizeOrgRole(role) === ORG_ROLE_DB.CEO;
}

export function isManagerOrgRole(role: unknown): boolean {
  return normalizeOrgRole(role) === ORG_ROLE_DB.MANAGER;
}

export function isTeamLeadOrgRole(role: unknown): boolean {
  return normalizeOrgRole(role) === ORG_ROLE_DB.TEAM_LEAD;
}

/** Manager / Team Lead must confirm department — that becomes their data scope. */
export function orgRoleNeedsDepartmentConfirm(role: unknown): boolean {
  const v = normalizeOrgRole(role);
  return v === ORG_ROLE_DB.MANAGER || v === ORG_ROLE_DB.TEAM_LEAD;
}

/** Permission keys that imply department-scoped data for non-CEO roles. */
export const DEPT_SCOPED_PERMISSION_PREFIXES = [
  "attendance.",
  "department.",
  "team.",
  "people.employee_list",
  "people.",
  "leave.list",
  "leave.approve",
  "leave.approval_status",
  "leave.monthly_summary",
  "payroll.",
  "ops.",
  "shifts.",
] as const;

/** Explicit opt-in: company-wide data (all departments). Without this, dept-scoped perms stay own-dept. */
export const ALL_DEPARTMENTS_SCOPE_PERMISSION = LEGACY_ALL_DEPARTMENTS_SCOPE_KEY;

export function permissionImpliesDepartmentScope(key: string): boolean {
  const k = basePermissionKey(String(key || ""));
  if (!k || k === ALL_DEPARTMENTS_SCOPE_PERMISSION) return false;
  if (isAllDepartmentsScopedKey(String(key || ""))) return false;
  return DEPT_SCOPED_PERMISSION_PREFIXES.some((p) => k.startsWith(p));
}

export function permissionGrantsAllDepartments(keys: Iterable<string>): boolean {
  return permissionGrantsAllDepartmentsScope(keys);
}
