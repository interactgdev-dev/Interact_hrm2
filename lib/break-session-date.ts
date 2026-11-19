import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

const START_FIELDS = [
  "break_start",
  "prayer_break_start",
  "refreshment_break_start",
  "meeting_break_start",
] as const;

const END_FIELDS = [
  "break_end",
  "prayer_break_end",
  "refreshment_break_end",
  "meeting_break_end",
] as const;

/** YYYY-MM-DD ± days in calendar arithmetic (UTC date parts). */
export function addCalendarDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = String(ymd || "")
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function firstTruthy(row: Record<string, unknown>, fields: readonly string[]): unknown {
  for (const f of fields) {
    const v = row[f];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * Break/prayer "shift date" = attendance clock-in calendar day when known.
 * Overnight: post-midnight breaks still belong to yesterday's clock-in.
 */
export function breakSessionDate(row: Record<string, unknown>): string {
  if (row.session_clock_in) {
    return getDateStringInTimeZone(String(row.session_clock_in), SERVER_TIMEZONE);
  }
  if (row.date) {
    const raw = String(row.date);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return getDateStringInTimeZone(raw, SERVER_TIMEZONE);
  }
  const start = firstTruthy(row, START_FIELDS);
  if (start) return getDateStringInTimeZone(String(start), SERVER_TIMEZONE);
  return "";
}

export function breakEventDate(row: Record<string, unknown>): string {
  const start = firstTruthy(row, START_FIELDS);
  if (!start) return "";
  return getDateStringInTimeZone(String(start), SERVER_TIMEZONE);
}

function isRunningBreak(row: Record<string, unknown>): boolean {
  const start = firstTruthy(row, START_FIELDS);
  if (!start) return false;
  return !firstTruthy(row, END_FIELDS);
}

function sessionKey(row: Record<string, unknown>): string {
  const emp = String(row.employee_id ?? row.employeeId ?? "");
  const sid = row.attendance_session_id ?? row.attendanceSessionId;
  if (sid !== undefined && sid !== null && sid !== "") {
    return `${emp}|attendance:${sid}`;
  }
  const start = firstTruthy(row, START_FIELDS);
  return `${emp}|row:${row.id ?? start ?? ""}`;
}

/**
 * Expand API fetch window so overnight sessions (clock-in day → next morning) are included.
 */
export function overnightFetchRange(fromDate: string, toDate: string): {
  fromDate: string;
  toDate: string;
} {
  return {
    fromDate: addCalendarDays(fromDate, -1),
    toDate: addCalendarDays(toDate, 1),
  };
}

/**
 * Keep rows whose clock-in session date falls in [fromDate, toDate].
 * Also, when viewing a single day D, keep overnight sessions that clocked in on D-1
 * and still have activity on/after D (or an open/running break) so live totals
 * after midnight include pre-midnight breaks.
 */
export function filterRowsByClockInSessionDate<T extends Record<string, unknown>>(
  rows: T[],
  fromDate: string,
  toDate: string,
): T[] {
  if (!fromDate || !toDate || !rows.length) return rows;

  const allowedSessions = new Set<string>();
  const dayBeforeFrom = addCalendarDays(fromDate, -1);

  for (const row of rows) {
    const sessionDate = breakSessionDate(row);
    const eventDate = breakEventDate(row);
    const key = sessionKey(row);

    if (sessionDate && sessionDate >= fromDate && sessionDate <= toDate) {
      allowedSessions.add(key);
      continue;
    }

    // Overnight continuation into the viewed day(s)
    if (sessionDate && sessionDate === dayBeforeFrom && sessionDate < fromDate) {
      const crosses =
        Boolean(eventDate && eventDate >= fromDate) || isRunningBreak(row);
      if (crosses) allowedSessions.add(key);
    }
  }

  return rows.filter((row) => {
    const key = sessionKey(row);
    if (allowedSessions.has(key)) return true;

    // No session link: fall back to event calendar date in range
    const sid = row.attendance_session_id ?? row.attendanceSessionId;
    if (sid !== undefined && sid !== null && sid !== "") return false;
    const eventDate = breakEventDate(row);
    return Boolean(eventDate && eventDate >= fromDate && eventDate <= toDate);
  });
}

/** Attendance row "shift date" = clock-in calendar day (Karachi). */
export function attendanceSessionDate(row: {
  clock_in?: string | null;
  date?: string | null;
}): string {
  if (row.clock_in) {
    return getDateStringInTimeZone(String(row.clock_in), SERVER_TIMEZONE);
  }
  if (row.date) {
    const raw = String(row.date);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return getDateStringInTimeZone(raw, SERVER_TIMEZONE);
  }
  return "";
}

function attendanceClockOutDate(row: {
  clock_out?: string | null;
}): string {
  if (!row.clock_out) return "";
  return getDateStringInTimeZone(String(row.clock_out), SERVER_TIMEZONE);
}

/**
 * Keep attendance rows for the viewed range by clock-in session date.
 * Overnight: open (or still crossing) sessions from D-1 stay visible on D.
 */
export function filterAttendanceByClockInSessionDate<T extends Record<string, unknown>>(
  rows: T[],
  fromDate: string,
  toDate: string,
): T[] {
  if (!fromDate || !toDate || !rows.length) return rows;

  const dayBeforeFrom = addCalendarDays(fromDate, -1);

  return rows.filter((row) => {
    const sessionDate = attendanceSessionDate(row as any);
    if (!sessionDate) return false;

    if (sessionDate >= fromDate && sessionDate <= toDate) return true;

    // Overnight continuation into viewed day(s)
    if (sessionDate === dayBeforeFrom && sessionDate < fromDate) {
      const outDate = attendanceClockOutDate(row as any);
      const stillOpen = !(row as any).clock_out;
      return stillOpen || Boolean(outDate && outDate >= fromDate);
    }

    return false;
  });
}
