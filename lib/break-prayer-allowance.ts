import { normalizeAttendanceStatus } from "@/lib/attendance-status";
import {
  STATUS_FIRST_HALF_DAY,
  STATUS_SECOND_HALF_DAY,
  classifyDayAttendance,
} from "@/lib/monthly-attendance-status";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

/** Full-day allowances (seconds). */
export const FULL_BREAK_ALLOWANCE_SECONDS = 60 * 60; // 60m
export const FULL_PRAYER_ALLOWANCE_SECONDS = 30 * 60; // 30m

/** Half-day (1st/2nd-Half Day) — half of full allowances. */
export const HALF_BREAK_ALLOWANCE_SECONDS = 30 * 60; // 30m
export const HALF_PRAYER_ALLOWANCE_SECONDS = 15 * 60; // 15m

export function isHalfDayAttendanceStatus(
  statusLabel: string | null | undefined,
): boolean {
  const s = normalizeAttendanceStatus(statusLabel || "");
  return s === STATUS_FIRST_HALF_DAY || s === STATUS_SECOND_HALF_DAY;
}

export function breakAllowanceSecondsForStatus(
  statusLabel: string | null | undefined,
): number {
  return isHalfDayAttendanceStatus(statusLabel)
    ? HALF_BREAK_ALLOWANCE_SECONDS
    : FULL_BREAK_ALLOWANCE_SECONDS;
}

export function prayerAllowanceSecondsForStatus(
  statusLabel: string | null | undefined,
): number {
  return isHalfDayAttendanceStatus(statusLabel)
    ? HALF_PRAYER_ALLOWANCE_SECONDS
    : FULL_PRAYER_ALLOWANCE_SECONDS;
}

export function exceedSecondsOverAllowance(
  totalSeconds: number,
  allowanceSeconds: number,
): number {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const allow = Math.max(0, Math.floor(Number(allowanceSeconds) || 0));
  return total > allow ? total - allow : 0;
}

/** Resolve monthly-style day status from an attendance API row (live / summaries). */
export function dayStatusLabelFromAttendanceRow(
  row: {
    clock_in?: unknown;
    clock_out?: unknown;
    date?: unknown;
    shift_start_time?: unknown;
    shift_end_time?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    gender?: unknown;
  } | null | undefined,
): string {
  if (!row?.clock_in) return "";
  const clockIn = String(row.clock_in);
  const dateKey =
    (row.date ? String(row.date).slice(0, 10) : "") ||
    getDateStringInTimeZone(clockIn, SERVER_TIMEZONE) ||
    "";
  if (!dateKey) return "";
  const shiftStart = String(row.shift_start_time || row.start_time || "").trim() || null;
  const shiftEnd = String(row.shift_end_time || row.end_time || "").trim() || null;
  return classifyDayAttendance({
    dateKey,
    clockIn,
    clockOut: row.clock_out ? String(row.clock_out) : null,
    shiftStart,
    shiftEnd,
    gender: row.gender != null ? String(row.gender) : null,
  }).statusLabel;
}

export function breakAllowanceFromAttendanceRow(
  row: Parameters<typeof dayStatusLabelFromAttendanceRow>[0],
): number {
  return breakAllowanceSecondsForStatus(dayStatusLabelFromAttendanceRow(row));
}

export function prayerAllowanceFromAttendanceRow(
  row: Parameters<typeof dayStatusLabelFromAttendanceRow>[0],
): number {
  return prayerAllowanceSecondsForStatus(dayStatusLabelFromAttendanceRow(row));
}

export type BreakPrayerKind = "break" | "prayer";

/**
 * Map keys for summary/live exceed:
 * - `${employeeId}|${sessionDate}`
 * - `${employeeId}|attendance:${attendanceId}`
 */
export function buildAllowanceSecondsByEmployeeSession(
  attendanceRows: Array<Record<string, unknown>>,
  kind: BreakPrayerKind,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of attendanceRows || []) {
    if (!row?.clock_in) continue;
    const empId = String(row.employee_id ?? row.employeeId ?? "").trim();
    if (!empId) continue;
    const status = dayStatusLabelFromAttendanceRow(row as any);
    const allow =
      kind === "break"
        ? breakAllowanceSecondsForStatus(status)
        : prayerAllowanceSecondsForStatus(status);
    const dateKey =
      (row.date ? String(row.date).slice(0, 10) : "") ||
      getDateStringInTimeZone(String(row.clock_in), SERVER_TIMEZONE);
    if (dateKey) map.set(`${empId}|${dateKey}`, allow);
    const attId = row.id ?? row.attendance_id;
    if (attId !== undefined && attId !== null && String(attId) !== "") {
      map.set(`${empId}|attendance:${attId}`, allow);
    }
  }
  return map;
}

export function resolveAllowanceSeconds(
  map: Map<string, number> | null | undefined,
  opts: {
    employeeId: string | number | null | undefined;
    sessionDate?: string | null;
    attendanceSessionId?: string | number | null;
    kind: BreakPrayerKind;
  },
): number {
  const full =
    opts.kind === "break"
      ? FULL_BREAK_ALLOWANCE_SECONDS
      : FULL_PRAYER_ALLOWANCE_SECONDS;
  if (!map) return full;
  const empId = String(opts.employeeId ?? "").trim();
  if (!empId) return full;
  const attId = opts.attendanceSessionId;
  if (attId !== undefined && attId !== null && String(attId) !== "") {
    const byId = map.get(`${empId}|attendance:${attId}`);
    if (typeof byId === "number") return byId;
  }
  const dateKey = String(opts.sessionDate || "").trim().slice(0, 10);
  if (dateKey) {
    const byDate = map.get(`${empId}|${dateKey}`);
    if (typeof byDate === "number") return byDate;
  }
  return full;
}
