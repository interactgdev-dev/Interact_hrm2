import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  EMPLOYEE_TICKETS_TABLE,
  buildTicketNumber,
  broadcastTicketUpdate,
  ensureEmployeeTicketsTable,
  rowToTicket,
} from "@/lib/employee-tickets-table";
import { employeeHasOpenClockIn } from "@/lib/attendance-presence";
import { findOpenSessionBreak } from "@/lib/open-session-break";
import { getEmployeePseudonym } from "@/lib/ticket-employee-meta";
import { seedEmployeeMessage } from "@/lib/ticket-thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Interact Guard: auto ticket when employee not at seat and no break.
 * Body: employee_id, employee_name?, pseudonym?, machine_id?, hostname?, reason?
 */
export async function POST(req: NextRequest) {
  try {
    await ensureEmployeeTicketsTable();
    const body = (await req.json()) as {
      employee_id?: string;
      employee_name?: string;
      pseudonym?: string;
      machine_id?: string;
      hostname?: string;
      reason?: string;
    };

    const employeeId = String(body.employee_id ?? "").trim();
    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employee_id required" },
        { status: 400 },
      );
    }

    // Not clocked in → never idle-scan / seat-absent ticket
    const clockedIn = await employeeHasOpenClockIn(employeeId);
    if (!clockedIn) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "not_clocked_in",
        message: "Skipped — employee is not clocked in.",
      });
    }

    // Never open a seat-absent ticket while Break/Prayer/Refreshment/Meeting is active
    const openBreak = await findOpenSessionBreak(employeeId);
    if (openBreak.active) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `active_${openBreak.kind ?? "break"}`,
        message: `Skipped — employee has an active ${openBreak.kind ?? "break"}.`,
      });
    }

    // Enrich from HRM
    let employeeName = String(body.employee_name ?? "").trim();
    let pseudonym = String(body.pseudonym ?? "").trim();
    try {
      const [rows] = await pool.query(
        `SELECT first_name, last_name, pseudonym FROM hrm_employees WHERE id = ? LIMIT 1`,
        [employeeId],
      );
      const emp = (rows as {
        first_name?: string;
        last_name?: string;
        pseudonym?: string;
      }[])[0];
      if (emp) {
        const n = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
        if (n) employeeName = n;
        if (emp.pseudonym?.trim()) pseudonym = emp.pseudonym.trim();
      }
    } catch {
      /* keep body values */
    }
    if (!pseudonym) {
      pseudonym = (await getEmployeePseudonym(employeeId)) || "";
    }
    if (!employeeName) employeeName = `Employee ${employeeId}`;

    const host = String(body.hostname ?? "").trim();
    const machine = String(body.machine_id ?? "").trim();
    const reason =
      String(body.reason ?? "").trim() ||
      "Employee not at seat; no break/meeting/restroom active";

    const subject = `Seat absent — ${employeeName}${pseudonym ? ` (${pseudonym})` : ""} · ID ${employeeId}`;
    const description = [
      reason,
      `Employee: ${employeeName}`,
      pseudonym ? `Pseudonym: ${pseudonym}` : null,
      `HRM ID: ${employeeId}`,
      host ? `PC: ${host}` : null,
      machine ? `Machine: ${machine}` : null,
      `Source: Interact Guard auto-detect`,
    ]
      .filter(Boolean)
      .join("\n");

    // Short dedup only — long windows hid later fails from the inbox ("toast sent, no new row").
    // Mongo adapter also mishandles NOW()-INTERVAL, so we compare timestamps in JS.
    const DEDUP_MS = 2 * 60 * 1000;
    try {
      const [dupRows] = await pool.query(
        `SELECT id, ticket_number, requested_at, status FROM ${EMPLOYEE_TICKETS_TABLE}
         WHERE employee_id = ?
           AND ticket_type = 'seat_absent'
           AND status IN ('pending', 'in_progress')
         ORDER BY id DESC
         LIMIT 10`,
        [employeeId],
      );
      const cutoff = Date.now() - DEDUP_MS;
      const recent = (Array.isArray(dupRows) ? dupRows : []).find((row) => {
        const r = row as { id?: number; requested_at?: string | Date };
        const raw = r.requested_at;
        let ts = 0;
        if (raw instanceof Date) ts = raw.getTime();
        else if (raw != null) {
          const s = String(raw).trim();
          ts = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
        }
        return Number.isFinite(ts) && ts >= cutoff;
      }) as
        | { id: number; ticket_number?: string; requested_at?: string }
        | undefined;
      if (recent?.id) {
        return NextResponse.json({
          success: true,
          deduped: true,
          ticket_id: recent.id,
          ticket_number: recent.ticket_number || null,
          message:
            "Open seat-absent ticket already exists in HR inbox (last 2 minutes).",
        });
      }
    } catch {
      /* continue to create */
    }

    const formJson = JSON.stringify({
      employee_id: employeeId,
      employee_name: employeeName,
      pseudonym: pseudonym || null,
      machine_id: machine || null,
      hostname: host || null,
      source: "interact_guard",
    });

    const [result]: any = await pool.query(
      `INSERT INTO ${EMPLOYEE_TICKETS_TABLE}
       (ticket_number, employee_id, employee_name, category, ticket_type, is_custom,
        subject, description, form_data, priority, status, requested_at, updated_at)
       VALUES ('PENDING', ?, ?, 'HR', 'seat_absent', 0,
        ?, ?, ?, 'high', 'pending', NOW(), NOW())`,
      [employeeId, employeeName, subject, description, formJson],
    );

    const id = Number(result?.insertId);
    const ticketNumber = buildTicketNumber(id);
    await pool.query(
      `UPDATE ${EMPLOYEE_TICKETS_TABLE} SET ticket_number = ? WHERE id = ?`,
      [ticketNumber, id],
    );

    const messages = seedEmployeeMessage(employeeName, description);
    try {
      await pool.query(
        `UPDATE ${EMPLOYEE_TICKETS_TABLE} SET messages = ? WHERE id = ?`,
        [JSON.stringify(messages), id],
      );
    } catch {
      /* optional */
    }

    const [rows]: any = await pool.query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [id],
    );
    const ticket = rowToTicket(rows[0]);
    try {
      await broadcastTicketUpdate({
        ...ticket,
        employee_pseudonym: pseudonym || null,
      } as any);
    } catch {
      /* optional */
    }

    return NextResponse.json({
      success: true,
      ticket,
      ticket_number: ticketNumber,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Ticket failed",
      },
      { status: 500 },
    );
  }
}
