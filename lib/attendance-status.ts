export function normalizeAttendanceStatus(status: string): string {
  const s = String(status || "").trim();
  if (s === "Half Day") return "1st-Half Day";
  if (s === "Full Day") return "Tardy";
  return s;
}

/** Status values admins can pick in Monthly Attendance (manual override). */
export const MONTHLY_ATTENDANCE_STATUS_OPTIONS = [
  "On Time",
  "Tardy",
  "Absent",
  "1st-Half Day",
  "2nd-Half Day",
  "Leave",
  "Off",
] as const;

export type MonthlyAttendanceStatusOption =
  (typeof MONTHLY_ATTENDANCE_STATUS_OPTIONS)[number];

export function isAllowedMonthlyAttendanceStatus(status: string): boolean {
  const s = normalizeAttendanceStatus(status);
  return (MONTHLY_ATTENDANCE_STATUS_OPTIONS as readonly string[]).includes(s);
}

/** Deduction % for a (possibly manual) monthly status. */
export function deductionForAttendanceStatus(
  statusLabel: string,
  tardyCount?: number | string | null,
): string {
  const s = normalizeAttendanceStatus(statusLabel);
  if (s === "Absent") return "100%";
  if (s === "1st-Half Day" || s === "2nd-Half Day") return "50%";
  if (s === "Leave" || s === "On Time") return "0%";
  if (s === "Off" || s === "---" || !s) return "";
  if (s === "Tardy") {
    const n = Number(tardyCount);
    if (!Number.isFinite(n) || n <= 0) return "0%";
    if (n === 4) return "50%";
    if (n >= 5) return "100%";
    return "0%";
  }
  return "";
}

export function isTardyStatus(status: string): boolean {
  return normalizeAttendanceStatus(status) === "Tardy";
}

export function isHalfDayStatus(status: string): boolean {
  const s = normalizeAttendanceStatus(status);
  return s === "1st-Half Day" || s === "2nd-Half Day";
}

export function isAbsentOrHalfDayStatus(status: string): boolean {
  const s = normalizeAttendanceStatus(status);
  return s === "Absent" || isHalfDayStatus(s);
}

/** Status column text color on the web UI (no yellow row styling). */
export function uiStatusTextColor(status: string): string {
  const s = normalizeAttendanceStatus(status);
  if (s === "Tardy") return "#E53E3E";
  if (s === "Absent" || isHalfDayStatus(s)) return "#C53030";
  if (s === "Leave") return "#3182CE";
  if (s === "On Time") return "#276749";
  if (s === "Off") return "#4A5568";
  return "#4A5568";
}

export function statusTextColor(status: string): string {
  return uiStatusTextColor(status);
}
