import { pool } from "@/lib/db";
import { getAllOrgChartPhotos } from "@/lib/org-chart-photos-table";
import { orgDeptChipLabel } from "@/app/admin/roles-permissions/system-control-data";
import { DEPT_HEAD_NAME_HINT } from "@/lib/dept-heads";

export const HIERARCHY_TABLE = "hrm_employee_hierarchy";
export const TEAM_MEMBERS_TABLE = "hrm_team_members";

export type HierarchyPerson = {
  id: string;
  name: string;
  initials: string;
  role: string;
  jobTitle: string | null;
  departmentName: string | null;
  pseudonym: string | null;
  photo: string | null;
  status: string | null;
};

export type EmployeeHierarchyResult = {
  employeeId: string;
  role: string;
  departmentName: string | null;
  jobTitle: string | null;
  reportsTo: HierarchyPerson | null;
  teamMembers: HierarchyPerson[];
  isTeamLead: boolean;
};

type EmpRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  pseudonym: string | null;
  role: string | null;
  status: string | null;
  department_id: number | null;
  department_name: string | null;
  job_title: string | null;
};

const ROLE_RANK: Record<string, number> = {
  "BOD/CEO": 1,
  Management: 2,
  HOD: 2,
  Leader: 3,
  Officer: 4,
};

function roleRank(role: string | null | undefined): number {
  if (!role) return 99;
  return ROLE_RANK[role] ?? 99;
}

function fullName(row: Pick<EmpRow, "first_name" | "last_name">): string {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Employee";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "E";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function ensureHierarchyTables(conn: Awaited<ReturnType<typeof pool.getConnection>>) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ${HIERARCHY_TABLE} (
      employee_id INT UNSIGNED NOT NULL PRIMARY KEY,
      reports_to_employee_id INT UNSIGNED NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_reports_to (reports_to_employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ${TEAM_MEMBERS_TABLE} (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      team_lead_employee_id INT UNSIGNED NOT NULL,
      member_employee_id INT UNSIGNED NOT NULL,
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_member (member_employee_id),
      KEY idx_team_lead (team_lead_employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function fetchEmployees(conn: Awaited<ReturnType<typeof pool.getConnection>>): Promise<EmpRow[]> {
  const [rows] = await conn.execute(`
    SELECT
      e.id,
      e.first_name,
      e.last_name,
      e.pseudonym,
      e.role,
      e.status,
      j.department_id,
      d.name AS department_name,
      j.job_title
    FROM hrm_employees e
    LEFT JOIN employee_jobs j ON e.id = j.employee_id
    LEFT JOIN departments d ON j.department_id = d.id
    WHERE e.status IS NULL OR e.status IN ('enabled', 'active', 'Enabled', 'Active')
    ORDER BY e.id ASC
  `);
  return rows as EmpRow[];
}

async function fetchExplicitReportsTo(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  employeeId: number,
): Promise<number | null> {
  try {
    const [rows] = await conn.execute(
      `SELECT reports_to_employee_id FROM ${HIERARCHY_TABLE} WHERE employee_id = ? LIMIT 1`,
      [employeeId],
    );
    const row = (rows as { reports_to_employee_id: number | null }[])[0];
    return row?.reports_to_employee_id ?? null;
  } catch {
    return null;
  }
}

async function fetchTeamMemberIds(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  teamLeadId: number,
): Promise<number[]> {
  try {
    const [rows] = await conn.execute(
      `SELECT member_employee_id FROM ${TEAM_MEMBERS_TABLE} WHERE team_lead_employee_id = ?`,
      [teamLeadId],
    );
    return (rows as { member_employee_id: number }[]).map((r) => r.member_employee_id);
  } catch {
    return [];
  }
}

function inferReportsTo(emp: EmpRow, deptEmployees: EmpRow[]): EmpRow | null {
  const rank = roleRank(emp.role);
  if (rank <= 1) return null;

  const higher = deptEmployees.filter(
    (e) => e.id !== emp.id && roleRank(e.role) < rank,
  );
  if (higher.length === 0) {
    return null;
  }

  if (rank >= 5) {
    const lead = higher.find((e) => e.role === "Leader");
    if (lead) return lead;
  }
  if (rank >= 4) {
    const hod = higher.find((e) => e.role === "HOD");
    if (hod) return hod;
  }
  if (rank >= 3) {
    const mgmt = higher.find((e) => e.role === "Management");
    if (mgmt) return mgmt;
  }

  return [...higher].sort((a, b) => roleRank(a.role) - roleRank(b.role))[0] ?? null;
}

function resolvePhoto(
  employeeId: string,
  employeePhotos: Record<string, string>,
  shellAvatars: Record<string, string>,
): string | null {
  return (
    employeePhotos[employeeId] ??
    shellAvatars[employeeId] ??
    null
  );
}

function toPerson(
  row: EmpRow,
  employeePhotos: Record<string, string>,
  shellAvatars: Record<string, string>,
): HierarchyPerson {
  const name = fullName(row);
  const id = String(row.id);
  return {
    id,
    name,
    initials: initials(name),
    role: row.role || "Officer",
    jobTitle: row.job_title,
    departmentName: row.department_name,
    pseudonym: row.pseudonym,
    photo: resolvePhoto(id, employeePhotos, shellAvatars),
    status: row.status,
  };
}

function sameOrgFamily(a: EmpRow, b: EmpRow): boolean {
  const ca = orgDeptChipLabel(a.department_name);
  const cb = orgDeptChipLabel(b.department_name);
  if (ca && cb) return ca.toLowerCase() === cb.toLowerCase();
  if (a.department_id != null && b.department_id != null) {
    return Number(a.department_id) === Number(b.department_id);
  }
  return false;
}

/** Employees in the same org-dept family (IT includes Marketing). */
function orgFamilyEmployees(emp: EmpRow, all: EmpRow[]): EmpRow[] {
  return all.filter((e) => sameOrgFamily(emp, e));
}

/**
 * Dept head / CEO by org map:
 * Max → HIT + HR + Medical Billing + Finance | Mubeen → IT + CEst. (+ Marketing) | Joe → DM
 */
function findDeptHeadCeo(all: EmpRow[], chip: string | null): EmpRow | null {
  if (!chip) return null;
  const hl = DEPT_HEAD_NAME_HINT[chip];
  if (!hl) return null;
  const matches = all.filter((e) => {
    const first = String(e.first_name || "").trim().toLowerCase();
    const last = String(e.last_name || "").trim().toLowerCase();
    const full = `${first} ${last}`.trim();
    return (
      first === hl ||
      first.startsWith(hl) ||
      full.startsWith(hl) ||
      (hl === "max" && last === "miles") ||
      (hl === "mubeen" && (last.includes("chugtai") || last.includes("chughtai"))) ||
      (hl === "joe" && last === "white")
    );
  });
  if (!matches.length) return null;
  const ceo = matches.find((e) => roleRank(e.role) <= 1);
  return ceo || matches[0];
}

async function upsertReportsTo(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  employeeId: number,
  reportsToId: number | null,
): Promise<void> {
  try {
    await conn.execute(
      `INSERT INTO ${HIERARCHY_TABLE} (employee_id, reports_to_employee_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE reports_to_employee_id = VALUES(reports_to_employee_id)`,
      [employeeId, reportsToId],
    );
  } catch {
    /* mongo adapter / table missing — non-fatal */
  }
}

/** Persist Reporting Manager (used by Add Employee for Manager / Team Lead → CEO). */
export async function setEmployeeReportsTo(
  employeeId: string | number,
  reportsToEmployeeId: string | number | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const eid = Number(employeeId);
  if (!Number.isFinite(eid) || eid <= 0) {
    return { success: false, error: "Invalid employee id" };
  }
  const ridRaw = reportsToEmployeeId == null ? null : Number(reportsToEmployeeId);
  const rid =
    ridRaw != null && Number.isFinite(ridRaw) && ridRaw > 0 ? ridRaw : null;
  if (rid != null && rid === eid) {
    return { success: false, error: "Employee cannot report to themselves" };
  }
  const conn = await pool.getConnection();
  try {
    await ensureHierarchyTables(conn);
    await upsertReportsTo(conn, eid, rid);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    conn.release();
  }
}

/** Employee ids that report directly to this manager/CEO. */
export async function listDirectReportIds(
  managerEmployeeId: string | number,
): Promise<string[]> {
  const mid = Number(managerEmployeeId);
  if (!Number.isFinite(mid) || mid <= 0) return [];
  const conn = await pool.getConnection();
  try {
    await ensureHierarchyTables(conn);
    const [rows] = await conn.execute(
      `SELECT employee_id FROM ${HIERARCHY_TABLE} WHERE reports_to_employee_id = ?`,
      [mid],
    );
    return (rows as { employee_id: number }[]).map((r) => String(r.employee_id));
  } catch {
    return [];
  } finally {
    conn.release();
  }
}

export async function getEmployeeHierarchy(
  employeeId: string | number,
): Promise<EmployeeHierarchyResult | null> {
  const conn = await pool.getConnection();
  try {
    await ensureHierarchyTables(conn);
    const all = await fetchEmployees(conn);
    const targetId = Number(employeeId);
    const emp = all.find((e) => e.id === targetId);
    if (!emp) return null;

    // IT lead sees Marketing peers too (org chart fold).
    const deptEmployees = orgFamilyEmployees(emp, all);

    const photos = await getAllOrgChartPhotos();
    const employeePhotos = photos.employeePhotos;
    const shellAvatars = photos.shellBranding.employeeAvatars;

    let reportsToRow: EmpRow | null = null;
    const chip = orgDeptChipLabel(emp.department_name);
    const deptHead = findDeptHeadCeo(all, chip);
    const explicitManagerId = await fetchExplicitReportsTo(conn, targetId);

    if (explicitManagerId) {
      // Explicit Reporting Manager (e.g. Add Employee → any of 3 CEOs) wins.
      reportsToRow = all.find((e) => e.id === explicitManagerId) ?? null;
    } else {
      reportsToRow = inferReportsTo(emp, deptEmployees);
      if (!reportsToRow) {
        reportsToRow = inferReportsTo(emp, all);
      }

      // No explicit boss yet: Managers / TLs default to that dept's head CEO.
      if (deptHead && roleRank(emp.role) > 1 && emp.id !== deptHead.id) {
        const missingBoss = !reportsToRow;
        const managerNeedsCeo =
          roleRank(emp.role) <= 2 &&
          (!reportsToRow || roleRank(reportsToRow.role) > 1);
        if (missingBoss || managerNeedsCeo) {
          reportsToRow = deptHead;
          if (missingBoss) {
            void upsertReportsTo(conn, targetId, deptHead.id);
          }
        }
      }
    }

    let teamRows: EmpRow[] = [];
    const explicitMemberIds = await fetchTeamMemberIds(conn, targetId);
    if (explicitMemberIds.length > 0) {
      teamRows = explicitMemberIds
        .map((id) => all.find((e) => e.id === id))
        .filter((e): e is EmpRow => Boolean(e));
      // Still include rest of org-dept family so My Team shows full department
      const byId = new Set(teamRows.map((r) => r.id));
      for (const e of deptEmployees) {
        if (e.id !== emp.id && !byId.has(e.id)) {
          teamRows.push(e);
          byId.add(e.id);
        }
      }
    } else {
      // My Team = all employees in same org department family (excl. self)
      teamRows = deptEmployees.filter((e) => e.id !== emp.id);
    }

    const isTeamLead = teamRows.length > 0 || roleRank(emp.role) <= 4;

    return {
      employeeId: String(emp.id),
      role: emp.role || "Officer",
      departmentName: emp.department_name,
      jobTitle: emp.job_title,
      reportsTo: reportsToRow ? toPerson(reportsToRow, employeePhotos, shellAvatars) : null,
      teamMembers: teamRows.map((r) => toPerson(r, employeePhotos, shellAvatars)),
      isTeamLead,
    };
  } finally {
    conn.release();
  }
}
