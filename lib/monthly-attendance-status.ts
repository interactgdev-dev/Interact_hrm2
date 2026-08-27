import { normalizeAttendanceStatus } from "./attendance-status";
import {
  dateTimeLocalToIsoInTimeZone,
  getParts,
  getTimeInMinutesInTimeZone,
  SERVER_TIMEZONE,
} from "./timezone";

export const STATUS_FIRST_HALF_DAY = "1st-Half Day";
export const STATUS_SECOND_HALF_DAY = "2nd-Half Day";

/** HR standard 9h evening shift (Interact Global). */
export const HR_DEFAULT_SHIFT_START = "17:30:00";
export const HR_DEFAULT_SHIFT_END = "02:30:00";

export function defaultHrShiftTiming(): { start: string; end: string } {
  return { start: HR_DEFAULT_SHIFT_START, end: HR_DEFAULT_SHIFT_END };
}

export type DayAttendanceStatus = {
  statusLabel: string;
  isLate: boolean;
  lateMinutes: number;
};

export function graceMinutesForGender(gender: string | null | undefined): number {
  const g = String(gender || "").trim().toLowerCase();
  if (g === "female") return 15;
  if (g === "male") return 10;
  return 10;
}

export function parseShiftTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const parts = String(timeStr).split(":");
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

export function shiftDurationSeconds(
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): number {
  const startMin = parseShiftTimeToMinutes(shiftStart);
  const endMin = parseShiftTimeToMinutes(shiftEnd);
  if (startMin === null || endMin === null) return 0;
  let seconds = (endMin - startMin) * 60;
  if (seconds <= 0) seconds += 24 * 3600;
  return seconds;
}

function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = getParts(value, SERVER_TIMEZONE);
  if (!parts) return null;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

export function workedSecondsBetween(
  clockIn: string | null | undefined,
  clockOut: string | null | undefined,
): number {
  const startMs = toEpochMs(clockIn);
  let endMs = toEpochMs(clockOut);
  if (startMs == null || endMs == null) return 0;
  if (endMs <= startMs) {
    endMs += 24 * 60 * 60 * 1000;
    if (endMs <= startMs) return 0;
  }
  return Math.floor((endMs - startMs) / 1000);
}

/** Parse "05h 30m" / "03:01:00" / "3:01" / Excel duration serial from imported cells. */
export function parseHmDurationToSeconds(
  text: string | number | null | undefined | unknown,
): number {
  if (text == null) return 0;
  if (typeof text === "number" && Number.isFinite(text)) {
    const fraction = text >= 1 ? text % 1 : text;
    if (fraction > 0 && fraction < 1) return Math.round(fraction * 24 * 3600);
    if (text > 0 && text < 24) return Math.round(text * 3600);
    return 0;
  }
  const raw = String(text).trim();
  if (!raw || raw === "---" || raw === "-") return 0;
  const match = raw.match(/(\d{1,2})\s*h\s*(\d{1,2})\s*m/i);
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60;
  const hoursOnly = raw.match(/^(\d{1,2})\s*h$/i);
  if (hoursOnly) return Number(hoursOnly[1]) * 3600;
  const hms = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hms) {
    return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3] || "0");
  }
  const compact = raw.match(/(\d{1,2})\s*h\s*(\d{1,2})\s*m/i) || raw.match(/(\d{1,2})h\s*(\d{1,2})m/i);
  if (compact) return Number(compact[1]) * 3600 + Number(compact[2]) * 60;
  return 0;
}

/** Prefer Total W.H column text for imported rows (display string on sheet). */
export function parseImportedTotalWorkSeconds(totalWH: string | unknown): number {
  const parsed = parseHmDurationToSeconds(totalWH);
  if (parsed > 0) return parsed;
  return 0;
}

/** HR imported: 2h–3h15m total work → Absent (e.g. 03h 01m), not Tardy. */
export function isImportedShortShiftAbsent(workedSeconds: number): boolean {
  if (workedSeconds <= 0) return false;
  return workedSeconds >= 2 * 3600 && workedSeconds <= 3 * 3600 + 15 * 60;
}

/** Force Absent on sheet row when Total W.H is in 2h–3h15m band. */
export function applyImportedAbsentIfShortShift(day: ImportedDayClockFields): boolean {
  const fromTotal = parseImportedTotalWorkSeconds(day.totalWH);
  if (fromTotal > 0 && isImportedShortShiftAbsent(fromTotal)) return true;
  const worked = importedWorkedSecondsForDay(day);
  return isImportedShortShiftAbsent(worked);
}

/** Total W.H from sheet is primary for imported row classification. */
export function importedWorkedSecondsForDay(day: {
  totalWH: string;
  clockIn: string;
  clockOut: string;
  dateKey: string;
}): number {
  const fromSheet = parseImportedTotalWorkSeconds(day.totalWH);
  const clockInIso = parseDisplayClockToIso(day.dateKey, day.clockIn, 0);
  let clockOutAddDays = 0;
  if (!isEmptyClockDisplay(day.clockIn) && !isEmptyClockDisplay(day.clockOut)) {
    const outSame = parseDisplayClockToIso(day.dateKey, day.clockOut, 0);
    const inIsPm = /PM/i.test(String(day.clockIn));
    const outIsAm = /AM/i.test(String(day.clockOut));
    if (
      (clockInIso && outSame && new Date(outSame).getTime() <= new Date(clockInIso).getTime()) ||
      (inIsPm && outIsAm)
    ) {
      clockOutAddDays = 1;
    }
  }
  const clockOutIso = parseDisplayClockToIso(day.dateKey, day.clockOut, clockOutAddDays);
  const fromClocks = workedSecondsBetween(clockInIso, clockOutIso);
  if (fromSheet > 0) {
    if (fromClocks > 0 && fromClocks > fromSheet + 3600) return fromSheet;
    return Math.max(fromSheet, fromClocks);
  }
  return fromClocks;
}

export function shiftSecondsFromAssignedWH(assignedWH: string | null | undefined): number {
  const parsed = parseImportedTotalWorkSeconds(assignedWH);
  if (parsed >= 2 * 3600) return parsed;
  return 9 * 3600;
}

/** Assigned shift ~5h (e.g. 05h 00m) — no half-day rules; deduction from absences only. */
export function isFiveHourAssignedShift(assignedWH: string | null | undefined): boolean {
  const sec = shiftSecondsFromAssignedWH(assignedWH);
  return sec >= 4.5 * 3600 && sec <= 6 * 3600;
}

export function importedDeductionForFiveHourShift(statusLabel: string): string {
  const s = normalizeAttendanceStatus(statusLabel);
  if (s === "Absent") return "100%";
  return "0%";
}

export function totalDeductionPercentForFiveHourDays(
  days: { status?: string; sheetStatus?: string }[],
): number {
  let count = 0;
  days.forEach((day) => {
    const s = normalizeAttendanceStatus(day.status || day.sheetStatus || "");
    if (s === "Absent") count += 1;
  });
  return count * 100;
}

/** Absent from worked hours only (no shift start/end — for imported HRM rows). */
export function isAbsentByWorkedHours(workedSeconds: number, shiftSeconds: number): boolean {
  if (workedSeconds <= 0) return false;
  if (isImportedShortShiftAbsent(workedSeconds)) return true;
  const effective = shiftSeconds > 0 ? shiftSeconds : 9 * 3600;
  if (workedSeconds < absentThresholdSeconds(effective)) return true;
  if (effective >= 7 * 3600 && workedSeconds < 3 * 3600) return true;
  return false;
}

function addDaysToDateKey(dateKey: string, addDays: number): string {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + addDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Parse "11:52:14 PM" on a date key into ISO for classification (server timezone). */
export function parseDisplayClockToIso(
  dateKey: string,
  timeStr: string | null | undefined,
  addDays = 0,
): string | null {
  if (!timeStr || !dateKey) return null;
  const raw = String(timeStr).trim();
  if (!raw || raw === "---" || raw === "-") return null;

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || "0");
  const ampm = (match[4] || "").toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const key = addDays ? addDaysToDateKey(dateKey, addDays) : dateKey;
  const dateTimeLocal = `${key}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  const iso = dateTimeLocalToIsoInTimeZone(dateTimeLocal, SERVER_TIMEZONE);
  return iso || null;
}

export function isEmptyClockDisplay(value: string | null | undefined) {
  const v = String(value ?? "").trim();
  return !v || v === "---" || v === "-";
}

export function normalizeShiftTimeString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}:00`;
  }
  const raw = String(value).trim();
  const timePart = raw.includes("T") ? raw.split("T")[1]?.slice(0, 8) || "" : raw.slice(0, 8);
  const parts = timePart.split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export function formatDbClockInForLateCheck(clockIn: unknown): string | null {
  if (!clockIn) return null;
  const raw = String(clockIn).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  const d = new Date(raw + (raw.includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Same tardy rules as GET /api/attendance (shift required; no shift → not late). */
export const TARDY_RELAXATION_MINUTES = 60;
/** Clock-in later than this → Half Day (not Tardy); late minutes not counted. */
export const LATE_HALF_DAY_THRESHOLD_MINUTES = 3 * 60 + 30; // 3h 30m

export type ClockInLateStatus = {
  isLate: boolean;
  /** Minutes past shift start when late (stored in DB). */
  lateMinutes: number;
  /** After 1h tardy relaxation (legacy billable helper; UI shows raw lateMinutes). */
  excessLateMinutes: number;
};

export function excessLateMinutesFromRaw(rawLateMinutes: number | null | undefined): number {
  const n = Number(rawLateMinutes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.floor(n) - TARDY_RELAXATION_MINUTES);
}

export function isLatePastHalfDayThreshold(rawLateMinutes: number | null | undefined): boolean {
  const n = Number(rawLateMinutes);
  return Number.isFinite(n) && n > LATE_HALF_DAY_THRESHOLD_MINUTES;
}

/** Absent / Half Day must not contribute late minutes in monthly attendance. */
export function lateCountsForStatus(statusLabel: string | null | undefined): boolean {
  const s = normalizeAttendanceStatus(statusLabel || "");
  if (!s || s === "Absent") return false;
  if (s === STATUS_FIRST_HALF_DAY || s === STATUS_SECOND_HALF_DAY) return false;
  return s === "Tardy";
}

export function computeClockInLateStatus(
  clockIn: unknown,
  shiftStart: unknown,
  gender?: string | null
): ClockInLateStatus {
  const shift = normalizeShiftTimeString(shiftStart);
  const clockIso = formatDbClockInForLateCheck(clockIn);
  if (!shift || !clockIso) {
    return { isLate: false, lateMinutes: 0, excessLateMinutes: 0 };
  }
  return computeLate(clockIso, shift, graceMinutesForGender(gender));
}

function computeLate(
  clockIn: string | null | undefined,
  shiftStart: string | null | undefined,
  graceMinutes: number,
): ClockInLateStatus {
  const shiftStartMinutes = parseShiftTimeToMinutes(shiftStart);
  const clockInMinutes = clockIn ? getTimeInMinutesInTimeZone(clockIn, SERVER_TIMEZONE) : null;
  if (shiftStartMinutes === null || clockInMinutes === null) {
    return { isLate: false, lateMinutes: 0, excessLateMinutes: 0 };
  }
  let diff = clockInMinutes - shiftStartMinutes;
  if (diff < -12 * 60) diff += 24 * 60;
  if (diff <= graceMinutes) return { isLate: false, lateMinutes: 0, excessLateMinutes: 0 };
  // Past gender grace: store full minutes from shift start; billable late subtracts 1h relaxation.
  const lateMinutes = diff;
  return {
    isLate: true,
    lateMinutes,
    excessLateMinutes: excessLateMinutesFromRaw(lateMinutes),
  };
}

/** Absent if worked hours are well below half-day threshold (scales with shift length). */
export function absentThresholdSeconds(shiftSeconds: number): number {
  if (shiftSeconds <= 0) return 3 * 3600;
  const half = shiftSeconds / 2;
  if (shiftSeconds >= 7 * 3600) {
    return Math.min(3.5 * 3600, half * 0.78);
  }
  return Math.max(2 * 3600, half * 0.55);
}

function minutesFromShiftHms(dateKey: string, timeStr: string | null | undefined): number | null {
  if (!timeStr || !dateKey) return null;
  const parts = String(timeStr).split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const min = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  const iso = dateTimeLocalToIsoInTimeZone(
    `${dateKey}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`,
    SERVER_TIMEZONE,
  );
  if (!iso) return null;
  return getTimeInMinutesInTimeZone(iso, SERVER_TIMEZONE);
}

function minutesFromDisplayClock(
  dateKey: string,
  display: string | null | undefined,
  addDays = 0,
): number | null {
  const iso = parseDisplayClockToIso(dateKey, display, addDays);
  if (!iso) return null;
  return getTimeInMinutesInTimeZone(iso, SERVER_TIMEZONE);
}

function minutesFromClockValue(dateKey: string, clock: string, addDays = 0): number | null {
  if (!clock) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(clock)) {
    return getTimeInMinutesInTimeZone(clock, SERVER_TIMEZONE);
  }
  return minutesFromDisplayClock(dateKey, clock, addDays);
}

/** HR: half day ~3.5h–5.5h on 9h shift (03h 48m, 04h 25m, etc.; scales with assigned shift). */
export function halfDayWorkedBandSeconds(shiftSeconds: number): { lower: number; upper: number } {
  const base = shiftSeconds > 0 ? shiftSeconds : 9 * 3600;
  const scale = base / (9 * 3600);
  return {
    lower: 3.5 * 3600 * scale,
    upper: 5.5 * 3600 * scale,
  };
}

/** ~3.5h–4.5h short first-half leave (e.g. 03h 48m, 04h 18m). */
export function isPartialFirstHalfHours(workedSeconds: number, shiftSeconds: number): boolean {
  const base = shiftSeconds > 0 ? shiftSeconds : 9 * 3600;
  const scale = base / (9 * 3600);
  const low = 3.5 * 3600 * scale;
  const high = 4.5 * 3600 * scale;
  return workedSeconds >= low && workedSeconds <= high;
}

export function isWorkedHoursInHalfDayBand(workedSeconds: number, shiftSeconds: number): boolean {
  if (workedSeconds <= 0) return false;
  if (isOverHalfDayWorkLimit(workedSeconds, shiftSeconds)) return false;
  const { lower, upper } = halfDayWorkedBandSeconds(shiftSeconds);
  return workedSeconds >= lower && workedSeconds <= upper;
}

/** Above half-day band (~5.5h+) → full day rules (e.g. 07h 54m → Tardy, not 1st-Half). */
export function isOverHalfDayWorkLimit(workedSeconds: number, shiftSeconds: number): boolean {
  if (workedSeconds <= 0) return false;
  const { upper } = halfDayWorkedBandSeconds(shiftSeconds);
  return workedSeconds > upper + 5 * 60;
}

/** Full/near-full shift only — not 4h–5.5h half-day band. */
export function isNearFullShiftWork(workedSeconds: number, shiftSeconds: number): boolean {
  if (isWorkedHoursInHalfDayBand(workedSeconds, shiftSeconds)) return false;
  if (workedSeconds >= 7 * 3600) return true;
  const shift = shiftSeconds > 0 ? shiftSeconds : 9 * 3600;
  return workedSeconds >= shift * 0.85;
}

/**
 * Half day: 4.5–5h total work + shift timing (HR rules).
 * 1st-Half: in before mid-shift, out early. 2nd-Half: in at/after mid-shift (last hours).
 */
export function classifyHalfDayType(params: {
  dateKey: string;
  clockIn: string;
  clockOut: string;
  shiftStart: string;
  shiftEnd: string;
  shiftSeconds: number;
  workedSeconds: number;
  graceMinutes: number;
}): typeof STATUS_FIRST_HALF_DAY | typeof STATUS_SECOND_HALF_DAY | null {
  const { dateKey, clockIn, clockOut, shiftStart, shiftEnd, shiftSeconds, workedSeconds } = params;

  const effectiveShift = shiftSeconds > 0 ? shiftSeconds : 9 * 3600;
  if (isNearFullShiftWork(workedSeconds, effectiveShift)) return null;

  const { lower, upper } = halfDayWorkedBandSeconds(effectiveShift);
  if (workedSeconds < lower || workedSeconds > upper) return null;

  const startMin = minutesFromShiftHms(dateKey, shiftStart);
  const endMin = minutesFromShiftHms(dateKey, shiftEnd);
  let clockOutAddDays = 0;
  const inMin = minutesFromClockValue(dateKey, clockIn, 0);
  const outMin0 = minutesFromClockValue(dateKey, clockOut, 0);
  if (inMin != null && outMin0 != null && outMin0 <= inMin) clockOutAddDays = 1;
  const outMin = minutesFromClockValue(dateKey, clockOut, clockOutAddDays);
  if (startMin == null || endMin == null || inMin == null || outMin == null) return null;

  let shiftEndAdj = endMin;
  if (shiftEndAdj <= startMin) shiftEndAdj += 24 * 60;
  let inAdj = inMin;
  let outAdj = outMin;
  if (inAdj < startMin - 6 * 60) inAdj += 24 * 60;
  if (outAdj < inAdj) outAdj += 24 * 60;

  const halfPointMin = startMin + Math.round(effectiveShift / 120);
  const leftBeforeShiftEnd = outAdj < shiftEndAdj - 15;
  const boundarySlackMin = 15;

  // 2nd-Half: in during last hours of shift (at/after mid-shift)
  if (inAdj >= halfPointMin - boundarySlackMin) {
    return STATUS_SECOND_HALF_DAY;
  }

  // 1st-Half: in before half point, left early
  if (leftBeforeShiftEnd) {
    return STATUS_FIRST_HALF_DAY;
  }

  return null;
}

/**
 * 1st vs 2nd half from clock-in vs mid-shift (for late > 3h30m Half Day).
 * Shift last hours → 2nd-Half; earlier arrival (late from start) → 1st-Half.
 */
export function classifyHalfDayByClockIn(params: {
  dateKey: string;
  clockIn: string;
  shiftStart: string;
  shiftEnd: string;
  shiftSeconds: number;
}): typeof STATUS_FIRST_HALF_DAY | typeof STATUS_SECOND_HALF_DAY {
  const { dateKey, clockIn, shiftStart, shiftSeconds } = params;
  const effectiveShift = shiftSeconds > 0 ? shiftSeconds : 9 * 3600;

  const startMin = minutesFromShiftHms(dateKey, shiftStart);
  const inMin = minutesFromClockValue(dateKey, clockIn, 0);
  if (startMin == null || inMin == null) return STATUS_FIRST_HALF_DAY;

  let inAdj = inMin;
  if (inAdj < startMin - 6 * 60) inAdj += 24 * 60;

  const halfPointMin = startMin + Math.round(effectiveShift / 120);
  const boundarySlackMin = 15;

  if (inAdj >= halfPointMin - boundarySlackMin) {
    return STATUS_SECOND_HALF_DAY;
  }
  return STATUS_FIRST_HALF_DAY;
}

/** Late beyond 3h30m → Half Day; pick 1st vs 2nd from shift timing / clock-in. */
export function halfDayStatusForExcessiveLate(params: {
  dateKey: string;
  clockIn: string;
  shiftStart: string | null;
  shiftEnd: string | null;
}): typeof STATUS_FIRST_HALF_DAY | typeof STATUS_SECOND_HALF_DAY {
  const { dateKey, clockIn, shiftStart, shiftEnd } = params;
  if (!shiftStart || !shiftEnd) return STATUS_FIRST_HALF_DAY;
  const shiftSeconds = shiftDurationSeconds(shiftStart, shiftEnd);
  return classifyHalfDayByClockIn({
    dateKey,
    clockIn,
    shiftStart,
    shiftEnd,
    shiftSeconds: shiftSeconds > 0 ? shiftSeconds : 9 * 3600,
  });
}

/** Monthly tardy count → deduction % (HR: 1–3 → 0%, 4 → 50%, 5+ → 100%). */
export function tardyDeductionFromCount(tardyCount: string | number | null | undefined): string {
  const raw = String(tardyCount ?? "").trim();
  if (!raw) return "0%";
  const n = typeof tardyCount === "number" ? tardyCount : parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return "0%";
  if (n >= 5) return "100%";
  if (n === 4) return "50%";
  return "0%";
}

export function classifyDayAttendance(params: {
  dateKey: string;
  clockIn: string | null;
  clockOut: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  gender?: string | null;
  /** When clocks fail to parse, use Total W.H from imported sheet (seconds). */
  workedSecondsFromSheet?: number;
}): DayAttendanceStatus {
  const { dateKey, clockIn, clockOut, shiftStart, shiftEnd, gender, workedSecondsFromSheet } = params;
  const grace = graceMinutesForGender(gender);

  if (!clockIn) {
    return { statusLabel: "On Time", isLate: false, lateMinutes: 0 };
  }

  const late = computeLate(clockIn, shiftStart, grace);

  if (!clockOut) {
    if (isLatePastHalfDayThreshold(late.lateMinutes)) {
      return {
        statusLabel: halfDayStatusForExcessiveLate({
          dateKey,
          clockIn,
          shiftStart,
          shiftEnd,
        }),
        isLate: false,
        lateMinutes: 0,
      };
    }
    return {
      statusLabel: late.isLate ? "Tardy" : "On Time",
      isLate: late.isLate,
      lateMinutes: late.isLate ? late.excessLateMinutes : 0,
    };
  }

  const shiftSeconds = shiftDurationSeconds(shiftStart, shiftEnd);
  let worked = workedSecondsBetween(clockIn, clockOut);
  if (worked <= 0 && workedSecondsFromSheet && workedSecondsFromSheet > 0) {
    worked = workedSecondsFromSheet;
  }

  const effectiveShiftSeconds = shiftSeconds > 0 ? shiftSeconds : 9 * 3600;

  if (worked > 0 && isAbsentByWorkedHours(worked, effectiveShiftSeconds)) {
    return { statusLabel: "Absent", isLate: false, lateMinutes: 0 };
  }

  // > 3h 30m late → Half Day (50%); 1st vs 2nd from shift timing / clock-in
  if (isLatePastHalfDayThreshold(late.lateMinutes)) {
    return {
      statusLabel: halfDayStatusForExcessiveLate({
        dateKey,
        clockIn,
        shiftStart,
        shiftEnd,
      }),
      isLate: false,
      lateMinutes: 0,
    };
  }

  if (shiftSeconds <= 0) {
    if (late.isLate) {
      return {
        statusLabel: "Tardy",
        isLate: true,
        lateMinutes: late.excessLateMinutes,
      };
    }
    return { statusLabel: "On Time", isLate: false, lateMinutes: 0 };
  }

  // Hours-first: half-day worked time beats late/Tardy (HR: status follows hours, not clock-in late).
  if (shiftStart && shiftEnd) {
    const halfType = classifyHalfDayType({
      dateKey,
      clockIn,
      clockOut,
      shiftStart,
      shiftEnd,
      shiftSeconds,
      workedSeconds: worked,
      graceMinutes: grace,
    });
    if (halfType) {
      return { statusLabel: halfType, isLate: false, lateMinutes: 0 };
    }
  }
  if (isWorkedHoursInHalfDayBand(worked, effectiveShiftSeconds)) {
    return { statusLabel: STATUS_FIRST_HALF_DAY, isLate: false, lateMinutes: 0 };
  }

  // Full-ish day: then late → Tardy (billable = raw − 1h relaxation)
  if (late.isLate) {
    return {
      statusLabel: "Tardy",
      isLate: true,
      lateMinutes: late.excessLateMinutes,
    };
  }

  if (worked >= shiftSeconds * 0.88) {
    return { statusLabel: "On Time", isLate: false, lateMinutes: 0 };
  }

  if (worked < (shiftSeconds / 2) * 0.85) {
    return { statusLabel: "Absent", isLate: false, lateMinutes: 0 };
  }

  return { statusLabel: "On Time", isLate: false, lateMinutes: 0 };
}

export type ImportedDayClockFields = {
  dateKey: string;
  clockIn: string;
  clockOut: string;
  totalWH: string;
  assignedWH: string;
  sheetStatus?: string;
  status?: string;
  sheetTardyCount?: string;
  tardyCount?: string;
};

/** ~5h assigned shift: no half day; On Time/Tardy from sheet; Absent only when no punch or very low hours. */
export function resolveImportedDayStatusForFiveHour(params: {
  day: ImportedDayClockFields;
}): string {
  const sheetStatus = normalizeAttendanceStatus((params.day.sheetStatus ?? params.day.status) || "");
  const noPunch =
    isEmptyClockDisplay(params.day.clockIn) && isEmptyClockDisplay(params.day.clockOut);

  if (noPunch) {
    if (sheetStatus === "Off") return "Off";
    if (sheetStatus === "Leave") return "Leave";
    return "Absent";
  }

  if (sheetStatus === "Off" || sheetStatus === "Leave") return sheetStatus;

  const shiftSeconds = shiftSecondsFromAssignedWH(params.day.assignedWH);
  const workedEffective = importedWorkedSecondsForDay(params.day);

  if (workedEffective > 0 && isAbsentByWorkedHours(workedEffective, shiftSeconds)) {
    return "Absent";
  }

  if (sheetStatus === "Tardy" || sheetStatus === "On Time") return sheetStatus;
  if (sheetStatus === STATUS_FIRST_HALF_DAY || sheetStatus === STATUS_SECOND_HALF_DAY) {
    return "On Time";
  }
  if (sheetStatus === "Absent") {
    return workedEffective > 0 ? "On Time" : "Absent";
  }
  return sheetStatus || "On Time";
}

/** Imported sheet: Excel Tardy/On Time when near-full; Absent &lt;3h; half day 4.5–5h + shift timing. */
export function resolveImportedDayStatus(params: {
  day: ImportedDayClockFields;
  shiftStart: string | null;
  shiftEnd: string | null;
  gender?: string | null;
}): string {
  if (isFiveHourAssignedShift(params.day.assignedWH)) {
    return resolveImportedDayStatusForFiveHour({ day: params.day });
  }

  const sheetStatus = normalizeAttendanceStatus((params.day.sheetStatus ?? params.day.status) || "");
  const sheetTardyRaw = params.day.sheetTardyCount ?? params.day.tardyCount ?? "";
  const sheetTardyNum = parseInt(String(sheetTardyRaw).trim(), 10);
  const noPunch =
    isEmptyClockDisplay(params.day.clockIn) && isEmptyClockDisplay(params.day.clockOut);

  if (noPunch) {
    if (sheetStatus === "Off") return "Off";
    if (sheetStatus === "Leave") return "Leave";
    return "Absent";
  }

  if (sheetStatus === "Off" || sheetStatus === "Leave") return sheetStatus;

  const shiftSeconds = shiftSecondsFromAssignedWH(params.day.assignedWH);
  const workedEffective = importedWorkedSecondsForDay(params.day);

  const clockInIso = parseDisplayClockToIso(params.day.dateKey, params.day.clockIn, 0);
  let clockOutAddDays = 0;
  if (!isEmptyClockDisplay(params.day.clockIn) && !isEmptyClockDisplay(params.day.clockOut)) {
    const outSame = parseDisplayClockToIso(params.day.dateKey, params.day.clockOut, 0);
    const inIsPm = /PM/i.test(String(params.day.clockIn));
    const outIsAm = /AM/i.test(String(params.day.clockOut));
    if (
      (clockInIso && outSame && new Date(outSame).getTime() <= new Date(clockInIso).getTime()) ||
      (inIsPm && outIsAm)
    ) {
      clockOutAddDays = 1;
    }
  }
  const clockOutIso = parseDisplayClockToIso(params.day.dateKey, params.day.clockOut, clockOutAddDays);

  // HR: 2h–3.5h (e.g. 03h 01m) → Absent, never Tardy from Excel
  if (workedEffective > 0 && isImportedShortShiftAbsent(workedEffective)) {
    return "Absent";
  }

  const start = params.shiftStart;
  const end = params.shiftEnd;
  const durationFromTimes =
    start && end ? shiftDurationSeconds(start, end) : 0;
  const effectiveShift = durationFromTimes > 0 ? durationFromTimes : shiftSeconds;
  const grace = graceMinutesForGender(params.gender);

  const fullDayWorked =
    workedEffective > 0 &&
    (isNearFullShiftWork(workedEffective, effectiveShift) || workedEffective >= 7 * 3600);

  if (fullDayWorked && sheetStatus === "Absent") {
    return "On Time";
  }

  if (workedEffective > 0 && isAbsentByWorkedHours(workedEffective, effectiveShift)) {
    return "Absent";
  }

  // Above ~5.5h worked → not half day; keep Excel Tardy/On Time or derive from tardy count / late in
  if (workedEffective > 0 && isOverHalfDayWorkLimit(workedEffective, effectiveShift)) {
    if (sheetStatus === "Tardy" || sheetStatus === "On Time") return sheetStatus;
    if (Number.isFinite(sheetTardyNum) && sheetTardyNum >= 1) return "Tardy";
    if (start && clockInIso) {
      const late = computeLate(clockInIso, start, grace);
      if (late.isLate) return "Tardy";
    }
    if (
      sheetStatus === STATUS_FIRST_HALF_DAY ||
      sheetStatus === STATUS_SECOND_HALF_DAY ||
      sheetStatus === "Absent"
    ) {
      return "On Time";
    }
    return sheetStatus || "On Time";
  }

  // Half day (~4h–5.5h) before Excel Tardy — e.g. 04h 18m → 1st-Half Day, 0%
  if (workedEffective > 0 && isWorkedHoursInHalfDayBand(workedEffective, effectiveShift)) {
    if (start && end && !isEmptyClockDisplay(params.day.clockIn)) {
      const halfType = classifyHalfDayType({
        dateKey: params.day.dateKey,
        clockIn: clockInIso || params.day.clockIn,
        clockOut: clockOutIso || params.day.clockOut,
        shiftStart: start,
        shiftEnd: end,
        shiftSeconds: effectiveShift,
        workedSeconds: workedEffective,
        graceMinutes: grace,
      });
      if (halfType) return halfType;
    }
    return STATUS_FIRST_HALF_DAY;
  }

  if (workedEffective > 0 && isNearFullShiftWork(workedEffective, effectiveShift)) {
    if (sheetStatus === "Tardy" || sheetStatus === "On Time") return sheetStatus;
    if (sheetStatus === STATUS_FIRST_HALF_DAY || sheetStatus === STATUS_SECOND_HALF_DAY) {
      if (Number.isFinite(sheetTardyNum) && sheetTardyNum >= 1) return "Tardy";
      if (start && clockInIso) {
        const late = computeLate(clockInIso, start, grace);
        if (late.isLate) return "Tardy";
      }
      return "On Time";
    }
    if (sheetStatus === "Absent") return "On Time";
    return sheetStatus || "On Time";
  }

  if (sheetStatus === STATUS_FIRST_HALF_DAY || sheetStatus === STATUS_SECOND_HALF_DAY) {
    if (isWorkedHoursInHalfDayBand(workedEffective, effectiveShift) && start && end) {
      const halfType = classifyHalfDayType({
        dateKey: params.day.dateKey,
        clockIn: clockInIso || params.day.clockIn,
        clockOut: clockOutIso || params.day.clockOut,
        shiftStart: start,
        shiftEnd: end,
        shiftSeconds: effectiveShift,
        workedSeconds: workedEffective,
        graceMinutes: grace,
      });
      if (halfType) return halfType;
    }
  }

  if (sheetStatus === "Tardy" || sheetStatus === "On Time") {
    if (workedEffective > 0 && isAbsentByWorkedHours(workedEffective, effectiveShift)) {
      return "Absent";
    }
    if (workedEffective > 0 && isWorkedHoursInHalfDayBand(workedEffective, effectiveShift)) {
      if (start && end && !isEmptyClockDisplay(params.day.clockIn)) {
        const halfType = classifyHalfDayType({
          dateKey: params.day.dateKey,
          clockIn: clockInIso || params.day.clockIn,
          clockOut: clockOutIso || params.day.clockOut,
          shiftStart: start,
          shiftEnd: end,
          shiftSeconds: effectiveShift,
          workedSeconds: workedEffective,
          graceMinutes: grace,
        });
        if (halfType) return halfType;
      }
      return STATUS_FIRST_HALF_DAY;
    }
    return sheetStatus;
  }
  if (sheetStatus === "Absent") {
    if (workedEffective > 0 && !isAbsentByWorkedHours(workedEffective, effectiveShift)) {
      return "On Time";
    }
    return "Absent";
  }
  return sheetStatus || "On Time";
}

export function importedDeductionForStatus(
  statusLabel: string,
  sheetDeduction: string,
  tardyCount?: string | number | null,
): string {
  const s = normalizeAttendanceStatus(statusLabel);
  if (s === "Absent") return "100%";
  if (s === STATUS_FIRST_HALF_DAY || s === STATUS_SECOND_HALF_DAY) return "50%";
  if (s === "Tardy") return tardyDeductionFromCount(tardyCount);
  if (s === "On Time") return "0%";
  return sheetDeduction || "";
}

export function aggregateDayPunches(records: any[]) {
  if (!records.length) return { clockIn: null as string | null, clockOut: null as string | null, record: records[0] };
  const sorted = [...records].sort((a, b) => {
    const aMs = toEpochMs(a.clock_in) ?? 0;
    const bMs = toEpochMs(b.clock_in) ?? 0;
    return aMs - bMs;
  });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    clockIn: first.clock_in || null,
    clockOut: last.clock_out || null,
    record: first,
  };
}
