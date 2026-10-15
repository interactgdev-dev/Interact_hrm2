import type { DemoEmployee } from "@/app/admin/roles-permissions/system-control-data";

/**
 * Slugs used for Org Chart cards + Permissions "Assigned users".
 * - Prefer explicit System Control assigns
 * - Else use effective roleId from Add Employee org role (set by loadAccessEmployees)
 * - Intentionally unassigned employees have roleId="" and empty accessRoleSlugs → []
 */
export function effectiveAccessSlugs(emp: {
  accessRoleSlugs?: string[] | null;
  accessRoleSlug?: string | null;
  roleId?: string | null;
}): string[] {
  if (Array.isArray(emp.accessRoleSlugs) && emp.accessRoleSlugs.length) {
    return emp.accessRoleSlugs.map((s) => String(s).trim()).filter(Boolean);
  }
  const one =
    emp.accessRoleSlug != null && String(emp.accessRoleSlug).trim()
      ? String(emp.accessRoleSlug).trim()
      : "";
  if (one) return [one];
  const mapped = emp.roleId != null ? String(emp.roleId).trim() : "";
  return mapped ? [mapped] : [];
}

export function employeeHasAccessRole(
  emp: DemoEmployee | { accessRoleSlugs?: string[] | null; accessRoleSlug?: string | null; roleId?: string | null },
  roleId: string,
): boolean {
  return effectiveAccessSlugs(emp).includes(String(roleId || "").trim());
}
