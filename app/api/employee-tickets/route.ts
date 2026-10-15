import { NextRequest, NextResponse } from "next/server";
import { broadcastWsEvent } from "@/lib/ws-broadcast";
import { pool, query } from "@/lib/db";
import {
  EMPLOYEE_TICKETS_TABLE,
  buildTicketNumber,
  broadcastTicketUpdate,
  ensureEmployeeTicketsTable,
  rowToTicket,
  type EmployeeTicketRow,
  type TicketStatus,
} from "@/lib/employee-tickets-table";
import { sortTicketsNewestFirst } from "@/lib/ticket-sort";
import { isTicketClosed } from "@/lib/ticket-status";
import {
  appendAdminMessage,
  appendEmployeeMessage,
  latestAdminRemark,
  seedEmployeeMessage,
} from "@/lib/ticket-thread";
import { getEmployeePseudonym } from "@/lib/ticket-employee-meta";
import {
  findTicketType,
  ticketTypeLabel,
  type TicketCategory,
} from "@/lib/ticket-catalog";
import {
  canModerateTicketStatus,
  canModerateTicketStatusAsync,
  filterTicketsForInbox,
  getEmployeeDeptChipMap,
  getHrEmployeeIdSet,
  isHrDepartmentSubmitter,
  loadHrTicketViewer,
} from "@/lib/hr-department-tickets";
import { syncLeaveRecordFromTicket } from "@/lib/leave-ticket-sync";
import {
  assertLeaveBalanceAllowsRequest,
  getEmployeeLeaveBalance,
} from "@/lib/leave-balance";
import { resolveEmployeeDisplayName } from "@/lib/dept-heads";

function viewerIdFromReq(req: NextRequest, searchParams?: URLSearchParams) {
  const q =
    searchParams?.get("viewerId") ||
    searchParams?.get("viewer_id") ||
    "";
  const h =
    req.headers.get("x-employee-id") ||
    req.headers.get("x-hrm-employee-id") ||
    "";
  return String(q || h || "").trim();
}

function isLeaveTicketType(ticketType?: string | null) {
  return String(ticketType || "").toLowerCase() === "leave";
}

const VALID_CATEGORIES = new Set(["ESS", "IT", "HR", "ADMIN", "OPERATIONS"]);
const VALID_STATUSES = new Set([
  "pending",
  "in_progress",
  "resolved",
  "rejected",
  "closed",
]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

async function ticketForBroadcast(ticket: EmployeeTicketRow) {
  const employee_pseudonym = await getEmployeePseudonym(ticket.employee_id);
  return { ...ticket, employee_pseudonym };
}

export async function GET(req: NextRequest) {
  try {
    await ensureEmployeeTicketsTable();
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const ticketId = searchParams.get("id");
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const ticketType = searchParams.get("ticketType");
    const includePolicy = searchParams.get("includePolicy") === "1";
    const inboxRaw = String(searchParams.get("inbox") || "").trim().toLowerCase();
    const inbox: "admin" | "hr" | "own" =
      inboxRaw === "hr" ? "hr" : inboxRaw === "own" ? "own" : "admin";
    const viewerId = viewerIdFromReq(req, searchParams);
    const limit = Math.min(parseInt(searchParams.get("limit") || "500", 10), 1000);

    let sql = `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE}`;
    const params: (string | number)[] = [];
    const clauses: string[] = [];

    if (employeeId) {
      clauses.push("employee_id = ?");
      params.push(employeeId);
    }
    if (ticketId) {
      clauses.push("id = ?");
      params.push(parseInt(ticketId, 10));
    }
    if (status === "open") {
      clauses.push("status IN ('pending', 'in_progress')");
    } else if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    if (category) {
      clauses.push("category = ?");
      params.push(category);
    }
    if (ticketType) {
      clauses.push("ticket_type = ?");
      params.push(ticketType);
    }

    if (clauses.length) {
      sql += ` WHERE ${clauses.join(" AND ")}`;
    }

    // Fetch a wide window; final newest-first sort uses updated/resolved/requested.
    sql += ` ORDER BY id DESC LIMIT ${limit}`;

    const [rows]: unknown[] = await query(sql, params);
    const POLICY_TYPES = new Set(["guard_policy_alert", "guard_keyword_alert"]);
    let tickets = sortTicketsNewestFirst(
      (Array.isArray(rows) ? rows : []).map((r) =>
        rowToTicket(r as Record<string, unknown>)
      )
    );
    // Keep Guard Policy alerts out of the normal Ticket Inbox unless asked for.
    if (!ticketType && !includePolicy && !ticketId) {
      tickets = tickets.filter((t) => !POLICY_TYPES.has(String(t.ticket_type || "")));
    }

    const hrIds = await getHrEmployeeIdSet();
    const empChips = await getEmployeeDeptChipMap();
    const viewer = viewerId ? await loadHrTicketViewer(viewerId) : null;

    // Single-ticket fetch: owner or HR inbox viewer (for HR tickets) or admin (non-HR).
    if (ticketId) {
      let viewerDirectReports: Set<string> | undefined;
      if (viewer?.employeeId) {
        const { listDirectReportIds } = await import(
          "@/lib/employee-hierarchy-table"
        );
        viewerDirectReports = new Set(
          await listDirectReportIds(viewer.employeeId),
        );
      }
      tickets = tickets.filter((t) => {
        if (isLeaveTicketType(t.ticket_type)) {
          // Leave visible in HR inbox / admin / owner / dept-head owned chips / direct reports.
          if (viewer && String(t.employee_id) === viewer.employeeId) return true;
          if (viewerDirectReports?.has(String(t.employee_id))) return true;
          if (viewer?.canViewHrInbox) return true;
          if (viewer?.deptHead?.headHint) {
            const chip = empChips.get(String(t.employee_id));
            return Boolean(
              chip &&
                viewer.deptHead.ownedChips.some(
                  (c) => c.toLowerCase() === chip.toLowerCase()
                )
            );
          }
          return !isHrDepartmentSubmitter(t.employee_id, hrIds);
        }
        const hrTicket = isHrDepartmentSubmitter(t.employee_id, hrIds);
        if (!hrTicket) return true;
        if (viewer && String(t.employee_id) === viewer.employeeId) return true;
        return Boolean(viewer?.canViewHrInbox);
      });
      const sample = tickets[0];
      const canMod = sample
        ? await canModerateTicketStatusAsync({
            ticketEmployeeId: sample.employee_id,
            viewer,
            hrIds,
            ticketType: sample.ticket_type,
            submitterChip: empChips.get(String(sample.employee_id)) || null,
          })
        : false;
      return NextResponse.json({
        success: true,
        tickets,
        count: tickets.length,
        canModerate: canMod,
      });
    }

    // Own tickets list (employee portal "my tickets") — always own only.
    if (employeeId) {
      return NextResponse.json({
        success: true,
        tickets,
        count: tickets.length,
        canModerate: false,
      });
    }

    // Inbox lists — HR sees all leave; admin hides HR non-leave; dept heads get owned leave.
    let directReportIds: Set<string> | undefined;
    if (viewer?.employeeId) {
      const { listDirectReportIds } = await import(
        "@/lib/employee-hierarchy-table"
      );
      directReportIds = new Set(await listDirectReportIds(viewer.employeeId));
    }
    const filtered = filterTicketsForInbox(tickets, {
      inbox,
      viewer,
      hrIds,
      empChips,
      directReportIds,
    });

    // Per-ticket moderation flags (HR Manager may view all leave but approve only in-scope).
    const ticketsOut = [];
    let anyModerate = false;
    for (const t of filtered) {
      const canMod = await canModerateTicketStatusAsync({
        ticketEmployeeId: t.employee_id,
        viewer,
        hrIds,
        ticketType: t.ticket_type,
        submitterChip: empChips.get(String(t.employee_id)) || null,
      });
      if (canMod) anyModerate = true;
      ticketsOut.push({ ...t, can_moderate: canMod });
    }

    return NextResponse.json({
      success: true,
      tickets: sortTicketsNewestFirst(ticketsOut),
      count: ticketsOut.length,
      canModerate: anyModerate,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureEmployeeTicketsTable();
    const body = await req.json();
    const {
      employee_id,
      employee_name,
      category,
      ticket_type,
      subject,
      description,
      form_data,
      priority,
      is_custom,
    } = body;

    if (!employee_id || !category || !ticket_type) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!VALID_CATEGORIES.has(String(category))) {
      return NextResponse.json({ success: false, error: "Invalid category" }, { status: 400 });
    }

    const cat = category as TicketCategory;
    const typeKey = String(ticket_type);
    const typeConfig = findTicketType(cat, typeKey);
    if (!typeConfig) {
      return NextResponse.json({ success: false, error: "Invalid ticket type" }, { status: 400 });
    }

    const custom = Boolean(is_custom) || typeKey === "custom";
    const prio = VALID_PRIORITIES.has(String(priority)) ? String(priority) : "normal";

    let finalSubject = String(subject || "").trim();
    if (!finalSubject) {
      finalSubject = `${ticketTypeLabel(cat, typeKey)} — ${employee_name || "Employee"}`;
    }
    if (custom && !String(subject || "").trim()) {
      return NextResponse.json(
        { success: false, error: "Subject is required for custom tickets" },
        { status: 400 }
      );
    }

    const desc = String(description || "").trim();
    if (
      !desc &&
      (typeConfig.form === "generic" ||
        typeConfig.form === "custom" ||
        typeConfig.form === "hrm_issue")
    ) {
      return NextResponse.json(
        { success: false, error: "Please describe your request" },
        { status: 400 }
      );
    }

    // Leave tickets: require duration (full / 1st / 2nd half), then balance gate.
    if (typeKey === "leave") {
      const fd =
        form_data && typeof form_data === "object"
          ? (form_data as Record<string, unknown>)
          : {};
      const { parseLeaveDuration, leaveDaysForDuration } = await import(
        "@/lib/leave-duration"
      );
      const duration = parseLeaveDuration(fd.leave_duration);
      if (!duration) {
        return NextResponse.json(
          { success: false, error: "Please select type of leave." },
          { status: 400 }
        );
      }
      const startDate = String(fd.start_date || "").trim();
      let endDate = String(fd.end_date || "").trim() || startDate;
      if (duration === "first_half" || duration === "second_half") {
        endDate = startDate;
        fd.end_date = startDate;
        fd.total_days = 0.5;
        fd.half_day_part = duration === "first_half" ? "first" : "second";
      } else {
        const days = leaveDaysForDuration("full", startDate, endDate);
        fd.total_days = days;
        fd.half_day_part = null;
      }
      fd.leave_duration = duration;
      const leaveCategory = String(fd.leave_category || "annual");
      const totalDays = Number(fd.total_days) || 0;
      const bal = await getEmployeeLeaveBalance(employee_id);
      if (!bal.success) {
        return NextResponse.json(
          { success: false, error: bal.error || "Could not check leave balance" },
          { status: 400 }
        );
      }
      const gate = assertLeaveBalanceAllowsRequest(bal, {
        leaveCategory,
        totalDays,
      });
      if (!gate.ok) {
        return NextResponse.json(
          {
            success: false,
            error: gate.error,
            annualBalance: bal.annualBalance,
            bereavementBalance: bal.bereavementBalance,
          },
          { status: 400 }
        );
      }
    }

    const formJson = form_data ? JSON.stringify(form_data) : null;

    const [result]: any = await pool.query(
      `INSERT INTO ${EMPLOYEE_TICKETS_TABLE}
       (ticket_number, employee_id, employee_name, category, ticket_type, is_custom,
        subject, description, form_data, priority, status, requested_at, updated_at)
       VALUES ('PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      [
        String(employee_id),
        employee_name || "Employee",
        cat,
        typeKey,
        custom ? 1 : 0,
        finalSubject,
        desc || null,
        formJson,
        prio,
      ]
    );

    const insertId = Number(result?.insertId);
    const ticketNumber = buildTicketNumber(insertId);
    await query(
      `UPDATE ${EMPLOYEE_TICKETS_TABLE} SET ticket_number = ? WHERE id = ?`,
      [ticketNumber, insertId]
    );

    const initialMessages =
      typeKey === "leave"
        ? []
        : seedEmployeeMessage(employee_name || "Employee", desc || null);
    if (initialMessages.length > 0) {
      await query(
        `UPDATE ${EMPLOYEE_TICKETS_TABLE} SET messages = ? WHERE id = ?`,
        [JSON.stringify(initialMessages), insertId]
      );
    }

    const [rows]: any = await query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [insertId]
    );
    const ticket = rowToTicket(rows?.[0] ?? {});

    // Leave tickets also create employee_leaves (pending) for attendance / leave inbox.
    if (typeKey === "leave") {
      try {
        await syncLeaveRecordFromTicket(ticket);
      } catch (err) {
        console.warn("[employee-tickets] leave sync on create failed", err);
      }
    }

    broadcastWsEvent({
      type: "ticket_created",
      ticket: await ticketForBroadcast(ticket),
    });
    return NextResponse.json({ success: true, ticket });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureEmployeeTicketsTable();
    const body = await req.json();
    const { id, status, reply, admin_remark, author_name, from, employee_id } = body;
    if (!id) {
      return NextResponse.json({ success: false, error: "Invalid data" }, { status: 400 });
    }

    const replyText = String(reply ?? admin_remark ?? "").trim();
    const hasStatus = status && VALID_STATUSES.has(String(status));
    const isEmployeeReply = String(from || "").toLowerCase() === "employee";
    if (!hasStatus && !replyText) {
      return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 });
    }
    if (isEmployeeReply && hasStatus) {
      return NextResponse.json(
        { success: false, error: "Employees cannot change ticket status" },
        { status: 403 }
      );
    }

    const [existing]: any = await query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existing?.[0]) {
      return NextResponse.json({ success: false, error: "Ticket not found" }, { status: 404 });
    }

    const current = rowToTicket(existing[0] as Record<string, unknown>);
    if (isTicketClosed(current.status)) {
      return NextResponse.json(
        { success: false, error: "This ticket is closed. No further replies are allowed." },
        { status: 403 }
      );
    }

    // Status change: scoped approvers only. Nobody may approve their own ticket.
    let actorViewerId = "";
    let actorDisplayName: string | null = null;
    if (hasStatus && !isEmployeeReply) {
      actorViewerId =
        String(body.viewerId || body.viewer_id || employee_id || "").trim() ||
        viewerIdFromReq(req);
      const viewer = actorViewerId ? await loadHrTicketViewer(actorViewerId) : null;
      const hrIds = await getHrEmployeeIdSet();
      const empChips = await getEmployeeDeptChipMap();
      const allowed = await canModerateTicketStatusAsync({
        ticketEmployeeId: current.employee_id,
        viewer,
        hrIds,
        ticketType: current.ticket_type,
        submitterChip: empChips.get(String(current.employee_id)) || null,
      });
      if (!allowed) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Not allowed to approve or reject this ticket. View only if outside your department hierarchy.",
          },
          { status: 403 }
        );
      }
      actorDisplayName =
        String(author_name || "").trim() ||
        (await resolveEmployeeDisplayName(actorViewerId)) ||
        null;
      // Prefer real employee name over generic "HR"/"Admin" labels for Approved by.
      if (
        actorDisplayName &&
        /^(hr|admin)$/i.test(actorDisplayName) &&
        actorViewerId
      ) {
        actorDisplayName =
          (await resolveEmployeeDisplayName(actorViewerId)) || actorDisplayName;
      }
    }

    let messages = current.messages ?? [];
    if (replyText) {
      if (current.ticket_type === "leave") {
        return NextResponse.json(
          { success: false, error: "Leave tickets are status-only. Chat replies are not allowed." },
          { status: 403 }
        );
      }
      if (isEmployeeReply) {
        if (!employee_id || String(employee_id) !== String(current.employee_id)) {
          return NextResponse.json(
            { success: false, error: "You can only reply to your own tickets" },
            { status: 403 }
          );
        }
        messages = appendEmployeeMessage(
          messages,
          String(author_name || current.employee_name || "Employee"),
          replyText
        );
      } else {
        messages = appendAdminMessage(messages, String(author_name || "Admin"), replyText);
      }
    }

    const newStatus = (hasStatus ? String(status) : current.status) as TicketStatus;
    const resolvedAt =
      newStatus === "resolved" || newStatus === "rejected" || newStatus === "closed"
        ? new Date()
        : hasStatus
          ? null
          : current.resolved_at;

    const closing =
      newStatus === "resolved" || newStatus === "rejected" || newStatus === "closed";
    try {
      await query(
        `UPDATE ${EMPLOYEE_TICKETS_TABLE}
         SET status = ?, admin_remark = ?, messages = ?, resolved_at = ?, updated_at = NOW(),
             approved_by = ?, approved_by_name = ?
         WHERE id = ?`,
        [
          newStatus,
          latestAdminRemark(messages),
          JSON.stringify(messages),
          resolvedAt,
          closing && actorViewerId ? actorViewerId : null,
          closing && actorDisplayName ? actorDisplayName : null,
          id,
        ]
      );
    } catch {
      await query(
        `UPDATE ${EMPLOYEE_TICKETS_TABLE}
         SET status = ?, admin_remark = ?, messages = ?, resolved_at = ?, updated_at = NOW()
         WHERE id = ?`,
        [newStatus, latestAdminRemark(messages), JSON.stringify(messages), resolvedAt, id]
      );
    }

    const [rows]: any = await query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [id]
    );
    const ticket = rows?.[0] ? rowToTicket(rows[0] as Record<string, unknown>) : null;

    // Approve/reject leave ticket → employee_leaves (Monthly Attendance Leave status).
    if (ticket && ticket.ticket_type === "leave" && hasStatus) {
      try {
        await syncLeaveRecordFromTicket(ticket);
      } catch (err) {
        console.warn("[employee-tickets] leave sync on status failed", err);
      }
    }

    if (ticket) {
      broadcastTicketUpdate(await ticketForBroadcast(ticket));
    } else {
      broadcastTicketUpdate();
    }
    return NextResponse.json({ success: true, ticket });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/** DELETE ?id=123 — permanently remove a ticket (admin). */
export async function DELETE(req: NextRequest) {
  try {
    await ensureEmployeeTicketsTable();
    const { searchParams } = new URL(req.url);
    let id = parseInt(searchParams.get("id") || "", 10);
    if (!Number.isFinite(id) || id <= 0) {
      try {
        const body = await req.json();
        id = parseInt(String(body?.id ?? ""), 10);
      } catch {
        /* no body */
      }
    }
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: "Ticket id is required" }, { status: 400 });
    }

    const [existing]: any = await query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existing?.[0]) {
      return NextResponse.json({ success: false, error: "Ticket not found" }, { status: 404 });
    }
    const current = rowToTicket(existing[0] as Record<string, unknown>);
    const viewerId = viewerIdFromReq(req);
    const viewer = viewerId ? await loadHrTicketViewer(viewerId) : null;
    const hrIds = await getHrEmployeeIdSet();
    if (
      !canModerateTicketStatus({
        ticketEmployeeId: current.employee_id,
        viewer,
        hrIds,
      })
    ) {
      return NextResponse.json(
        { success: false, error: "Not allowed to delete this ticket." },
        { status: 403 }
      );
    }

    await query(`DELETE FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ?`, [id]);
    broadcastWsEvent({
      type: "ticket_update",
      ticket: { id, deleted: true },
    });
    return NextResponse.json({
      success: true,
      deleted: true,
      id,
      ticket_number: existing[0].ticket_number,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
