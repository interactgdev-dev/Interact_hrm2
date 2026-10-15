import { pool } from "@/lib/db";
import { orgDeptChipLabel } from "@/app/admin/roles-permissions/system-control-data";
import {
  loadEmployeePermissionOverrides,
  loadPermissionsForRole,
  resolveEmployeeAccessRoleSlug,
} from "@/lib/access-control/store";
import {
  getEmployeeHierarchy,
  TEAM_MEMBERS_TABLE,
} from "@/lib/employee-hierarchy-table";
import {
  isCeoOrgRole,
  permissionGrantsAllDepartments,
  permissionImpliesDepartmentScope,
} from "@/lib/org-role";
import { basePermissionKey, permissionSetHas } from "@/lib/access-control/permission-scope";
import { isHrDepartment } from "@/lib/access-control/hr-access";

export type ViewerDataScope = {
  mode: "all" | "department" | "team" | "self";
  /** Canonical org chip e.g. IT (Marketing folds into IT). */
  orgChip: string | null;
  /** Allowed raw department names from DB (e.g. IT, Marketing). */
  departmentNames: string[];
  /** Employee ids in scope (string). Always includes self when scoped. */
  employeeIds: string[];
  /** Viewer's overall org role from Add Employee (`hrm_employees.role`). */
  orgRole: string | null;
};

type EmpDeptRow = {
  id: number;
  role: string | null;
  department_id: number | null;
  department_name: string | null;
};

function normName(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase();
}

/** Same org family? Marketing ↔ IT via orgDeptChipLabel. */
export function sameOrgDeptFamily(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = orgDeptChipLabel(a);
  const cb = orgDeptChipLabel(b);
  if (!ca || !cb) return normName(a) === normName(b) && Boolean(normName(a));
  return ca.toLowerCase() === cb.toLowerCase();
}

async function loadEmployeesWithDept(): Promise<EmpDeptRow[]> {
  const [rows] = await pool.execute(`
    SELECT
      e.id,
      e.role,
      j.department_id,
      d.name AS department_name
    FROM hrm_employees e
    LEFT JOIN employee_jobs j ON e.id = j.employee_id
    LEFT JOIN departments d ON j.department_id = d.id
    WHERE e.status IS NULL OR e.status IN ('enabled', 'active', 'Enabled', 'Active')
  `);
  return rows as EmpDeptRow[];
}

function collectDeptNamesForChip(
  all: EmpDeptRow[],
  chip: string | null,
  fallbackName: string | null,
): string[] {
  if (!chip) {
    return fallbackName ? [fallbackName] : [];
  }
  const names = new Set<string>();
  for (const e of all) {
    const label = orgDeptChipLabel(e.department_name);
    if (label && label.toLowerCase() === chip.toLowerCase() && e.department_name) {
      names.add(String(e.department_name).trim());
    }
  }
  if (fallbackName) names.add(fallbackName);
  if (chip.toLowerCase() === "it") {
    for (const e of all) {
      const raw = normName(e.department_name);
      if ((raw === "marketing" || raw.includes("marketing")) && e.department_name) {
        names.add(String(e.department_name).trim());
      }
    }
  }
  return [...names];
}

function inOrgFamily(
  e: EmpDeptRow,
  orgChip: string | null,
  self: EmpDeptRow | undefined,
): boolean {
  if (orgChip) {
    const label = orgDeptChipLabel(e.department_name);
    if (label && label.toLowerCase() === orgChip.toLowerCase()) return true;
    if (orgChip.toLowerCase() === "it") {
      const raw = normName(e.department_name);
      if (raw === "marketing" || raw.includes("marketing")) return true;
    }
    return false;
  }
  return (
    self?.department_id != null &&
    e.department_id != null &&
    Number(e.department_id) === Number(self.department_id)
  );
}

async function loadViewerPermissionKeys(eid: string): Promise<string[]> {
  const emp = await resolveEmployeeAccessRoleSlug(eid);
  const override = await loadEmployeePermissionOverrides(emp.employeeId);
  if (override != null) {
    return override.filter((k) => k !== "__custom__");
  }
  const sets = await Promise.all(emp.roleSlugs.map((slug) => loadPermissionsForRole(slug)));
  return [...new Set(sets.flat())];
}

function emptyScope(orgRole: string | null = null): ViewerDataScope {
  return {
    mode: "all",
    orgChip: null,
    departmentNames: [],
    employeeIds: [],
    orgRole,
  };
}

/**
 * Resolve which employees / departments a viewer may see.
 *
 * Scope rules (overall role from Add Employee):
 * - CEO (BOD/CEO) → all departments
 * - HR department → company-wide for attendance / leave / breaks / ops
 *   (salary amounts still gated separately — see salary-visibility)
 * - Explicit All-departments column grants (`…@all_departments`) or legacy
 *   `data.scope.all_departments` → company-wide
 * - Manager / Team Lead / Officer / staff with Own-department column grants
 *   → their confirmed department only (never company-wide by default)
 * - No such perms → all (admin / unscoped pages)
 */
export async function resolveViewerDataScope(
  viewerEmployeeId: string | number,
): Promise<ViewerDataScope> {
  const eid = String(viewerEmployeeId || "").trim();
  if (!eid || !/^\d+$/.test(eid)) {
    return emptyScope();
  }

  const all = await loadEmployeesWithDept();
  const self = all.find((e) => String(e.id) === eid);
  const orgRole = self?.role ? String(self.role) : null;
  const selfDeptName = self?.department_name ? String(self.department_name).trim() : null;

  // CEO always sees every department
  if (isCeoOrgRole(orgRole)) {
    return emptyScope(orgRole);
  }

  // HR staff need company-wide ops data (payroll / attendance / leaves across depts)
  if (isHrDepartment(selfDeptName)) {
    return emptyScope(orgRole);
  }

  const perms = new Set(await loadViewerPermissionKeys(eid));

  // Explicit company-wide toggle from System Control
  if (permissionGrantsAllDepartments(perms)) {
    return emptyScope(orgRole);
  }

  const needsDeptScope = [...perms].some(permissionImpliesDepartmentScope);
  if (!needsDeptScope) {
    return emptyScope(orgRole);
  }

  const orgChip = orgDeptChipLabel(selfDeptName);

  const departmentNames = collectDeptNamesForChip(all, orgChip, selfDeptName);
  const idSet = new Set<string>();
  idSet.add(eid);
  for (const e of all) {
    if (inOrgFamily(e, orgChip, self)) idSet.add(String(e.id));
  }

  try {
    const hier = await getEmployeeHierarchy(eid);
    for (const m of hier?.teamMembers || []) {
      if (m?.id) idSet.add(String(m.id));
    }
  } catch {
    /* ignore */
  }

  try {
    const [rows] = await pool.execute(
      `SELECT member_employee_id FROM ${TEAM_MEMBERS_TABLE} WHERE team_lead_employee_id = ?`,
      [Number(eid)],
    );
    for (const r of rows as { member_employee_id: number }[]) {
      idSet.add(String(r.member_employee_id));
    }
  } catch {
    /* table may not exist yet */
  }

  const hasDept =
    permissionSetHas(perms, "department.attendance.view") ||
    permissionSetHas(perms, "department.breaks.view") ||
    permissionSetHas(perms, "department.leaves.view") ||
    permissionSetHas(perms, "department.monthly.view") ||
    permissionSetHas(perms, "people.employee_list.view") ||
    [...perms].some((raw) => {
      const k = basePermissionKey(raw);
      return (
        k.startsWith("attendance.") ||
        k.startsWith("leave.") ||
        k.startsWith("people.") ||
        k.startsWith("payroll.") ||
        k.startsWith("ops.") ||
        k.startsWith("shifts.")
      );
    });

  return {
    mode: hasDept ? "department" : "team",
    orgChip,
    departmentNames,
    employeeIds: [...idSet],
    orgRole,
  };
}

export function rowInViewerScope(
  scope: ViewerDataScope,
  opts: {
    employeeId?: string | number | null;
    departmentName?: string | null;
  },
): boolean {
  if (scope.mode === "all") return true;
  const id = opts.employeeId != null ? String(opts.employeeId).trim() : "";
  if (id && scope.employeeIds.includes(id)) return true;
  const dept = opts.departmentName != null ? String(opts.departmentName).trim() : "";
  if (dept && scope.departmentNames.some((d) => normName(d) === normName(dept))) {
    return true;
  }
  if (
    dept &&
    scope.orgChip &&
    orgDeptChipLabel(dept)?.toLowerCase() === scope.orgChip.toLowerCase()
  ) {
    return true;
  }
  return false;
}
