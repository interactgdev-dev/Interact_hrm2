import { ATTENDANCE_TABLE } from "./attendance-table";
import {
  clockInDateKey,
  computeShiftEndEpochMs,
  normalizeDateKey,
  normalizeShiftTimeString,
  parseAttendanceDateTimeMs,
  resolvePresencePromptAtMs,
  type ShiftAssignmentTiming,
} from "./shift-timing";

export type OpenAttendanceRow = {
  id: number;
  employee_id: string;
  clock_in: string;
  last_presence_ack_at: string | null;
};

export type DbExecuteConn = {
  execute: (
    sql: string,
    params?: unknown[],
  ) => Promise<[unknown[], unknown]>;
};

function employeeIdQueryVariants(employeeId: string): Array<string | number> {
  const raw = String(employeeId ?? "").trim();
  if (!raw) return [];
  const out: Array<string | number> = [raw];
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Latest assignment on/before session date with usable start/end times.
 * Tries string + numeric employee_id (Mongo/MySQL id type mismatch).
 */
export async function fetchShiftForEmployee(
  conn: DbExecuteConn,
  employeeId: string,
  onOrBeforeDate: string,
): Promise<ShiftAssignmentTiming | null> {
  const dateKey = normalizeDateKey(onOrBeforeDate) || String(onOrBeforeDate || "").trim();
  if (!dateKey) return null;

  for (const eid of employeeIdQueryVariants(employeeId)) {
    const [rows] = await conn.execute(
      `SELECT start_time, end_time, assigned_date
       FROM shift_assignments
       WHERE employee_id = ?
         AND assigned_date <= ?
       ORDER BY assigned_date DESC, id DESC
       LIMIT 8`,
      [eid, dateKey],
    );
    const list = (rows || []) as Array<{
      start_time?: unknown;
      end_time?: unknown;
      assigned_date?: unknown;
    }>;
    for (const row of list) {
      const start_time = normalizeShiftTimeString(row.start_time);
      const end_time = normalizeShiftTimeString(row.end_time);
      const assigned_date = normalizeDateKey(row.assigned_date);
      if (!start_time || !end_time || !assigned_date) continue;
      return { start_time, end_time, assigned_date };
    }
  }
  return null;
}

export function evaluatePresencePrompt(
  open: OpenAttendanceRow,
  shift: ShiftAssignmentTiming | null,
  nowMs: number = Date.now(),
) {
  if (!shift) {
    return {
      clockedIn: true,
      shouldPrompt: false,
      reason: "no_shift",
      shiftEndMs: null as number | null,
      promptAtMs: null as number | null,
    };
  }

  const sessionDateKey = clockInDateKey(open.clock_in);
  const shiftEndMs = computeShiftEndEpochMs(shift, sessionDateKey);
  if (shiftEndMs == null) {
    return {
      clockedIn: true,
      shouldPrompt: false,
      reason: "invalid_shift",
      shiftEndMs: null,
      promptAtMs: null,
    };
  }

  const clockInMs = parseAttendanceDateTimeMs(open.clock_in);
  if (clockInMs == null) {
    return {
      clockedIn: true,
      shouldPrompt: false,
      reason: "invalid_clock_in",
      shiftEndMs,
      promptAtMs: null,
    };
  }

  const ackParsed = open.last_presence_ack_at
    ? parseAttendanceDateTimeMs(open.last_presence_ack_at)
    : null;

  const resolved = resolvePresencePromptAtMs(shift, sessionDateKey, clockInMs, ackParsed);
  if (!resolved) {
    return {
      clockedIn: true,
      shouldPrompt: false,
      reason: "invalid_shift",
      shiftEndMs,
      promptAtMs: null,
    };
  }

  const { promptAtMs, mode, shiftGraceEndMs } = resolved;
  const shouldPrompt = nowMs >= promptAtMs;
  const reason = shouldPrompt
    ? "due"
    : mode === "post_shift_session"
      ? "waiting_post_shift_session_grace"
      : "waiting_shift_grace";

  return {
    clockedIn: true,
    shouldPrompt,
    reason,
    shiftEndMs,
    shiftGraceEndMs,
    promptAtMs,
    clockInMs,
    lastPresenceAckMs: ackParsed,
    presenceMode: mode,
  };
}

/** Open attendance row (clocked in, not clocked out). */
export async function employeeHasOpenClockIn(
  employeeId: string | null | undefined,
): Promise<boolean> {
  const eid = String(employeeId ?? "").trim();
  if (!eid) return false;
  try {
    const { pool } = await import("./db");
    const [rows] = await pool.execute(
      `SELECT id FROM ${ATTENDANCE_TABLE}
       WHERE employee_id = ? AND clock_out IS NULL
       ORDER BY clock_in DESC
       LIMIT 1`,
      [eid],
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/** True when shift/session 3h grace has ended — auto clock-out must not require face verify. */
export async function isGraceExpiredForEmployee(
  conn: DbExecuteConn,
  employeeId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const eid = String(employeeId ?? "").trim();
  if (!eid) return false;

  const [openRows] = await conn.execute(
    `SELECT id, employee_id,
            DATE_FORMAT(clock_in, '%Y-%m-%dT%H:%i:%s') AS clock_in,
            DATE_FORMAT(last_presence_ack_at, '%Y-%m-%dT%H:%i:%s') AS last_presence_ack_at
     FROM ${ATTENDANCE_TABLE}
     WHERE employee_id = ? AND clock_out IS NULL
     ORDER BY clock_in DESC
     LIMIT 1`,
    [eid],
  );
  const open = (openRows as OpenAttendanceRow[])[0];
  if (!open?.clock_in) return false;

  const shift = await fetchShiftForEmployee(conn, eid, clockInDateKey(open.clock_in));
  return evaluatePresencePrompt(open, shift, nowMs).shouldPrompt;
}
