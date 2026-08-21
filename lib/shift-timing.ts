import { addDaysToDateKey } from "./tungsten-punch-pairing";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "./timezone";

export const AUTO_PRESENCE_GRACE_MS = 3 * 60 * 60 * 1000;
export const AUTO_PRESENCE_POPUP_MS = 5 * 60 * 1000;

export type ShiftAssignmentTiming = {
  start_time: string;
  end_time: string;
  assigned_date: string;
};

/** MySQL DATE/DATETIME may arrive as Date — always coerce to YYYY-MM-DD (Karachi). */
export function normalizeDateKey(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return getDateStringInTimeZone(value, SERVER_TIMEZONE);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const key = getDateStringInTimeZone(s, SERVER_TIMEZONE);
    return key || s.slice(0, 10);
  }
  const key = getDateStringInTimeZone(s, SERVER_TIMEZONE);
  return key || null;
}

function parseShiftTimeHms(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!match) return null;
  return {
    h: Number(match[1]),
    m: Number(match[2]),
    s: Number(match[3] || "0"),
  };
}

/** Wall-clock on dateKey in Asia/Karachi (UTC+5, no DST). */
export function wallClockToEpochMs(dateKey: string, timeValue: string): number | null {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const hms = parseShiftTimeHms(timeValue);
  if (!y || !mo || !d || !hms) return null;
  return Date.UTC(y, mo - 1, d, hms.h - 5, hms.m, hms.s);
}

function timeToMinutes(timeValue: string) {
  const hms = parseShiftTimeHms(timeValue);
  if (!hms) return null;
  return hms.h * 60 + hms.m;
}

/**
 * When the shift ends for a work session.
 * Uses sessionDateKey (clock-in day in Karachi) so effective-dated assignments
 * (e.g. assigned_date 4 Jun, still active on 5 Jun) end on the session day.
 */
export function computeShiftStartEpochMs(
  shift: ShiftAssignmentTiming,
  sessionDateKey?: string,
): number | null {
  const baseDate = sessionDateKey ?? normalizeDateKey(shift.assigned_date);
  if (!baseDate) return null;
  return wallClockToEpochMs(baseDate, shift.start_time);
}

export function computeShiftEndEpochMs(
  shift: ShiftAssignmentTiming,
  sessionDateKey?: string,
): number | null {
  const baseDate = sessionDateKey ?? normalizeDateKey(shift.assigned_date);
  if (!baseDate) return null;

  const startMin = timeToMinutes(shift.start_time);
  const endMin = timeToMinutes(shift.end_time);
  if (startMin == null || endMin == null) return null;

  const endDateKey =
    endMin <= startMin ? addDaysToDateKey(baseDate, 1) : baseDate;

  return wallClockToEpochMs(endDateKey, shift.end_time);
}

/** Within 2h of shift start = early arrival for tonight's shift (not post-shift OT). */
const EARLY_ARRIVAL_BEFORE_SHIFT_MS = 2 * 60 * 60 * 1000;

export type PresencePromptMode = "shift_grace" | "post_shift_session";

export function resolvePresencePromptAtMs(
  shift: ShiftAssignmentTiming,
  sessionDateKey: string,
  clockInMs: number,
  lastPresenceAckMs: number | null,
): { promptAtMs: number; mode: PresencePromptMode; shiftGraceEndMs: number } | null {
  const shiftEndMs = computeShiftEndEpochMs(shift, sessionDateKey);
  if (shiftEndMs == null) return null;

  const shiftStartMs = computeShiftStartEpochMs(shift, sessionDateKey);

  // Clocked in after today's shift already ended → fresh 3h from clock-in.
  if (clockInMs >= shiftEndMs) {
    const promptAtMs = computeSessionGracePromptAtMs(clockInMs, lastPresenceAckMs);
    return {
      promptAtMs,
      mode: "post_shift_session",
      shiftGraceEndMs: clockInMs + AUTO_PRESENCE_GRACE_MS,
    };
  }

  // Clocked in after yesterday's shift ended but before today's shift (e.g. 1 AM OT).
  const prevDateKey = addDaysToDateKey(sessionDateKey, -1);
  const prevShiftEndMs = prevDateKey
    ? computeShiftEndEpochMs(shift, prevDateKey)
    : null;
  if (
    prevShiftEndMs != null &&
    shiftStartMs != null &&
    clockInMs >= prevShiftEndMs &&
    clockInMs < shiftStartMs &&
    shiftStartMs - clockInMs > EARLY_ARRIVAL_BEFORE_SHIFT_MS
  ) {
    const promptAtMs = computeSessionGracePromptAtMs(clockInMs, lastPresenceAckMs);
    return {
      promptAtMs,
      mode: "post_shift_session",
      shiftGraceEndMs: clockInMs + AUTO_PRESENCE_GRACE_MS,
    };
  }

  const promptAtMs = computePresencePromptAtMs(shiftEndMs, lastPresenceAckMs);
  return {
    promptAtMs,
    mode: "shift_grace",
    shiftGraceEndMs: shiftEndMs + AUTO_PRESENCE_GRACE_MS,
  };
}

/**
 * Parse MySQL / ISO attendance timestamps to epoch ms.
 * INSERT uses toISOString().slice(0,19) (UTC wall in DB). mysql2 Date uses local components for that wall.
 */
export function parseAttendanceDateTimeMs(value: string | Date | unknown): number | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Mongo BSON Date is a true UTC instant; mysql2 Date encodes UTC-wall via local comps.
    const driver = String(process.env.DB_DRIVER || process.env.DATABASE_DRIVER || "").toLowerCase();
    if (driver === "mongo" || driver === "mongodb") {
      return value.getTime();
    }
    return Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    );
  }

  const s = String(value).trim();
  if (!s || s === "null") return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const t = Date.parse(`${iso}Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Popup time from Shift Management: assigned shift end + 3h extra session.
 * After "I am here": also at least last ack + 3h.
 */
export function computePresencePromptAtMs(
  shiftEndMs: number,
  lastPresenceAckMs: number | null,
): number {
  const shiftGraceEndMs = shiftEndMs + AUTO_PRESENCE_GRACE_MS;
  if (lastPresenceAckMs == null || Number.isNaN(lastPresenceAckMs)) {
    return shiftGraceEndMs;
  }
  return Math.max(shiftGraceEndMs, lastPresenceAckMs + AUTO_PRESENCE_GRACE_MS);
}

/**
 * Fresh session after today's shift + grace finished: clock-in + 3h.
 * After "I am here": also at least last ack + 3h.
 */
export function computeSessionGracePromptAtMs(
  clockInMs: number,
  lastPresenceAckMs: number | null,
): number {
  const sessionGraceEndMs = clockInMs + AUTO_PRESENCE_GRACE_MS;
  if (lastPresenceAckMs == null || Number.isNaN(lastPresenceAckMs)) {
    return sessionGraceEndMs;
  }
  return Math.max(sessionGraceEndMs, lastPresenceAckMs + AUTO_PRESENCE_GRACE_MS);
}

export function clockInDateKey(clockIn: string | Date | unknown): string {
  const parsedMs = parseAttendanceDateTimeMs(clockIn);
  if (parsedMs != null) {
    return getDateStringInTimeZone(parsedMs, SERVER_TIMEZONE);
  }
  if (clockIn instanceof Date || typeof clockIn === "string" || typeof clockIn === "number") {
    return getDateStringInTimeZone(clockIn, SERVER_TIMEZONE);
  }
  const key = normalizeDateKey(clockIn);
  return key ?? "";
}
