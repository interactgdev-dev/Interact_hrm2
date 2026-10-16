/**
 * Ticket inbox visibility + leave moderation.
 *
 * - HR Manager / HR staff inbox: ALL leave tickets (any dept) + HR-dept non-leave.
 *   Approve only within own department / hierarchy; otherwise view-only.
 * - Dept heads (Joe / Max / Mubeen): leave tickets for their owned depts in Ticket Inbox.
 * - Non-HR Team Leads: leave approve for hierarchy team on Leaves page (not Ticket Inbox).
 * - Admin inbox: non-HR submitter tickets (plus CEO dept leave when viewer is dept head).
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
 * - inbox=admin: non-HR submitters; dept heads also see their owned-dept leave tickets
 * - inbox=hr: ALL leave (HR staff) or owned/team leave (dept heads); + HR non-leave
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
    /** Hierarchy team (direct reports + team members) for leave visibility. */
    hierarchyTeamIds?: Set<string>;
  }
): T[] {
  const { inbox, viewer, hrIds, empChips, directReportIds, hierarchyTeamIds } =
    opts;
  const reportsToMe = directReportIds || new Set<string>();
  const teamIds = hierarchyTeamIds || reportsToMe;

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
        if (reportsToMe.has(empId) || teamIds.has(empId)) return true;
        if (!empChips || owned.size === 0) return false;
        const chip = empChips.get(empId);
        return Boolean(chip && owned.has(chip.toLowerCase()));
      });
    }

    // HR Manager / HR staff: every leave ticket company-wide + HR-dept other tickets.
    // Approve stays department-scoped via canModerateTicketStatusAsync.
    return tickets.filter((t) => {
      if (isLeaveTicket(t.ticket_type)) return true;
      return isHrDepartmentSubmitter(t.employee_id, hrIds);
    });
  }

  // admin inbox
  const head = viewer?.deptHead;
  const owned = new Set((head?.ownedChips || []).map((c) => c.toLowerCase()));

  return tickets.filter((t) => {
    const empId = String(t.employee_id || "").trim();
    const isLeave = isLeaveTicket(t.ticket_type);

    // Direct reports' leave always visible to their Reporting Manager / CEO.
    if (isLeave && reportsToMe.has(empId)) return true;

    // Dept head (Joe/Max/Mubeen): always include leave from owned chips.
    if (isLeave && owned.size > 0 && empChips) {
      const chip = empChips.get(empId);
      if (chip && owned.has(chip.toLowerCase())) return true;
    }

    // Classic admin: hide HR-department submitters (they live in HR inbox).
    if (isHrDepartmentSubmitter(t.employee_id, hrIds)) return false;
    return true;
  });
}

function slugLooksLikeTeamLead(slugs: string[] | undefined): boolean {
  return (slugs || []).some((s) => {
    const v = String(s || "").toLowerCase();
    return (
      v.startsWith("team_lead") ||
      v.includes("team_lead_") ||
      v.includes("team-lead") ||
      (v.includes("lead") && !v.includes("leaderboard"))
    );
  });
}

function slugLooksLikeManager(slugs: string[] | undefined): boolean {
  return (slugs || []).some((s) => {
    const v = String(s || "").toLowerCase();
    if (v.startsWith("team_lead") || v.includes("team_lead_")) return false;
    return v.includes("manager") || v.endsWith("_mgr") || v.includes("_manager");
  });
}

/** Org role OR System Control slug (e.g. team_lead_dm) — many TLs only have the slug. */
export function viewerIsTeamLead(viewer: HrTicketViewer | null): boolean {
  if (!viewer) return false;
  return isTeamLeadOrgRole(viewer.orgRole) || slugLooksLikeTeamLead(viewer.accessRoleSlugs);
}

export function viewerIsManager(viewer: HrTicketViewer | null): boolean {
  if (!viewer) return false;
  return isManagerOrgRole(viewer.orgRole) || slugLooksLikeManager(viewer.accessRoleSlugs);
}

function isLeaveApproverViewer(viewer: HrTicketViewer | null): boolean {
  if (!viewer) return false;
  return (
    isCeoOrgRole(viewer.orgRole) ||
    viewerIsManager(viewer) ||
    viewerIsTeamLead(viewer) ||
    Boolean(viewer.deptHead?.headHint)
  );
}

function empIdInList(
  employeeId: string | number,
  ids: Iterable<string | number>,
): boolean {
  const want = String(employeeId ?? "").trim();
  if (!want) return false;
  for (const id of ids) {
    if (String(id ?? "").trim() === want) return true;
  }
  return false;
}

/**
 * May change status (approve/reject/resolve) on this ticket?
 * Leave: Manager / Team Lead / dept head CEO in scope — not own ticket.
 * Non-HR Team Lead / Manager: approve on Leaves page (Ticket Inbox menu hidden).
 * HR officers: view only.
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
  const { ticketEmployeeId, viewer, hrIds, ticketType, submitterChip, inScope } =
    opts;

  if (viewer && String(ticketEmployeeId) === viewer.employeeId) {
    return false;
  }

  const isLeave = isLeaveTicket(ticketType);

  // HR officers (not Manager / Team Lead / CEO / dept head) — view only.
  if (
    viewer?.isHrStaff &&
    !viewerIsManager(viewer) &&
    !viewerIsTeamLead(viewer) &&
    !isCeoOrgRole(viewer.orgRole) &&
    !viewer.deptHead?.headHint
  ) {
    return false;
  }

  if (isLeave) {
    if (!viewer) return true; // classic admin inbox without viewer

    // Dept head (Joe / Max / Mubeen): owned department leave, or direct reports (e.g. TL).
    if (viewer.deptHead?.headHint) {
      if (typeof inScope === "boolean") return inScope;
      if (submitterChip) {
        return viewer.deptHead.ownedChips.some(
          (c) => c.toLowerCase() === submitterChip.toLowerCase()
        );
      }
      return true;
    }

    // Team Lead / Manager / HR Manager / CEO: approve only when inScope says so.
    if (typeof inScope === "boolean") {
      return inScope && isLeaveApproverViewer(viewer);
    }
    return isLeaveApproverViewer(viewer);
  }

  const hrTicket = isHrDepartmentSubmitter(ticketEmployeeId, hrIds);

  if (hrTicket) {
    if (!viewer) return false;
    return viewer.canModerateHrTickets;
  }

  if (!viewer) return true;
  if (
    isCeoOrgRole(viewer.orgRole) ||
    isManagerOrgRole(viewer.orgRole) ||
    Boolean(viewer.deptHead?.headHint)
  ) {
    return true;
  }
  return false;
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
    } else if (viewer.isHrStaff && viewerIsManager(viewer)) {
      // HR Manager: company-wide view; approve only own dept (same org chip).
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
        inScope = false;
      }
    } else if (viewerIsTeamLead(viewer) && !viewerIsManager(viewer)) {
      // Team Lead: hierarchy team first, then same department (so Approve shows
      // even when Assign Hierarchy / team_members rows are missing).
      const { listHierarchyVisibleEmployeeIds } = await import(
        "@/lib/employee-hierarchy-table"
      );
      const teamIds = await listHierarchyVisibleEmployeeIds(viewer.employeeId);
      inScope = empIdInList(ticketEmployeeId, teamIds);
      if (!inScope) {
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
        }
      }
      if (!inScope) {
        const scope = await resolveViewerDataScope(viewer.employeeId);
        inScope = rowInViewerScope(scope, { employeeId: ticketEmployeeId });
      }
    } else {
      // Manager / other leave approvers: department / data-scope.
      const scope = await resolveViewerDataScope(viewer.employeeId);
      inScope = rowInViewerScope(scope, { employeeId: ticketEmployeeId });
    }
  }

  return canModerateTicketStatus({ ...opts, inScope });
}
