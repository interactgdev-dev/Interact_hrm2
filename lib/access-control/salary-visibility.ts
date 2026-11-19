import { pool } from "@/lib/db";
import {
  accessFeatureFlagsFrom,
  canViewEmployeeSalary,
  mergeHrAccessPermissions,
  redactSalaryRow,
  type SalaryVisibilityInput,
} from "@/lib/access-control/hr-access";
import {
  loadEmployeePermissionOverrides,
  loadGlobalFeatures,
  loadPermissionsForRole,
  resolveEmployeeAccessRoleSlug,
} from "@/lib/access-control/store";

type EmpMeta = {
  id: string;
  role: string | null;
  department_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

async function loadEmpMeta(ids: string[]): Promise<Map<string, EmpMeta>> {
  const uniq = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  const map = new Map<string, EmpMeta>();
  if (!uniq.length) return map;
  const placeholders = uniq.map(() => "?").join(",");
  const [rows] = await pool.execute(
    `SELECT e.id, e.role, e.first_name, e.last_name, d.name AS department_name
     FROM hrm_employees e
     LEFT JOIN employee_jobs j ON e.id = j.employee_id
     LEFT JOIN departments d ON j.department_id = d.id
     WHERE e.id IN (${placeholders})`,
    uniq.map((id) => (/^\d+$/.test(id) ? Number(id) : id)),
  );
  for (const r of rows as {
    id: number;
    role?: string;
    department_name?: string;
    first_name?: string;
    last_name?: string;
  }[]) {
    map.set(String(r.id), {
      id: String(r.id),
      role: r.role != null ? String(r.role) : null,
      department_name: r.department_name ? String(r.department_name) : null,
      first_name: r.first_name != null ? String(r.first_name) : null,
      last_name: r.last_name != null ? String(r.last_name) : null,
    });
  }
  return map;
}

async function loadViewerPermissionKeys(employeeId: string): Promise<string[]> {
  const emp = await resolveEmployeeAccessRoleSlug(employeeId);
  const [override, features, meta] = await Promise.all([
    loadEmployeePermissionOverrides(emp.employeeId),
    loadGlobalFeatures(),
    loadEmpMeta([employeeId]),
  ]);
  const rolePermSets = await Promise.all(
    emp.roleSlugs.map((slug) => loadPermissionsForRole(slug)),
  );
  const base =
    override != null
      ? override.filter((k) => k !== "__custom__")
      : [...new Set(rolePermSets.flat())];
  const m = meta.get(String(employeeId));
  const flags = accessFeatureFlagsFrom(features);
  return mergeHrAccessPermissions({
    permissions: base,
    departmentName: m?.department_name,
    orgRole: m?.role ?? emp.legacyRole,
    accessRoleSlugs: emp.roleSlugs,
    firstName: m?.first_name ?? emp.firstName,
    lastName: m?.last_name ?? emp.lastName,
    hrDepartmentDefaultsEnabled: flags.hrDepartmentDefaultsEnabled,
    allEmployeeDashboardEnabled: flags.allEmployeeDashboardEnabled,
  });
}

export async function resolveSalaryVisibility(
  viewerId: string,
  targetId: string,
): Promise<boolean> {
  const vid = String(viewerId || "").trim();
  const tid = String(targetId || "").trim();
  if (!vid || !tid) return false;
  if (vid === tid) return true;

  const [meta, permissions] = await Promise.all([
    loadEmpMeta([vid, tid]),
    loadViewerPermissionKeys(vid),
  ]);
  const viewer = meta.get(vid);
  const target = meta.get(tid);
  const input: SalaryVisibilityInput = {
    viewerId: vid,
    targetId: tid,
    viewerPermissions: permissions,
    viewerOrgRole: viewer?.role,
    targetOrgRole: target?.role,
    viewerDepartmentName: viewer?.department_name,
    targetDepartmentName: target?.department_name,
  };
  return canViewEmployeeSalary(input);
}

export async function filterSalariesForViewer<T extends Record<string, unknown>>(
  viewerId: string,
  rows: T[],
  employeeIdKey: string = "employee_id",
): Promise<T[]> {
  const vid = String(viewerId || "").trim();
  if (!vid) {
    return rows.map((r) => redactSalaryRow(r));
  }
  const targetIds = rows.map((r) => String(r[employeeIdKey] ?? "").trim()).filter(Boolean);
  const [meta, permissions] = await Promise.all([
    loadEmpMeta([vid, ...targetIds]),
    loadViewerPermissionKeys(vid),
  ]);
  const viewer = meta.get(vid);
  return rows.map((row) => {
    const tid = String(row[employeeIdKey] ?? "").trim();
    if (!tid) return redactSalaryRow(row);
    const target = meta.get(tid);
    const ok = canViewEmployeeSalary({
      viewerId: vid,
      targetId: tid,
      viewerPermissions: permissions,
      viewerOrgRole: viewer?.role,
      targetOrgRole: target?.role,
      viewerDepartmentName: viewer?.department_name,
      targetDepartmentName: target?.department_name,
    });
    return ok ? row : redactSalaryRow(row);
  });
}

export function viewerIdFromRequest(req: {
  headers: Headers;
  nextUrl?: { searchParams: URLSearchParams };
  url?: string;
}): string {
  const h =
    req.headers.get("x-hrm-employee-id") ||
    req.headers.get("x-employee-id") ||
    "";
  if (h.trim()) return h.trim();
  const sp = req.nextUrl?.searchParams;
  if (sp) {
    return (
      sp.get("viewerId") ||
      sp.get("actorId") ||
      sp.get("viewer_employee_id") ||
      ""
    ).trim();
  }
  return "";
}
