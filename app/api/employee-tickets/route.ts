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
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

    let sql = `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE 1=1`;
    const params: (string | number)[] = [];

    if (employeeId) {
      sql += " AND employee_id = ?";
      params.push(employeeId);
    }
    if (ticketId) {
      sql += " AND id = ?";
      params.push(parseInt(ticketId, 10));
    }
    if (status === "open") {
      sql += " AND status IN ('pending', 'in_progress')";
    } else if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    sql += " ORDER BY requested_at DESC LIMIT ?";
    params.push(limit);

    const [rows]: unknown[] = await query(sql, params);
    const tickets = (Array.isArray(rows) ? rows : []).map((r) =>
      rowToTicket(r as Record<string, unknown>)
    );
    return NextResponse.json({ success: true, tickets });
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

    await query(
      `UPDATE ${EMPLOYEE_TICKETS_TABLE}
       SET status = ?, admin_remark = ?, messages = ?, resolved_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [newStatus, latestAdminRemark(messages), JSON.stringify(messages), resolvedAt, id]
    );

    const [rows]: any = await query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [id]
    );
    const ticket = rows?.[0] ? rowToTicket(rows[0] as Record<string, unknown>) : null;
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
      `SELECT id, ticket_number FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existing?.[0]) {
      return NextResponse.json({ success: false, error: "Ticket not found" }, { status: 404 });
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
