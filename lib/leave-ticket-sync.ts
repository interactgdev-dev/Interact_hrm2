/**
 * Leave tickets (Generate Ticket) must drive `employee_leaves` so Monthly Attendance
 * and other screens show Leave status after HR Manager / TL approve.
 */

import { pool, query } from "@/lib/db";
import {
  EMPLOYEE_TICKETS_TABLE,
  rowToTicket,
  type EmployeeTicketRow,
} from "@/lib/employee-tickets-table";
import { broadcastWsEvent } from "@/lib/ws-broadcast";

function ticketForm(ticket: EmployeeTicketRow): Record<string, unknown> {
  const fd = ticket.form_data;
  return fd && typeof fd === "object" ? (fd as Record<string, unknown>) : {};
}

function ymd(v: unknown): string {
  const s = String(v || "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : "";
}

function leaveStatusFromTicket(status: string): "pending" | "approved" | "rejected" {
  const s = String(status || "").toLowerCase();
  if (s === "resolved" || s === "closed") return "approved";
  if (s === "rejected") return "rejected";
  return "pending";
}

async function findLeaveIdForTicket(
  employeeId: string,
  startDate: string,
  endDate: string,
  ticketId: number
): Promise<number | null> {
  try {
    const [rows] = await query(
      `SELECT id, reason FROM employee_leaves
       WHERE employee_id = ? AND start_date = ? AND end_date = ?
       ORDER BY id DESC LIMIT 20`,
      [employeeId, startDate, endDate]
    );
    const list = Array.isArray(rows) ? rows : [];
    const marker = `[ticket:${ticketId}]`;
    for (const r of list as { id: number; reason?: string }[]) {
      if (String(r.reason || "").includes(marker)) return Number(r.id);
    }
    if (list.length === 1) return Number((list[0] as { id: number }).id);
    return null;
  } catch {
    return null;
  }
}

/**
 * Create or update employee_leaves from a leave ticket.
 * Returns leave row id when known.
 */
export async function syncLeaveRecordFromTicket(
  ticket: EmployeeTicketRow
): Promise<number | null> {
  if (String(ticket.ticket_type || "") !== "leave") return null;

  const fd = ticketForm(ticket);
  const employeeId = String(ticket.employee_id || "").trim();
  // form_data dates may be Date objects from Mongo
  const startDate = ymd(
    fd.start_date instanceof Date
      ? fd.start_date.toISOString()
      : fd.start_date
  );
  const endDate =
    ymd(
      fd.end_date instanceof Date ? fd.end_date.toISOString() : fd.end_date
    ) || startDate;
  if (!employeeId || !startDate) return null;

  const leaveCategory = String(fd.leave_category || "annual").trim() || "annual";
  const {
    parseLeaveDuration,
    leaveDaysForDuration,
    halfDayPartFromDuration,
  } = await import("@/lib/leave-duration");
  const duration =
    parseLeaveDuration(fd.leave_duration) ||
    parseLeaveDuration(
      fd.half_day_part === "first"
        ? "first_half"
        : fd.half_day_part === "second"
          ? "second_half"
          : ""
    ) ||
    "full";
  const effectiveEnd =
    duration === "first_half" || duration === "second_half" ? startDate : endDate;
  const totalDays = leaveDaysForDuration(duration, startDate, effectiveEnd);
  const halfDayPart = halfDayPartFromDuration(duration);
  const reasonBody = String(fd.reason || ticket.description || "").trim();
  const marker = `[ticket:${ticket.id}]`;
  const reason = reasonBody.includes(marker)
    ? reasonBody
    : `${reasonBody}${reasonBody ? " " : ""}${marker}`.trim();
  const docs = Array.isArray(fd.document_paths) ? fd.document_paths : [];
  const leaveStatus = leaveStatusFromTicket(ticket.status);
  const employeeName = String(ticket.employee_name || "").trim();

  const existingId = await findLeaveIdForTicket(
    employeeId,
    startDate,
    effectiveEnd,
    Number(ticket.id)
  );

  const step1 = leaveStatus === "rejected" ? "rejected" : leaveStatus;
  const step2 = leaveStatus === "approved" ? "approved" : leaveStatus === "rejected" ? "rejected" : "pending";

  // Avoid SQL COALESCE/NOW() expressions — Mongo adapter stores them as literal strings.
  const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");

  try {
    if (existingId) {
      // Never downgrade an already-decided leave when the linked ticket is still pending.
      // (George / TL approve on Leaves page was getting wiped by ticket backfill.)
      try {
        const [curRows] = await query(
          `SELECT status FROM employee_leaves WHERE id = ? LIMIT 1`,
          [existingId]
        );
        const curStatus = String(
          (Array.isArray(curRows) ? (curRows[0] as { status?: string })?.status : "") || ""
        ).toLowerCase();
        if (
          leaveStatus === "pending" &&
          (curStatus === "approved" || curStatus === "rejected")
        ) {
          return existingId;
        }
      } catch {
        /* continue with update */
      }

      try {
        const sets = [
          "employee_name = ?",
          "leave_category = ?",
          "start_date = ?",
          "end_date = ?",
          "total_days = ?",
          "half_day_part = ?",
          "reason = ?",
          "status = ?",
          "step1_status = ?",
          "step2_status = ?",
          "document_paths = ?",
          "updated_at = ?",
        ];
        const vals: unknown[] = [
          employeeName,
          leaveCategory,
          startDate,
          effectiveEnd,
          totalDays,
          halfDayPart,
          reason,
          leaveStatus,
          step1,
          step2,
          JSON.stringify(docs),
          nowIso,
        ];
        if (leaveStatus === "approved") {
          sets.push("step1_at = ?", "step2_at = ?");
          vals.push(nowIso, nowIso);
        }
        // Carry ticket approver onto the leave row when present.
        const approvedBy = String(
          (ticket as EmployeeTicketRow & { approved_by?: string | null }).approved_by || ""
        ).trim();
        const approvedByName = String(
          (ticket as EmployeeTicketRow & { approved_by_name?: string | null })
            .approved_by_name || ""
        ).trim();
        if (leaveStatus === "approved" && approvedBy) {
          sets.push("step1_by = ?", "step2_by = ?");
          vals.push(approvedBy, approvedBy);
        } else if (leaveStatus === "approved" && approvedByName) {
          sets.push("step1_by = ?", "step2_by = ?");
          vals.push(approvedByName, approvedByName);
        }
        vals.push(existingId);
        await query(
          `UPDATE employee_leaves SET ${sets.join(", ")} WHERE id = ?`,
          vals
        );
      } catch {
        await query(
          `UPDATE employee_leaves
           SET employee_name = ?, leave_category = ?, start_date = ?, end_date = ?,
               total_days = ?, reason = ?, status = ?, document_paths = ?, updated_at = ?
           WHERE id = ?`,
          [
            employeeName,
            leaveCategory,
            startDate,
            effectiveEnd,
            totalDays,
            reason,
            leaveStatus,
            JSON.stringify(docs),
            nowIso,
            existingId,
          ]
        );
      }
      broadcastWsEvent({ type: "leave_update" });
      return existingId;
    }

    try {
      const cols = [
        "employee_id",
        "employee_name",
        "leave_category",
        "start_date",
        "end_date",
        "total_days",
        "half_day_part",
        "reason",
        "status",
        "step1_status",
        "step2_status",
        "document_paths",
        "requested_at",
        "updated_at",
      ];
      const vals: unknown[] = [
        employeeId,
        employeeName,
        leaveCategory,
        startDate,
        effectiveEnd,
        totalDays,
        halfDayPart,
        reason,
        leaveStatus,
        step1,
        step2,
        JSON.stringify(docs),
        nowIso,
        nowIso,
      ];
      if (leaveStatus === "approved") {
        cols.push("step1_at", "step2_at");
        vals.push(nowIso, nowIso);
      }
      const [result]: any = await pool.query(
        `INSERT INTO employee_leaves (${cols.join(", ")})
         VALUES (${cols.map(() => "?").join(", ")})`,
        vals
      );
      broadcastWsEvent({ type: "leave_update" });
      return Number(result?.insertId) || null;
    } catch {
      const [result]: any = await pool.query(
        `INSERT INTO employee_leaves
          (employee_id, employee_name, leave_category, start_date, end_date, total_days, reason, status,
           document_paths, requested_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          employeeId,
          employeeName,
          leaveCategory,
          startDate,
          effectiveEnd,
          totalDays,
          reason,
          leaveStatus,
          JSON.stringify(docs),
          nowIso,
          nowIso,
        ]
      );
      broadcastWsEvent({ type: "leave_update" });
      return Number(result?.insertId) || null;
    }
  } catch (err) {
    console.warn("[leave-ticket-sync] failed", err);
    return null;
  }
}

/** Parse `[ticket:123]` marker from leave reason. */
export function ticketIdFromLeaveReason(reason: unknown): number | null {
  const m = /\[ticket:(\d+)\]/i.exec(String(reason || ""));
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * When leave is approved/rejected on Leaves page, mirror status onto the linked ticket
 * so Ticket Inbox stays in sync and shows Approved by.
 */
export async function syncTicketFromLeaveDecision(opts: {
  leaveReason: unknown;
  status: "approved" | "rejected";
  actorId?: string | null;
  actorName?: string | null;
}): Promise<void> {
  const ticketId = ticketIdFromLeaveReason(opts.leaveReason);
  if (!ticketId) return;
  const ticketStatus = opts.status === "approved" ? "resolved" : "rejected";
  const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
  const actorId = String(opts.actorId || "").trim() || null;
  const actorName = String(opts.actorName || "").trim() || null;
  try {
    try {
      await query(
        `UPDATE ${EMPLOYEE_TICKETS_TABLE}
         SET status = ?, resolved_at = ?, updated_at = ?,
             approved_by = ?, approved_by_name = ?
         WHERE id = ? AND status IN ('pending', 'in_progress')`,
        [ticketStatus, nowIso, nowIso, actorId, actorName, ticketId]
      );
    } catch {
      await query(
        `UPDATE ${EMPLOYEE_TICKETS_TABLE}
         SET status = ?, resolved_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'in_progress')`,
        [ticketStatus, nowIso, nowIso, ticketId]
      );
    }
    broadcastWsEvent({ type: "ticket_update" });
  } catch (err) {
    console.warn("[leave-ticket-sync] ticket mirror failed", err);
  }
}

let lastBackfillAt = 0;

/**
 * Backfill: any resolved/rejected leave tickets missing from employee_leaves.
 * Throttled — safe to call from GET /api/leaves.
 */
export async function backfillLeavesFromTickets(
  opts?: { force?: boolean }
): Promise<number> {
  const now = Date.now();
  if (!opts?.force && now - lastBackfillAt < 15_000) return 0;
  lastBackfillAt = now;
  try {
    const [rows] = await query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE}
       WHERE ticket_type = ?
       ORDER BY id DESC
       LIMIT 300`,
      ["leave"]
    );
    const tickets = Array.isArray(rows) ? rows : [];
    let n = 0;
    for (const raw of tickets) {
      try {
        const ticket = rowToTicket(raw as Record<string, unknown>);
        const id = await syncLeaveRecordFromTicket(ticket);
        if (id) n += 1;
      } catch (err) {
        console.warn("[leave-ticket-sync] row failed", err);
      }
    }
    return n;
  } catch (err) {
    console.warn("[leave-ticket-sync] backfill failed", err);
    return 0;
  }
}
