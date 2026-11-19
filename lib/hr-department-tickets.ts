/**
 * Ticket inbox visibility + leave moderation.
 *
 * - HR inbox: ALL leave (any dept) + ALL non-leave (custom / HRM issue / etc.).
 *   Leave approve stays hierarchy-scoped; non-leave moderated by HR Manager / HR TL / CEO.
 * - Dept heads (Joe / Max / Mubeen): leave tickets for their owned depts in Ticket Inbox.
 * - Non-HR Team Leads: leave approve on Leaves page (not Ticket Inbox).
 * - Admin inbox: leave only (non-leave lives in HR inbox).
 */

import { pool } from "@/lib/db";
import { isHrDepartment } from "@/lib/access-control/hr-access";
import {
  isManagerOrgRole,
  isTeamLeadOrgRole,
  isCeoOrgRole,
} from "@/lib/org-role";
import { orgDeptChipLabel } from "@/app/admin/roles-permissions/system-control-data";
import {
  chipOwnedByHead,
  loadDeptHeadViewer,
  type DeptHeadViewer,
} from "@/lib/dept-heads";
import {
  resolveViewerDataScope,
  rowInViewerScope,
} from "@/lib/access-control/data-scope";

export type HrTicketViewer = {
  employeeId: string;
  departmentName: string | null;
  orgRole: string | null;
  accessRoleSlugs: string[];
  /** True: any HR staff (or CEO / dept head) — may open HR ticket inbox (view). */
  canViewHrInbox: boolean;
  /** True: HR Manager / HR Team Lead (or CEO) — may approve HR-dept tickets. */
  canModerateHrTickets: boolean;
  /** True: employee is in HR department. */
  isHrStaff: boolean;
  /** Mapped Joe / Max / Mubeen (or BOD/CEO). */
  deptHead: DeptHeadViewer | null;
};

function parseSlugs(raw: unknown, primary?: string | null): string[] {
  const out: string[] = [];
  if (primary) out.push(String(primary).trim());
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const v = String(s || "").trim();
      if (v) out.push(v);
    }
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          const v = String(s || "").trim();
          if (v) out.push(v);
        }
      }
    } catch {
      out.push(raw.trim());
    }
  }
  return [...new Set(out.map((s) => s.toLowerCase()))];
}

/** HR Manager or HR Team Lead (org role or access slug). */
export function isHrTicketModerator(opts: {
  departmentName?: string | null;
  orgRole?: string | null;
  accessRoleSlugs?: string[];
}): boolean {
  if (isCeoOrgRole(opts.orgRole)) return true;
  if (!isHrDepartment(opts.departmentName)) return false;
  if (isManagerOrgRole(opts.orgRole) || isTeamLeadOrgRole(opts.orgRole)) {
    return true;
  }
  const slugs = opts.accessRoleSlugs || [];
  return slugs.some(
    (s) =>
      s === "hr_manager" ||
      s === "team_lead_hr" ||
      s.includes("hr_manager") ||
      s.includes("team_lead_hr")
  );
}

export async function loadHrTicketViewer(
  employeeId: string | number | null | undefined
): Promise<HrTicketViewer | null> {
  const eid = String(employeeId || "").trim();
  if (!eid || !/^\d+$/.test(eid)) return null;

  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.role, e.access_role_slug, e.access_role_slugs,
              d.name AS department_name
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id
       WHERE e.id = ?
       LIMIT 1`,
      [Number(eid)]
    );
    const row = (
      rows as {
        id: number;
        role?: string | null;
        access_role_slug?: string | null;
        access_role_slugs?: unknown;
        department_name?: string | null;
      }[]
    )[0];
    if (!row) return null;

    const departmentName = row.department_name
      ? String(row.department_name).trim()
      : null;
    const orgRole = row.role ? String(row.role).trim() : null;
    const accessRoleSlugs = parseSlugs(row.access_role_slugs, row.access_role_slug);
    const isHrStaff = isHrDepartment(departmentName);
    const deptHead = await loadDeptHeadViewer(eid);
    const canViewHrInbox =
      isHrStaff || isCeoOrgRole(orgRole) || Boolean(deptHead?.isDeptHeadCeo);
    const canModerateHrTickets =
      isHrTicketModerator({
        departmentName,
        orgRole,
        accessRoleSlugs,
      }) || Boolean(deptHead?.headHint);

    return {
      employeeId: eid,
      departmentName,
      orgRole,
      accessRoleSlugs,
      canViewHrInbox,
      canModerateHrTickets,
      isHrStaff,
      deptHead,
    };
  } catch {
    return null;
  }
}

/** Cached set of employee ids whose department chip is HR. */
let hrIdCache: { at: number; ids: Set<string> } | null = null;
/** empId → org dept chip */
let empChipCache: { at: number; map: Map<string, string | null> } | null = null;

export async function getHrEmployeeIdSet(): Promise<Set<string>> {
  const now = Date.now();
  if (hrIdCache && now - hrIdCache.at < 60_000) return hrIdCache.ids;

  const ids = new Set<string>();
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, d.name AS department_name
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id`
    );
    for (const r of rows as { id: number; department_name?: string | null }[]) {
      if (isHrDepartment(r.department_name)) ids.add(String(r.id));
    }
  } catch {
    /* empty */
  }
  hrIdCache = { at: now, ids };
  return ids;
}

export async function getEmployeeDeptChipMap(): Promise<Map<string, string | null>> {
  const now = Date.now();
  if (empChipCache && now - empChipCache.at < 60_000) return empChipCache.map;
  const map = new Map<string, string | null>();
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, d.name AS department_name
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id`
    );
    for (const r of rows as { id: number; department_name?: string | null }[]) {
      map.set(String(r.id), orgDeptChipLabel(r.department_name));
    }
  } catch {
    /* empty */
  }
  empChipCache = { at: now, map };
  return map;
}

export function isHrDepartmentSubmitter(
  employeeId: string | number | null | undefined,
  hrIds: Set<string>
): boolean {
  const id = String(employeeId || "").trim();
  return Boolean(id && hrIds.has(id));
}

function isLeaveTicket(ticketType?: string | null): boolean {
  return String(ticketType || "").toLowerCase() === "leave";
}

/**
 * Filter tickets for list APIs.
 * - inbox=admin: leave only (dept heads / direct reports / classic leave visibility)
 * - inbox=hr: ALL leave + ALL non-leave (custom, HRM issue, …) for HR staff;
 *   dept heads (non-HR) still see owned leave only
 * - employeeId own list: always allow owner's tickets
 */
export function filterTicketsForInbox<
  T extends { employee_id?: string | number; ticket_type?: string | null },
>(
  tickets: T[],
  opts: {
    inbox: "admin" | "hr" | "own";
    viewer: HrTicketViewer | null;
    hrIds: Set<string>;
    empChips?: Map<string, string | null>;
    /** Employee ids that report directly to the viewer (Reporting Manager). */
    directReportIds?: Set<string>;
  }
): T[] {
  const { inbox, viewer, empChips, directReportIds } = opts;
  const reportsToMe = directReportIds || new Set<string>();

  if (inbox === "own") {
    if (!viewer) return [];
    return tickets.filter((t) => String(t.employee_id) === viewer.employeeId);
  }

  if (inbox === "hr") {
    if (!viewer?.canViewHrInbox) return [];
    const head = viewer.deptHead;
    const owned = new Set((head?.ownedChips || []).map((c) => c.toLowerCase()));

    // Pure dept head (Joe/Max/Mubeen) opening HR-mode inbox → owned leave + direct reports.
    if (head?.headHint && !viewer.isHrStaff) {
      return tickets.filter((t) => {
        if (!isLeaveTicket(t.ticket_type)) return false;
        const empId = String(t.employee_id || "").trim();
        if (reportsToMe.has(empId)) return true;
        if (!empChips || owned.size === 0) return false;
        const chip = empChips.get(empId);
        return Boolean(chip && owned.has(chip.toLowerCase()));
      });
    }

    // HR Manager / HR staff: every leave + every non-leave company-wide.
    return tickets;
  }

  // admin inbox — leave hierarchy only; non-leave is HR inbox.
  const head = viewer?.deptHead;
  const owned = new Set((head?.ownedChips || []).map((c) => c.toLowerCase()));

  return tickets.filter((t) => {
    const empId = String(t.employee_id || "").trim();
    if (!isLeaveTicket(t.ticket_type)) return false;

    // Direct reports' leave always visible to their Reporting Manager / CEO.
    if (reportsToMe.has(empId)) return true;

    // Dept head (Joe/Max/Mubeen): always include leave from owned chips.
    if (owned.size > 0 && empChips) {
      const chip = empChips.get(empId);
      if (chip && owned.has(chip.toLowerCase())) return true;
    }

    // Classic admin leave list (non-dept-head viewers without owned chips).
    if (!viewer?.deptHead?.headHint && !viewer?.isHrStaff) return true;
    return false;
  });
}

function isLeaveApproverRole(orgRole: string | null | undefined): boolean {
  return (
    isCeoOrgRole(orgRole) ||
    isManagerOrgRole(orgRole) ||
    isTeamLeadOrgRole(orgRole)
  );
}

/**
 * May change status (approve/reject/resolve/acknowledge) on this ticket?
 * Leave: Manager / Team Lead / dept head CEO in scope — not own ticket.
 * Non-leave: any HR staff (or CEO / HR moderator) — not own ticket.
 * Non-HR Team Lead: Leaves page only (not Ticket Inbox).
 */
export function canModerateTicketStatus(opts: {
  ticketEmployeeId: string | number;
  viewer: HrTicketViewer | null;
  hrIds: Set<string>;
  ticketType?: string | null;
  submitterChip?: string | null;
  /** When false, skip async scope (sync path). Prefer canModerateTicketStatusAsync. */
  inScope?: boolean;
}): boolean {
  const { ticketEmployeeId, viewer, ticketType, submitterChip, inScope } = opts;

  if (viewer && String(ticketEmployeeId) === viewer.employeeId) {
    return false;
  }

  const isLeave = isLeaveTicket(ticketType);

  // Non-leave (custom / HRM issue / …): any HR staff can acknowledge / resolve.
  if (!isLeave) {
    if (!viewer) return false;
    return (
      viewer.isHrStaff ||
      viewer.canModerateHrTickets ||
      isCeoOrgRole(viewer.orgRole)
    );
  }

  // Leave: HR officers (not Manager / Team Lead / CEO / dept head) — view only.
  if (
    viewer?.isHrStaff &&
    !isManagerOrgRole(viewer.orgRole) &&
    !isTeamLeadOrgRole(viewer.orgRole) &&
    !isCeoOrgRole(viewer.orgRole) &&
    !viewer.deptHead?.headHint
  ) {
    return false;
  }

  if (!viewer) return true; // classic admin inbox without viewer

  // Non-HR Team Lead (not Manager, not dept head) → Leaves page only.
  if (
    isTeamLeadOrgRole(viewer.orgRole) &&
    !viewer.isHrStaff &&
    !isManagerOrgRole(viewer.orgRole) &&
    !viewer.deptHead?.headHint
  ) {
    return false;
  }

  // Dept head: owned department leave, or anyone who reports to them.
  if (viewer.deptHead?.headHint) {
    if (typeof inScope === "boolean") return inScope;
    if (submitterChip) {
      return viewer.deptHead.ownedChips.some(
        (c) => c.toLowerCase() === submitterChip.toLowerCase()
      );
    }
    return true;
  }

  // HR Manager / Manager: must be in department scope when provided.
  if (typeof inScope === "boolean") {
    return inScope && isLeaveApproverRole(viewer.orgRole);
  }
  return isLeaveApproverRole(viewer.orgRole);
}

/** Async moderation check with department scope for leave. */
export async function canModerateTicketStatusAsync(opts: {
  ticketEmployeeId: string | number;
  viewer: HrTicketViewer | null;
  hrIds: Set<string>;
  ticketType?: string | null;
  submitterChip?: string | null;
}): Promise<boolean> {
  const { ticketEmployeeId, viewer, ticketType, submitterChip } = opts;
  const isLeave = isLeaveTicket(ticketType);

  let inScope: boolean | undefined;
  if (isLeave && viewer) {
    if (viewer.deptHead?.headHint) {
      const { listDirectReportIds } = await import(
        "@/lib/employee-hierarchy-table"
      );
      const directIds = await listDirectReportIds(viewer.employeeId);
      if (directIds.includes(String(ticketEmployeeId))) {
        inScope = true;
      } else if (submitterChip) {
        inScope = viewer.deptHead.ownedChips.some(
          (c) => c.toLowerCase() === submitterChip.toLowerCase()
        );
      } else {
        inScope = chipOwnedByHead(
          viewer.departmentName,
          viewer.deptHead.headHint
        );
        // Fall back to data-scope for submitter id.
        const scope = await resolveViewerDataScope(viewer.employeeId);
        // Dept heads with BOD/CEO see owned chips only — re-check via emp chip map.
        if (!submitterChip) {
          const chips = await getEmployeeDeptChipMap();
          const chip = chips.get(String(ticketEmployeeId));
          inScope = Boolean(
            chip &&
              viewer.deptHead.ownedChips.some(
                (c) => c.toLowerCase() === chip.toLowerCase()
              )
          );
          // Also allow if rowInViewerScope for non-mapped CEOs.
          if (!inScope && isCeoOrgRole(viewer.orgRole) && !viewer.deptHead.headHint) {
            inScope = rowInViewerScope(scope, { employeeId: ticketEmployeeId });
          }
        }
      }
    } else if (viewer.isHrStaff && isManagerOrgRole(viewer.orgRole)) {
      // HR Manager: approve only within hierarchy/scope (not company-wide approve).
      const scope = await resolveViewerDataScope(viewer.employeeId);
      // HR dept is company-wide in data-scope — for leave approve, still allow
      // HR Manager to approve HR-dept leave; other depts = view only unless TL/Manager scope.
      // User: "agar uski hierarchy nahi to na karay lekin view kar skay"
      // So HR Manager company-wide view, approve only if in scope.
      // But HR staff get mode=all in resolveViewerDataScope — that would allow all.
      // Override: for HR Manager leave approve, only same org family OR reports_to chain.
      const chips = await getEmployeeDeptChipMap();
      const submitterChipResolved =
        submitterChip || chips.get(String(ticketEmployeeId)) || null;
      const viewerChip = orgDeptChipLabel(viewer.departmentName);
      if (
        viewerChip &&
        submitterChipResolved &&
        viewerChip.toLowerCase() === submitterChipResolved.toLowerCase()
      ) {
        inScope = true;
      } else {
        // Not same dept — view only (unless CEO/dept head).
        inScope = false;
      }
    } else {
      const scope = await resolveViewerDataScope(viewer.employeeId);
      inScope = rowInViewerScope(scope, { employeeId: ticketEmployeeId });
    }
  }

  return canModerateTicketStatus({ ...opts, inScope });
}
