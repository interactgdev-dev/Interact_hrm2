import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

const START_FIELDS = [
  "break_start",
  "prayer_break_start",
  "refreshment_break_start",
  "meeting_break_start",
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
 * Overnight post-midnight breaks still count on the clock-in day (via breakSessionDate),
 * so viewing D-1 includes them; viewing D must NOT list D-1 sessions.
 */
export function filterRowsByClockInSessionDate<T extends Record<string, unknown>>(
  rows: T[],
  fromDate: string,
  toDate: string,
): T[] {
  if (!fromDate || !toDate || !rows.length) return rows;

  return rows.filter((row) => {
    const sessionDate = breakSessionDate(row);
    if (sessionDate && sessionDate >= fromDate && sessionDate <= toDate) {
      return true;
    }

    // No session link: fall back to event calendar date in range
    const sid = row.attendance_session_id ?? row.attendanceSessionId;
    if (sid !== undefined && sid !== null && sid !== "") return false;
    if (sessionDate) return false;
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

/**
 * Keep attendance rows for the viewed range by clock-in session date only.
 * Overnight sessions belong on the clock-in day — do not list D-1 rows when viewing D.
 */
export function filterAttendanceByClockInSessionDate<T extends Record<string, unknown>>(
  rows: T[],
  fromDate: string,
  toDate: string,
): T[] {
  if (!fromDate || !toDate || !rows.length) return rows;

  return rows.filter((row) => {
    const sessionDate = attendanceSessionDate(row as any);
    if (!sessionDate) return false;
    return sessionDate >= fromDate && sessionDate <= toDate;
  });
}
