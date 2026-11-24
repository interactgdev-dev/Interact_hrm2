import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { broadcastWsEvent } from "@/lib/ws-broadcast";
import {
  canApproveStep1,
  canApproveStep2,
  leaveDecidedById,
  leaveStatusLabel,
  normStep,
  overallLeaveStatus,
} from "@/lib/leave-approval";
import { pool } from "@/lib/db";
import {
  resolveViewerDataScope,
  rowInViewerScope,
} from "@/lib/access-control/data-scope";
import {
  isCeoOrgRole,
  isManagerOrgRole,
  isTeamLeadOrgRole,
  orgRoleLabel,
} from "@/lib/org-role";
import {
  backfillLeavesFromTickets,
  syncTicketFromLeaveDecision,
} from "@/lib/leave-ticket-sync";
import {
  assertLeaveBalanceAllowsRequest,
  getEmployeeLeaveBalance,
} from "@/lib/leave-balance";
import { resolveEmployeeDisplayName } from "@/lib/dept-heads";

/** Same ids as admin portal login (auth page / employee-shell). */
const ADMIN_LOGIN_IDS = new Set(["admin@interact.com", "interactadmin", "admin"]);

async function assertLeaveApprover(
  actorId: string | null,
  leaveEmployeeId: string | number | null | undefined,
  opts?: { adminActor?: boolean; loginId?: string | null },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  // Pure Admin portal (no linked employeeId) may still approve / reject any leave.
  if (opts?.adminActor) {
    const lid = String(opts.loginId || "")
      .trim()
      .toLowerCase();
    if (ADMIN_LOGIN_IDS.has(lid)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: "Admin session required to act without employee actor",
      status: 403,
    };
  }

  if (!actorId || !/^\d+$/.test(actorId)) {
    return {
      ok: false,
      error: "Manager or Team Lead required to approve leave — actor required",
      status: 403,
    };
  }

  // Nobody may approve their own leave.
  if (
    leaveEmployeeId != null &&
    String(leaveEmployeeId).trim() === String(actorId).trim()
  ) {
    return {
      ok: false,
      error: "You cannot approve or reject your own leave",
      status: 403,
    };
  }

  const [roleRows] = (await query(
    `SELECT role FROM hrm_employees WHERE id = ? LIMIT 1`,
    [Number(actorId)],
  )) as any;
  const actorRole = Array.isArray(roleRows) ? roleRows[0]?.role : null;

  const scope = await resolveViewerDataScope(actorId);
  // CEO / HR (company-wide scope) may approve or reject (incl. after TL approve).
  if (scope.mode === "all" || isCeoOrgRole(actorRole)) {
    return { ok: true };
  }

  // Manager / Team Lead — department / team scope only.
  if (!isManagerOrgRole(actorRole) && !isTeamLeadOrgRole(actorRole)) {
    return {
      ok: false,
      error: "Leave approval is limited to Managers, Team Leads, HR, and CEO.",
      status: 403,
    };
  }

  if (
    !rowInViewerScope(scope, {
      employeeId: leaveEmployeeId,
    })
  ) {
    return {
      ok: false,
      error: "You can only approve leave for employees in your department scope",
      status: 403,
    };
  }
  return { ok: true };
}

/** Two-step leave is disabled — single Approve / Reject only (Leave page + non-HR TLs). */
async function isTwoStepEnabled(): Promise<boolean> {
  return false;
}

// POST: Submit a new leave request
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      employee_id,
      employee_name,
      leave_category,
      start_date,
      end_date,
      total_days,
      reason,
      document_paths,
    } = body;
    if (!employee_id || !leave_category || !start_date || !end_date || !total_days) {
      return NextResponse.json({ success: false, error: "Missing required fields" });
    }

    const bal = await getEmployeeLeaveBalance(employee_id);
    if (bal.success) {
      const gate = assertLeaveBalanceAllowsRequest(bal, {
        leaveCategory: leave_category,
        totalDays: Number(total_days) || 1,
      });
      if (!gate.ok) {
        return NextResponse.json({
          success: false,
          error: gate.error,
          annualBalance: bal.annualBalance,
          bereavementBalance: bal.bereavementBalance,
          maternityBalance: bal.maternityBalance,
          paternityBalance: bal.paternityBalance,
        });
      }
    }

    try {
      await query(
        `INSERT INTO employee_leaves
          (employee_id, employee_name, leave_category, start_date, end_date, total_days, reason, status,
           step1_status, step2_status, document_paths, requested_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', 'pending', ?, NOW(), NOW())`,
        [
          employee_id,
          employee_name || "",
          leave_category,
          start_date,
          end_date,
          total_days,
          reason || "",
          JSON.stringify(document_paths || []),
        ],
      );
    } catch {
      // Fallback if migration columns not applied yet
      await query(
        `INSERT INTO employee_leaves
          (employee_id, employee_name, leave_category, start_date, end_date, total_days, reason, status,
           document_paths, requested_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())`,
        [
          employee_id,
          employee_name || "",
          leave_category,
          start_date,
          end_date,
          total_days,
          reason || "",
          JSON.stringify(document_paths || []),
        ],
      );
    }
    broadcastWsEvent({ type: "leave_update" });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// GET: Fetch leave requests
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeesParam = searchParams.get("employees");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const status = searchParams.get("status");
    const viewerId = String(
      searchParams.get("viewerId") ||
        searchParams.get("viewer_id") ||
        req.headers.get("x-hrm-employee-id") ||
        req.headers.get("x-employee-id") ||
        "",
    ).trim();

    // Sync leave tickets → employee_leaves (fixes approved tickets missing Leave status).
    try {
      await backfillLeavesFromTickets();
    } catch {
      /* non-fatal */
    }

    let sql = "SELECT * FROM employee_leaves WHERE 1=1";
    const params: any[] = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    // Prefer explicit employees list; else TL/Manager department scope via viewerId.
    let scopedEmployees: string[] | null = null;
    if (employeesParam) {
      scopedEmployees = employeesParam
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    } else if (viewerId && /^\d+$/.test(viewerId)) {
      try {
        const scope = await resolveViewerDataScope(viewerId);
        if (scope.mode !== "all" && scope.employeeIds.length > 0) {
          scopedEmployees = scope.employeeIds.map(String);
        }
      } catch {
        /* keep unscoped if scope fails */
      }
    }
    if (scopedEmployees && scopedEmployees.length > 0) {
      sql += ` AND employee_id IN (${scopedEmployees.map(() => "?").join(",")})`;
      params.push(...scopedEmployees);
    } else if (viewerId && /^\d+$/.test(viewerId) && !employeesParam) {
      // Scoped viewer with empty team → return nothing (do not leak company-wide).
      try {
        const scope = await resolveViewerDataScope(viewerId);
        if (scope.mode !== "all") {
          return NextResponse.json({ success: true, leaves: [] });
        }
      } catch {
        /* ignore */
      }
    }

    // Belong-to-range by start_date (not overlap) so a November filter does not
    // pull prior-month leaves that merely spill into the window.
    if (fromDate && toDate) {
      sql += " AND start_date >= ? AND start_date <= ?";
      params.push(fromDate, toDate);
    } else if (fromDate) {
      sql += " AND start_date >= ?";
      params.push(fromDate);
    } else if (toDate) {
      sql += " AND start_date <= ?";
      params.push(toDate);
    }

    sql += " ORDER BY id DESC";
    const [rows] = (await query(sql, params)) as any;
    /** Newest leave request first — use submit time / id, not approve updated_at. */
    const leaveRecency = (l: any) => {
      for (const c of [l?.requested_at, l?.created_at]) {
        const raw = String(c || "").trim();
        if (!raw) continue;
        const ms = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
        if (Number.isFinite(ms) && ms > 0) return ms;
      }
      return Number(l?.id) || 0;
    };

    // Collapse sync clones (same [ticket:N] repeated 100+ times) before listing.
    const { dedupeLeavesByTicketMarker } = await import("@/lib/leave-row-dedupe");
    const rawLeaves = dedupeLeavesByTicketMarker(
      Array.isArray(rows) ? rows : [],
    );
    const actorIds = [
      ...new Set(
        rawLeaves
          .map((l: any) => leaveDecidedById(l))
          .filter((id): id is string => Boolean(id && /^\d+$/.test(id))),
      ),
    ];
    const nameById = new Map<string, string>();
    const roleById = new Map<string, string>();
    if (actorIds.length) {
      try {
        const placeholders = actorIds.map(() => "?").join(",");
        const [nameRows] = await pool.execute(
          `SELECT id, first_name, last_name, pseudonym, role FROM hrm_employees
           WHERE id IN (${placeholders})`,
          actorIds.map((id) => Number(id)),
        );
        for (const r of nameRows as {
          id: number;
          first_name?: string | null;
          last_name?: string | null;
          pseudonym?: string | null;
          role?: string | null;
        }[]) {
          const full = `${r.first_name || ""} ${r.last_name || ""}`.trim();
          nameById.set(
            String(r.id),
            full || (r.pseudonym ? String(r.pseudonym).trim() : "") || String(r.id),
          );
          roleById.set(String(r.id), String(r.role || "").trim());
        }
      } catch {
        /* names optional */
      }
    }

    const leaves = rawLeaves
      .map((l: any) => {
        const decidedBy = leaveDecidedById(l);
        const decidedName =
          (decidedBy && nameById.get(decidedBy)) ||
          (decidedBy && !/^\d+$/.test(decidedBy) ? decidedBy : null);
        const roleLabel =
          decidedBy && roleById.has(decidedBy)
            ? orgRoleLabel(roleById.get(decidedBy))
            : null;
        const overall = overallLeaveStatus(l);
        const statusBy =
          decidedName && (overall === "approved" || overall === "rejected")
            ? {
                name: decidedName,
                employee_id: decidedBy && /^\d+$/.test(decidedBy) ? decidedBy : null,
                role: roleLabel,
              }
            : null;
        return {
          ...l,
          step1_status: normStep(
            l.step1_status ?? (l.status === "approved" ? "approved" : "pending"),
          ),
          step2_status: normStep(
            l.step2_status ?? (l.status === "approved" ? "approved" : "pending"),
          ),
          status_label: leaveStatusLabel(l),
          overall_status: overall,
          approved_by: decidedBy,
          approved_by_name: decidedName,
          approved_by_role: roleLabel,
          status_by: statusBy,
          decided_by_label:
            decidedName && (overall === "approved" || overall === "rejected")
              ? `${overall === "rejected" ? "Rejected by" : "Approved by"} ${decidedName}${
                  roleLabel ? ` (${roleLabel})` : ""
                }${decidedBy && /^\d+$/.test(decidedBy) ? ` · ${decidedBy}` : ""}`
              : null,
        };
      })
      .sort((a: any, b: any) => {
        const diff = leaveRecency(b) - leaveRecency(a);
        return diff !== 0 ? diff : (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    return NextResponse.json({ success: true, leaves });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * PATCH: Two-step approve / reject
 * body: { id, action: 'approve_step1' | 'approve_step2' | 'approve' | 'reject', admin_remark?, actor? }
 * - approve_step1: 1st step only (status stays pending)
 * - approve_step2: 2nd step → status=approved (monthly attendance deduction 0%)
 * - approve: legacy single-step OR smart next step when two_step on
 * - reject: reject at any pending stage
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, admin_remark, actor } = body;
    let action = String(body.action || "").toLowerCase();
    const legacyStatus = body.status ? String(body.status).toLowerCase() : "";
    const adminActor = Boolean(body.adminActor || body.admin_actor);
    const loginId = String(body.loginId || body.login_id || "").trim();

    if (!id) {
      return NextResponse.json({ success: false, error: "Invalid data" });
    }

    if (!action && legacyStatus === "rejected") action = "reject";
    if (!action && legacyStatus === "approved") action = "approve";

    if (!["approve_step1", "approve_step2", "approve", "reject"].includes(action)) {
      return NextResponse.json({ success: false, error: "Invalid data" });
    }

    const [rows] = (await query(`SELECT * FROM employee_leaves WHERE id = ? LIMIT 1`, [id])) as any;
    const leave = Array.isArray(rows) ? rows[0] : null;
    if (!leave) {
      return NextResponse.json({ success: false, error: "Leave not found" }, { status: 404 });
    }

    const twoStep = await isTwoStepEnabled();
    const actorId = actor != null && String(actor).trim() !== "" ? String(actor).trim() : null;
    const actorName = actorId
      ? await resolveEmployeeDisplayName(actorId)
      : adminActor
        ? loginId || "Admin"
        : null;

    async function mirrorTicket(status: "approved" | "rejected") {
      try {
        await syncTicketFromLeaveDecision({
          leaveReason: leave.reason,
          status,
          actorId,
          actorName,
        });
      } catch {
        /* non-fatal */
      }
    }

    if (action === "reject" || action.startsWith("approve")) {
      const gate = await assertLeaveApprover(actorId, leave.employee_id, {
        adminActor,
        loginId,
      });
      if (!gate.ok) {
        return NextResponse.json(
          { success: false, error: gate.error },
          { status: gate.status },
        );
      }
    }

    if (action === "reject") {
      const s1 = normStep(leave.step1_status);
      const nextStep1 = s1 === "approved" ? "approved" : "rejected";
      try {
        await query(
          `UPDATE employee_leaves SET status = 'rejected', step1_status = ?, step2_status = 'rejected',
            step2_by = COALESCE(step2_by, ?), admin_remark = ?, updated_at = NOW() WHERE id = ?`,
          [nextStep1, actorId, admin_remark || "", id],
        );
      } catch {
        await query(
          `UPDATE employee_leaves SET status = 'rejected', admin_remark = ?, updated_at = NOW() WHERE id = ?`,
          [admin_remark || "", id],
        );
      }
      await mirrorTicket("rejected");
      broadcastWsEvent({ type: "leave_update" });
      // Rejected: balance unchanged (only approved leaves deduct).
      const bal = await getEmployeeLeaveBalance(leave.employee_id);
      return NextResponse.json({
        success: true,
        status: "rejected",
        balance: bal.success
          ? {
              annualBalance: bal.annualBalance,
              bereavementBalance: bal.bereavementBalance,
              maternityBalance: bal.maternityBalance,
              maternityAllowance: bal.maternityAllowance,
              paternityBalance: bal.paternityBalance,
              paternityAllowance: bal.paternityAllowance,
            }
          : null,
      });
    }

    async function balanceAfterApprove() {
      const bal = await getEmployeeLeaveBalance(leave.employee_id);
      return bal.success
        ? {
            annualBalance: bal.annualBalance,
            annualAllowance: bal.annualAllowance,
            bereavementBalance: bal.bereavementBalance,
            maternityBalance: bal.maternityBalance,
            maternityAllowance: bal.maternityAllowance,
            paternityBalance: bal.paternityBalance,
            paternityAllowance: bal.paternityAllowance,
          }
        : null;
    }

    // Resolve smart "approve" to the next required step
    if (action === "approve") {
      if (!twoStep) {
        await query(
          `UPDATE employee_leaves SET status = 'approved',
            step1_status = 'approved', step2_status = 'approved',
            step1_by = COALESCE(step1_by, ?), step2_by = COALESCE(step2_by, ?),
            step1_at = COALESCE(step1_at, NOW()), step2_at = COALESCE(step2_at, NOW()),
            updated_at = NOW() WHERE id = ?`,
          [actorId, actorId, id],
        );
        await mirrorTicket("approved");
        broadcastWsEvent({ type: "leave_update" });
        return NextResponse.json({
          success: true,
          status: "approved",
          approved_by: actorId,
          approved_by_name: actorName,
          balance: await balanceAfterApprove(),
        });
      }
      if (canApproveStep1(leave)) action = "approve_step1";
      else if (canApproveStep2(leave)) action = "approve_step2";
      else {
        return NextResponse.json({
          success: false,
          error: "Leave is not awaiting approval",
        });
      }
    }

    if (action === "approve_step1") {
      if (!canApproveStep1(leave) && twoStep) {
        return NextResponse.json({ success: false, error: "1st step already done or not pending" });
      }
      if (!twoStep) {
        await query(
          `UPDATE employee_leaves SET status = 'approved',
            step1_status = 'approved', step2_status = 'approved',
            step1_by = ?, step2_by = ?, step1_at = NOW(), step2_at = NOW(),
            updated_at = NOW() WHERE id = ?`,
          [actorId, actorId, id],
        );
        await mirrorTicket("approved");
        broadcastWsEvent({ type: "leave_update" });
        return NextResponse.json({
          success: true,
          status: "approved",
          step: 1,
          approved_by: actorId,
          approved_by_name: actorName,
          balance: await balanceAfterApprove(),
        });
      }
      await query(
        `UPDATE employee_leaves SET step1_status = 'approved', step1_by = ?, step1_at = NOW(),
          status = 'pending', updated_at = NOW() WHERE id = ?`,
        [actorId, id],
      );
      broadcastWsEvent({ type: "leave_update" });
      return NextResponse.json({
        success: true,
        status: "pending",
        step: 1,
        status_label: "pending — 2nd step",
      });
    }

    if (action === "approve_step2") {
      if (twoStep && !canApproveStep2(leave)) {
        return NextResponse.json({
          success: false,
          error: "2nd step requires 1st step approval first",
        });
      }
      await query(
        `UPDATE employee_leaves SET step1_status = 'approved', step2_status = 'approved',
          step2_by = ?, step2_at = NOW(),
          status = 'approved', updated_at = NOW() WHERE id = ?`,
        [actorId, id],
      );
      await mirrorTicket("approved");
      broadcastWsEvent({ type: "leave_update" });
      return NextResponse.json({
        success: true,
        status: "approved",
        step: 2,
        status_label: "approved",
        approved_by: actorId,
        approved_by_name: actorName,
        balance: await balanceAfterApprove(),
      });
    }

    return NextResponse.json({ success: false, error: "Invalid data" });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
