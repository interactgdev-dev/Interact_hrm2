import "server-only";

import { pool } from "./db";
import { ATTENDANCE_TABLE, ensureAttendanceTable } from "./attendance-table";
import {
  evaluatePresencePrompt,
  fetchShiftForEmployee,
  type DbExecuteConn,
  type OpenAttendanceRow,
} from "./attendance-presence";
import { performAutoClockOut, shouldServerAutoClockOut } from "./auto-clock-out";
import {
  AUTO_PRESENCE_POPUP_MS,
  clockInDateKey,
  parseAttendanceDateTimeMs,
} from "./shift-timing";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "./timezone";

export type AutoPresenceSweepResult = {
  processed: number;
  clockedOut: number;
  attendanceIds: number[];
};

type OpenRow = OpenAttendanceRow & {
  employee_name?: string | null;
};

/** Prior-day open rows with no usable shift prompt never get presence auto-close otherwise. */
const STALE_NO_SHIFT_FALLBACK_MS = 8 * 60 * 60 * 1000;

async function processOpenSession(
  conn: DbExecuteConn,
  open: OpenRow,
): Promise<number | null> {
  const cinDate = clockInDateKey(open.clock_in);
  const shift = await fetchShiftForEmployee(conn, open.employee_id, cinDate);
  const evalResult = evaluatePresencePrompt(open, shift);

  if (evalResult.promptAtMs == null || evalResult.clockInMs == null) {
    const clockInMs =
      evalResult.clockInMs ?? parseAttendanceDateTimeMs(open.clock_in);
    if (clockInMs == null || !cinDate) return null;

    const today = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    // Same-day no-shift: leave open — UI shows Clock Out for manual close
    if (cinDate >= today) return null;

    const scheduledClockOutMs = Math.min(
      clockInMs + STALE_NO_SHIFT_FALLBACK_MS,
      Date.now(),
    );
    await performAutoClockOut(
      conn,
      open.id,
      open.employee_name,
      scheduledClockOutMs,
      open.employee_id,
    );
    return open.id;
  }

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
  // Never write clock_out before clock_in (Mongo DATE_FORMAT TZ bugs used to).
  if (scheduledClockOutMs <= evalResult.clockInMs) {
    return null;
  }
  await performAutoClockOut(
    conn,
    open.id,
    open.employee_name,
    scheduledClockOutMs,
    open.employee_id,
  );
  return open.id;
}

/**
 * DB-driven auto clock-out for open sessions past shift grace + 5 min popup window.
 * Also closes prior-day opens that have no shift (would otherwise stay forever).
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

    return result;
  } finally {
    if (conn) conn.release();
  }
}
