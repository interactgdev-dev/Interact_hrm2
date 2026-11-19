import "server-only";

import { pool } from "./db";
import { ATTENDANCE_TABLE, ensureAttendanceTable } from "./attendance-table";
import {
  evaluatePresencePrompt,
  fetchShiftForEmployee,
  type DbExecuteConn,
  type OpenAttendanceRow,
} from "./attendance-presence";
import {
  performAutoClockOut,
  reconcileAutoClockOutsWithTPunch,
  shouldServerAutoClockOut,
} from "./auto-clock-out";
import {
  AUTO_PRESENCE_POPUP_MS,
  clockInDateKey,
  parseAttendanceDateTimeMs,
} from "./shift-timing";

export type AutoPresenceSweepResult = {
  processed: number;
  clockedOut: number;
  attendanceIds: number[];
  reconciled: number;
};

type OpenRow = OpenAttendanceRow & {
  employee_name?: string | null;
};

/**
 * Last-resort only when no shift times exist at all.
 * Must wait the full window — never close just because the calendar day flipped
 * (that broke overnight 7PM–4AM workers right after midnight).
 */
const STALE_NO_SHIFT_FALLBACK_MS = 8 * 60 * 60 * 1000;

async function processOpenSession(
  conn: DbExecuteConn,
  open: OpenRow,
): Promise<number | null> {
  const cinDate = clockInDateKey(open.clock_in);
  const shift = await fetchShiftForEmployee(conn, open.employee_id, cinDate);
  const evalResult = evaluatePresencePrompt(open, shift);

  // Assigned shift path: auto only at shift-end + 3h grace + 5 min popup.
  if (evalResult.promptAtMs != null && evalResult.clockInMs != null) {
    if (
      !shouldServerAutoClockOut(
        evalResult.promptAtMs,
        evalResult.clockInMs,
        evalResult.lastPresenceAckMs ?? null,
      )
    ) {
      return null;
    }

    const scheduledClockOutMs = evalResult.promptAtMs + AUTO_PRESENCE_POPUP_MS;
    await performAutoClockOut(
      conn,
      open.id,
      open.employee_name,
      scheduledClockOutMs,
      open.employee_id,
    );
    return open.id;
  }

  // No usable shift: only after clock-in + 8h (+ popup), not at midnight rollover.
  const clockInMs =
    evalResult.clockInMs ?? parseAttendanceDateTimeMs(open.clock_in);
  if (clockInMs == null) return null;

  const staleDeadlineMs = clockInMs + STALE_NO_SHIFT_FALLBACK_MS;
  if (Date.now() < staleDeadlineMs + AUTO_PRESENCE_POPUP_MS) {
    return null;
  }

  await performAutoClockOut(
    conn,
    open.id,
    open.employee_name,
    staleDeadlineMs + AUTO_PRESENCE_POPUP_MS,
    open.employee_id,
  );
  return open.id;
}

/**
 * DB-driven auto clock-out:
 * - With assigned shift → shift end + 3h + 5 min
 * - Without shift times → clock-in + 8h + 5 min (never midnight-only)
 * Runs without browser — logout / closed tab has no effect.
 */
export async function sweepAutoPresenceClockOuts(
  employeeId?: string,
): Promise<AutoPresenceSweepResult> {
  let conn;
  const result: AutoPresenceSweepResult = {
    processed: 0,
    clockedOut: 0,
    attendanceIds: [],
    reconciled: 0,
  };

  try {
    conn = await pool.getConnection();
    await ensureAttendanceTable(conn);

    const sql = employeeId
      ? `SELECT id, employee_id, employee_name,
                DATE_FORMAT(clock_in, '%Y-%m-%dT%H:%i:%s') AS clock_in,
                DATE_FORMAT(last_presence_ack_at, '%Y-%m-%dT%H:%i:%s') AS last_presence_ack_at
         FROM ${ATTENDANCE_TABLE}
         WHERE clock_out IS NULL AND employee_id = ?`
      : `SELECT id, employee_id, employee_name,
                DATE_FORMAT(clock_in, '%Y-%m-%dT%H:%i:%s') AS clock_in,
                DATE_FORMAT(last_presence_ack_at, '%Y-%m-%dT%H:%i:%s') AS last_presence_ack_at
         FROM ${ATTENDANCE_TABLE}
         WHERE clock_out IS NULL`;

    const [rows] = await conn.execute(sql, employeeId ? [employeeId] : []);
    const openSessions = rows as OpenRow[];

    for (const open of openSessions) {
      if (!open?.clock_in) continue;
      result.processed += 1;
      const closedId = await processOpenSession(conn, open);
      if (closedId != null) {
        result.clockedOut += 1;
        result.attendanceIds.push(closedId);
      }
    }

    // Past auto-outs closed at grace time before T.Punch Out existed → rewrite clock_out
    result.reconciled = await reconcileAutoClockOutsWithTPunch(conn, {
      lookbackDays: 7,
      employeeId,
    });

    return result;
  } finally {
    if (conn) conn.release();
  }
}
