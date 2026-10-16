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
import { calendarDay } from "@/lib/mongo-helpers";
import { broadcastWsEvent } from "@/lib/ws-broadcast";

function ticketForm(ticket: EmployeeTicketRow): Record<string, unknown> {
  const fd = ticket.form_data;
  return fd && typeof fd === "object" ? (fd as Record<string, unknown>) : {};
}

/** Business calendar day in Asia/Karachi (never UTC ISO prefix alone). */
function ymd(v: unknown): string {
  return calendarDay(v);
}

function parseTicketFormData(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
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
  // form_data dates may be Date / ISO from Mongo — calendarDay keeps Karachi day
  const startDate = ymd(fd.start_date);
  const endDate = ymd(fd.end_date) || startDate;
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
    parseLeaveDuration(fd.halfDayPart) ||
    // Fall back when total_days was already stored as 0.5 on the ticket form.
    (Number(fd.total_days) > 0 && Number(fd.total_days) < 1
      ? "first_half"
      : null) ||
    "full";
  const effectiveEnd =
    duration === "first_half" || duration === "second_half" ? startDate : endDate;
  const totalDays =
    duration === "first_half" || duration === "second_half"
      ? 0.5
      : leaveDaysForDuration(duration, startDate, effectiveEnd);
  const halfDayPart = halfDayPartFromDuration(duration);
  // Persist duration on form_data so later balance/sync stays correct.
  fd.leave_duration = duration;
  fd.total_days = totalDays;
  fd.half_day_part = halfDayPart;
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

/** Find leave ticket id by employee + leave dates when reason has no [ticket:N] marker. */
async function findLeaveTicketIdByDates(
  employeeId: string,
  startDate: string,
  endDate: string,
): Promise<number | null> {
  const eid = String(employeeId || "").trim();
  const start = ymd(startDate);
  const end = ymd(endDate) || start;
  if (!eid || !start) return null;
  try {
    const [rows] = await query(
      `SELECT id, form_data, status FROM ${EMPLOYEE_TICKETS_TABLE}
       WHERE ticket_type = ? AND employee_id = ?
       ORDER BY id DESC LIMIT 40`,
      ["leave", eid],
    );
    const list = Array.isArray(rows) ? rows : [];
    let startOnlyMatch: number | null = null;
    for (const raw of list as {
      id: number;
      form_data?: unknown;
      status?: string;
    }[]) {
      const st = String(raw.status || "").toLowerCase();
      if (st !== "pending" && st !== "in_progress") continue;
      const fd = parseTicketFormData(raw.form_data);
      const fdStart = ymd(fd.start_date);
      const fdEnd = ymd(fd.end_date) || fdStart;
      if (!fdStart) continue;
      if (fdStart === start && fdEnd === end) return Number(raw.id);
      // Half-day / form end missing: match on start date alone (first open ticket).
      if (fdStart === start && startOnlyMatch == null) {
        startOnlyMatch = Number(raw.id);
      }
    }
    return startOnlyMatch;
  } catch {
    /* ignore */
  }
  return null;
}

async function applyTicketDecision(
  ticketId: number,
  ticketStatus: "resolved" | "rejected",
  actorId: string | null,
  actorName: string | null,
): Promise<boolean> {
  const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
  // Prefer full approver columns; always force status by id (Mongo IN filters are flaky).
  try {
    await query(
      `UPDATE ${EMPLOYEE_TICKETS_TABLE}
       SET status = ?, resolved_at = ?, updated_at = ?,
           approved_by = ?, approved_by_name = ?
       WHERE id = ?`,
      [ticketStatus, nowIso, nowIso, actorId, actorName, ticketId],
    );
    return true;
  } catch {
    try {
      await query(
        `UPDATE ${EMPLOYEE_TICKETS_TABLE}
         SET status = ?, resolved_at = ?, updated_at = ?
         WHERE id = ?`,
        [ticketStatus, nowIso, nowIso, ticketId],
      );
      return true;
    } catch (err) {
      console.warn("[leave-ticket-sync] ticket status update failed", err);
      return false;
    }
  }
}

/**
 * When leave is approved/rejected on Leaves page, mirror status onto the linked ticket
 * so Ticket Inbox stays in sync and shows Approved by (TL / Manager / CEO).
 */
export async function syncTicketFromLeaveDecision(opts: {
  leaveReason: unknown;
  status: "approved" | "rejected";
  actorId?: string | null;
  actorName?: string | null;
  employeeId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<void> {
  let ticketId = ticketIdFromLeaveReason(opts.leaveReason);
  if (!ticketId) {
    ticketId = await findLeaveTicketIdByDates(
      String(opts.employeeId || ""),
      ymd(opts.startDate) || String(opts.startDate || ""),
      ymd(opts.endDate) || ymd(opts.startDate) || String(opts.endDate || ""),
    );
  }
  if (!ticketId) {
    console.warn(
      "[leave-ticket-sync] no ticket found for leave decision",
      String(opts.employeeId || ""),
      ymd(opts.startDate),
    );
    return;
  }
  const ticketStatus = opts.status === "approved" ? "resolved" : "rejected";
  const actorId = String(opts.actorId || "").trim() || null;
  const actorName = String(opts.actorName || "").trim() || null;
  const ok = await applyTicketDecision(ticketId, ticketStatus, actorId, actorName);
  if (ok) {
    // Keep leave reason linked for future syncs / monthly attendance.
    try {
      const marker = `[ticket:${ticketId}]`;
      const reason = String(opts.leaveReason || "");
      const start = ymd(opts.startDate);
      const end = ymd(opts.endDate) || start;
      if (opts.employeeId && start && !reason.includes(marker)) {
        const [byDate] = await query(
          `SELECT id, reason, start_date, end_date FROM employee_leaves
           WHERE employee_id = ? ORDER BY id DESC LIMIT 20`,
          [String(opts.employeeId)],
        );
        for (const row of (Array.isArray(byDate) ? byDate : []) as {
          id: number;
          reason?: string;
          start_date?: unknown;
          end_date?: unknown;
        }[]) {
          if (ymd(row.start_date) !== start) continue;
          if ((ymd(row.end_date) || ymd(row.start_date)) !== end) continue;
          const prev = String(row.reason || "");
          if (prev.includes(marker)) break;
          const next = `${prev}${prev ? " " : ""}${marker}`.trim();
          await query(`UPDATE employee_leaves SET reason = ? WHERE id = ?`, [
            next,
            row.id,
          ]);
          break;
        }
      }
    } catch {
      /* marker optional */
    }
    broadcastWsEvent({ type: "ticket_update" });
    broadcastWsEvent({ type: "leave_update" });
  }
}

/**
 * If Leaves page already approved/rejected but Ticket Inbox still shows Pending,
 * push leave decision onto matching open leave tickets (in-memory + DB).
 */
export async function repairPendingTicketsFromLeaves<
  T extends {
    id: number;
    employee_id?: string | number;
    ticket_type?: string | null;
    status?: string | null;
    form_data?: Record<string, unknown> | null;
    approved_by_name?: string | null;
  },
>(tickets: T[]): Promise<T[]> {
  const openLeave = tickets.filter(
    (t) =>
      String(t.ticket_type || "").toLowerCase() === "leave" &&
      ["pending", "in_progress"].includes(String(t.status || "").toLowerCase()),
  );
  if (openLeave.length === 0) return tickets;

  for (const t of openLeave) {
    const eid = String(t.employee_id || "").trim();
    if (!eid) continue;
    const fd = parseTicketFormData(t.form_data);
    const start = ymd(fd.start_date);
    const end = ymd(fd.end_date) || start;
    if (!start) continue;
    try {
      type LeaveRow = {
        status?: string;
        reason?: string;
        step1_by?: string | null;
        step2_by?: string | null;
        start_date?: unknown;
        end_date?: unknown;
      };
      // Fetch by employee only — date equality in SQL breaks on Mongo Date objects.
      const [rows] = await query(
        `SELECT id, status, reason, step1_by, step2_by, start_date, end_date
         FROM employee_leaves
         WHERE employee_id = ?
         ORDER BY id DESC LIMIT 30`,
        [eid],
      );
      const list = (Array.isArray(rows) ? rows : []) as LeaveRow[];
      const decided = list.find((r) => {
        const st = String(r.status || "").toLowerCase();
        if (st !== "approved" && st !== "rejected") return false;
        const rStart = ymd(r.start_date);
        const rEnd = ymd(r.end_date) || rStart;
        if (rStart !== start) return false;
        const reason = String(r.reason || "");
        if (reason.includes(`[ticket:${t.id}]`)) return true;
        if (rEnd === end || rStart === start) return true;
        return false;
      });
      if (!decided) continue;
      const leaveStatus = String(decided.status || "").toLowerCase() as
        | "approved"
        | "rejected";
      const actorName = String(
        decided.step2_by || decided.step1_by || "",
      ).trim();
      await syncTicketFromLeaveDecision({
        leaveReason: decided.reason || `[ticket:${t.id}]`,
        status: leaveStatus,
        actorId: null,
        actorName: actorName || null,
        employeeId: eid,
        startDate: ymd(decided.start_date) || start,
        endDate: ymd(decided.end_date) || end,
      });
      t.status = leaveStatus === "approved" ? "resolved" : "rejected";
      if (actorName) t.approved_by_name = actorName;
    } catch {
      /* skip row */
    }
  }
  return tickets;
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
