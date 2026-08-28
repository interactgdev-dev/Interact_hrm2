import { ATTENDANCE_TABLE } from "./attendance-table";
import { AUTO_PRESENCE_POPUP_MS } from "./shift-timing";

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

export async function performAutoClockOut(
  conn: Conn,
  attendanceId: number,
  employeeName?: string | null,
  /** When server sweep runs late, use scheduled deadline — not Date.now(). */
  clockOutAtMs?: number,
  employeeId?: string | null,
) {
  let outMs = clockOutAtMs ?? Date.now();
  if (!Number.isFinite(outMs) || outMs <= 0) outMs = Date.now();

  // Guard: never close with a timestamp before clock_in (bad DATE_FORMAT / TZ).
  try {
    const [rows] = (await conn.execute(
      `SELECT clock_in FROM ${ATTENDANCE_TABLE} WHERE id = ? AND clock_out IS NULL LIMIT 1`,
      [attendanceId],
    )) as [{ clock_in: string | Date }[], unknown];
    const cin = rows?.[0]?.clock_in;
    if (cin != null && cin !== "") {
      const cinStr = String(cin).trim();
      const cinMs = /[zZ]$|[+-]\d{2}:\d{2}$/.test(cinStr)
        ? new Date(cinStr).getTime()
        : Date.parse(`${(cinStr.includes("T") ? cinStr : cinStr.replace(" ", "T")).replace(/\.\d+$/, "")}Z`);
      if (Number.isFinite(cinMs) && outMs <= cinMs) {
        outMs = Date.now();
        if (outMs <= cinMs) outMs = cinMs + 60_000;
      }
    }
  } catch {
    // proceed with outMs
  }

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
