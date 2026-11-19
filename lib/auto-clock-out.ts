import { ATTENDANCE_TABLE } from "./attendance-table";
import { getEmployeeMatchKeys } from "./biometric-employee";
import { findLastTungstenPunchAfter } from "./mongo-zkbio-punch-log";
import {
  AUTO_PRESENCE_POPUP_MS,
  parseAttendanceDateTimeMs,
} from "./shift-timing";

type Conn = {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
};

/** Server-side auto clock-out after promptAt + 5 min popup window. */
export function shouldServerAutoClockOut(
  promptAtMs: number | null,
  clockInMs: number | null,
  lastPresenceAckMs: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (promptAtMs == null || clockInMs == null) return false;
  if (nowMs < promptAtMs + AUTO_PRESENCE_POPUP_MS) return false;
  if (lastPresenceAckMs != null && lastPresenceAckMs >= promptAtMs) return false;
  return true;
}

/** End open lunch/prayer breaks when system clocks the employee out. */
export async function closeActiveBreaksForEmployee(
  conn: Conn,
  employeeId: string,
  endTimeFormatted: string,
  endTimeIso: string,
): Promise<void> {
  const eid = String(employeeId ?? "").trim();
  if (!eid) return;

  const endMs = new Date(endTimeIso).getTime();

  const [breakRows] = (await conn.execute(
    "SELECT id, break_start FROM breaks WHERE employee_id = ? AND break_end IS NULL ORDER BY break_start DESC LIMIT 1",
    [Number(eid)],
  )) as [{ id: number; break_start: string }[], unknown];

  const openBreak = breakRows[0];
  if (openBreak?.break_start) {
    const startMs = new Date(`${openBreak.break_start}Z`).getTime();
    const duration =
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, (endMs - startMs) / 1000)
        : 0;
    await conn.execute("UPDATE breaks SET break_end = ?, break_duration = ? WHERE id = ?", [
      endTimeFormatted,
      duration,
      openBreak.id,
    ]);
  }

  const [prayerRows] = (await conn.execute(
    "SELECT id, prayer_break_start FROM prayer_breaks WHERE employee_id = ? AND prayer_break_end IS NULL ORDER BY prayer_break_start DESC LIMIT 1",
    [Number(eid)],
  )) as [{ id: number; prayer_break_start: string }[], unknown];

  const openPrayer = prayerRows[0];
  if (openPrayer?.prayer_break_start) {
    const startMs = new Date(`${openPrayer.prayer_break_start}Z`).getTime();
    const duration =
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, (endMs - startMs) / 1000)
        : 0;
    await conn.execute(
      "UPDATE prayer_breaks SET prayer_break_end = ?, prayer_break_duration = ? WHERE id = ?",
      [endTimeFormatted, duration, openPrayer.id],
    );
  }

  const closeOpenSessionBreak = async (
    table: "refreshment_breaks" | "meeting_breaks",
    startCol: string,
    endCol: string,
    durationCol: string,
  ) => {
    const [rows] = (await conn.execute(
      `SELECT id, ${startCol} FROM ${table} WHERE employee_id = ? AND ${endCol} IS NULL ORDER BY ${startCol} DESC LIMIT 1`,
      [Number(eid)],
    )) as [{ id: number; [key: string]: string | number }[], unknown];
    const openRow = rows[0];
    const startValue = openRow?.[startCol];
    if (startValue) {
      const startMs = new Date(`${startValue}Z`).getTime();
      const duration =
        Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(0, (endMs - startMs) / 1000)
          : 0;
      await conn.execute(`UPDATE ${table} SET ${endCol} = ?, ${durationCol} = ? WHERE id = ?`, [
        endTimeFormatted,
        duration,
        openRow.id,
      ]);
    }
  };

  await closeOpenSessionBreak(
    "refreshment_breaks",
    "refreshment_break_start",
    "refreshment_break_end",
    "refreshment_break_duration",
  );
  await closeOpenSessionBreak(
    "meeting_breaks",
    "meeting_break_start",
    "meeting_break_end",
    "meeting_break_duration",
  );
}

/** Search window after scheduled auto-out for a late T.Punch Out (overnight exits). */
const T_PUNCH_OUT_LOOKAHEAD_MS = 3 * 60 * 60 * 1000;

/**
 * Prefer last Tungsten (ZKBio) punch after clock-in as the HRM clock_out time
 * so monthly status (early leave / on time / hours) matches T.Punch Out.
 */
async function resolveAutoClockOutMs(opts: {
  conn: Conn;
  attendanceId: number;
  employeeId?: string | null;
  scheduledMs: number;
  /** When reconciling an already-closed auto-out, allow reading clock_in even if clock_out is set. */
  allowClosed?: boolean;
  /** Cap punch search (reconcile: current clock_out + lookahead, not "now"). */
  searchBeforeMs?: number;
}): Promise<number> {
  const scheduled = Number.isFinite(opts.scheduledMs) ? opts.scheduledMs : Date.now();
  const eid = String(opts.employeeId ?? "").trim();
  if (!eid) return scheduled;

  try {
    const [rows] = (await opts.conn.execute(
      opts.allowClosed
        ? `SELECT DATE_FORMAT(clock_in, '%Y-%m-%dT%H:%i:%s') AS clock_in
           FROM ${ATTENDANCE_TABLE}
           WHERE id = ?
           LIMIT 1`
        : `SELECT DATE_FORMAT(clock_in, '%Y-%m-%dT%H:%i:%s') AS clock_in
           FROM ${ATTENDANCE_TABLE}
           WHERE id = ? AND clock_out IS NULL
           LIMIT 1`,
      [opts.attendanceId],
    )) as [{ clock_in?: string }[], unknown];

    const clockInRaw = rows[0]?.clock_in;
    const clockInMs = clockInRaw ? parseAttendanceDateTimeMs(clockInRaw) : null;
    if (clockInMs == null) return scheduled;

    const { dbIds } = await getEmployeeMatchKeys(eid);
    const pins = [...new Set(dbIds.map((p) => String(p).trim()).filter(Boolean))];
    if (!pins.length) return scheduled;

    const beforeMs =
      opts.searchBeforeMs != null && Number.isFinite(opts.searchBeforeMs)
        ? opts.searchBeforeMs
        : Math.max(scheduled, Date.now()) + T_PUNCH_OUT_LOOKAHEAD_MS;

    const last = await findLastTungstenPunchAfter({
      pins,
      afterMs: clockInMs,
      // Include punches that arrive shortly after the grace/popup deadline
      // (e.g. auto-out 01:05, T.Punch Out 01:15).
      beforeMs,
    });
    if (last && last.atMs > clockInMs) return last.atMs;
  } catch {
    /* fall back to scheduled */
  }
  return scheduled;
}

/**
 * After T.Punch sync, rewrite recent auto clock-outs so clock_out = T.Punch Out.
 * Fixes rows closed at grace time before the Tungsten exit punch existed.
 */
export async function reconcileAutoClockOutsWithTPunch(
  conn: Conn,
  opts?: { lookbackDays?: number; employeeId?: string | null },
): Promise<number> {
  const lookbackDays = Math.max(1, Math.min(31, opts?.lookbackDays ?? 7));
  const eid = String(opts?.employeeId ?? "").trim();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  const [rows] = (await conn.execute(
    eid
      ? `SELECT id, employee_id,
                DATE_FORMAT(clock_in, '%Y-%m-%dT%H:%i:%s') AS clock_in,
                DATE_FORMAT(clock_out, '%Y-%m-%dT%H:%i:%s') AS clock_out
         FROM ${ATTENDANCE_TABLE}
         WHERE auto_clock_out = 1
           AND clock_out IS NOT NULL
           AND clock_in >= ?
           AND employee_id = ?`
      : `SELECT id, employee_id,
                DATE_FORMAT(clock_in, '%Y-%m-%dT%H:%i:%s') AS clock_in,
                DATE_FORMAT(clock_out, '%Y-%m-%dT%H:%i:%s') AS clock_out
         FROM ${ATTENDANCE_TABLE}
         WHERE auto_clock_out = 1
           AND clock_out IS NOT NULL
           AND clock_in >= ?`,
    eid ? [since, eid] : [since],
  )) as [
    {
      id: number;
      employee_id: string | number;
      clock_in?: string;
      clock_out?: string;
    }[],
    unknown,
  ];

  let updated = 0;
  for (const row of rows) {
    const currentOutMs = row.clock_out
      ? parseAttendanceDateTimeMs(row.clock_out)
      : null;
    if (currentOutMs == null) continue;
    const clockInMs = row.clock_in
      ? parseAttendanceDateTimeMs(row.clock_in)
      : null;

    // Overnight: early wrong auto-out (~evening) must still see next-morning T.Punch.
    // Cap by clock_in + 14h (not currentOut+3h alone) so Fri 1:02 can rewrite Thu 6:46.
    const searchBeforeMs = Math.max(
      currentOutMs + T_PUNCH_OUT_LOOKAHEAD_MS,
      clockInMs != null ? clockInMs + 14 * 60 * 60 * 1000 : currentOutMs,
    );

    const punchMs = await resolveAutoClockOutMs({
      conn,
      attendanceId: row.id,
      employeeId: String(row.employee_id),
      scheduledMs: currentOutMs,
      allowClosed: true,
      searchBeforeMs,
    });

    // Only rewrite when Tungsten found a real exit different from stored clock_out
    if (punchMs === currentOutMs || Math.abs(punchMs - currentOutMs) < 1000) continue;
    if (punchMs <= (clockInMs ?? 0)) continue;
    // Prefer a later exit (real overnight out) over keeping an early mid-shift close
    if (punchMs < currentOutMs) continue;

    const outDate = new Date(punchMs);
    const formatted = outDate.toISOString().slice(0, 19).replace("T", " ");
    await conn.execute(
      `UPDATE ${ATTENDANCE_TABLE}
       SET clock_out = ?,
           total_hours = LEAST(999.99, ROUND(TIMESTAMPDIFF(MINUTE, clock_in, ?)/60, 2))
       WHERE id = ? AND auto_clock_out = 1`,
      [formatted, formatted, row.id],
    );
    updated += 1;
  }
  return updated;
}

export async function performAutoClockOut(
  conn: Conn,
  attendanceId: number,
  employeeName?: string | null,
  /** When server sweep runs late, use scheduled deadline — not Date.now(). */
  clockOutAtMs?: number,
  employeeId?: string | null,
) {
  const scheduledMs = clockOutAtMs ?? Date.now();
  const outMs = await resolveAutoClockOutMs({
    conn,
    attendanceId,
    employeeId,
    scheduledMs,
  });
  const outDate = new Date(outMs);
  const formattedClockOut = outDate.toISOString().slice(0, 19).replace("T", " ");

  if (employeeId) {
    await closeActiveBreaksForEmployee(
      conn,
      employeeId,
      formattedClockOut,
      outDate.toISOString(),
    );
  }

  await conn.execute(
    `UPDATE ${ATTENDANCE_TABLE}
     SET clock_out = ?,
         auto_clock_out = 1,
         last_presence_ack_at = NULL,
         total_hours = LEAST(999.99, ROUND(TIMESTAMPDIFF(MINUTE, clock_in, ?)/60, 2)),
         employee_name = COALESCE(employee_name, ?)
     WHERE id = ? AND clock_out IS NULL`,
    [formattedClockOut, formattedClockOut, employeeName ?? null, attendanceId],
  );

  return { clock_out: outDate.toISOString(), formatted: formattedClockOut };
}
