/**
 * Leave ticket duration: full day | 1st half | 2nd half.
 * Half day → 0.5 leave-balance days; full day → calendar days (usually 1+).
 */

export type LeaveDuration = "full" | "first_half" | "second_half";

export type ApprovedLeaveDayKind = "full" | "first_half" | "second_half";

export const LEAVE_DURATION_OPTIONS: {
  value: LeaveDuration;
  label: string;
}[] = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "1st half day" },
  { value: "second_half", label: "2nd half day" },
];

export function parseLeaveDuration(raw: unknown): LeaveDuration | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (s === "full" || s === "full_day" || s === "fullday") return "full";
  if (
    s === "first_half" ||
    s === "first" ||
    s === "1st_half" ||
    s === "1st_half_day" ||
    s === "first_half_day"
  ) {
    return "first_half";
  }
  if (
    s === "second_half" ||
    s === "second" ||
    s === "2nd_half" ||
    s === "2nd_half_day" ||
    s === "second_half_day"
  ) {
    return "second_half";
  }
  return null;
}

/** DB column half_day_part: null | first | second */
export function halfDayPartFromDuration(
  duration: LeaveDuration | null | undefined,
): "first" | "second" | null {
  if (duration === "first_half") return "first";
  if (duration === "second_half") return "second";
  return null;
}

export function leaveDurationFromHalfDayPart(
  part: unknown,
  totalDays?: unknown,
): LeaveDuration {
  const p = String(part || "")
    .trim()
    .toLowerCase();
  if (p === "first" || p === "first_half" || p === "1st") return "first_half";
  if (p === "second" || p === "second_half" || p === "2nd") return "second_half";
  const days = Number(totalDays);
  if (Number.isFinite(days) && days > 0 && days < 1) return "first_half";
  return "full";
}

export function leaveDaysForDuration(
  duration: LeaveDuration,
  startDate: string,
  endDate: string,
): number {
  if (duration === "first_half" || duration === "second_half") return 0.5;
  if (!startDate || !endDate) return 0;
  const s = new Date(startDate);
  const e = new Date(endDate);
  return Math.max(
    1,
    Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  );
}

export function leaveDurationLabel(duration: LeaveDuration | null | undefined): string {
  if (duration === "first_half") return "1st half day";
  if (duration === "second_half") return "2nd half day";
  if (duration === "full") return "Full day";
  return "—";
}

/** Monthly Attendance status + pay deduction for an approved leave day. */
export function attendanceFromApprovedLeaveDay(kind: ApprovedLeaveDayKind): {
  statusLabel: string;
  deduction: string;
} {
  if (kind === "first_half") {
    return { statusLabel: "1st-Half Day", deduction: "50%" };
  }
  if (kind === "second_half") {
    return { statusLabel: "2nd-Half Day", deduction: "50%" };
  }
  return { statusLabel: "Leave", deduction: "0%" };
}

export function approvedLeaveKindFromRow(leave: {
  half_day_part?: unknown;
  leave_duration?: unknown;
  total_days?: unknown;
  form_data?: unknown;
}): ApprovedLeaveDayKind {
  const fromPart = leaveDurationFromHalfDayPart(leave.half_day_part, leave.total_days);
  if (fromPart !== "full") return fromPart;
  const fd =
    leave.form_data && typeof leave.form_data === "object"
      ? (leave.form_data as Record<string, unknown>)
      : null;
  const fromFd = parseLeaveDuration(leave.leave_duration ?? fd?.leave_duration);
  if (fromFd === "first_half" || fromFd === "second_half") return fromFd;
  const days = Number(leave.total_days);
  if (Number.isFinite(days) && days > 0 && days < 1) return "first_half";
  return "full";
}

/** empId → dateKey → leave kind (full / first_half / second_half). */
export type ApprovedLeavesMap = Record<string, Record<string, ApprovedLeaveDayKind>>;

export function buildApprovedLeavesMap(
  leaves: Array<Record<string, unknown>>,
  opts: {
    normalizeDateKey: (raw: string) => string;
    addDays: (dateKey: string, days: number) => string;
  },
): ApprovedLeavesMap {
  const leavesMap: ApprovedLeavesMap = {};
  for (const leave of leaves) {
    if (String(leave.status || "").toLowerCase() !== "approved") continue;
    const empId = String(leave.employee_id || "").trim();
    if (!empId) continue;
    const startDateKey = opts.normalizeDateKey(String(leave.start_date || ""));
    const endDateKey =
      opts.normalizeDateKey(String(leave.end_date || "")) || startDateKey;
    if (!startDateKey || !endDateKey) continue;
    const kind = approvedLeaveKindFromRow(leave);
    if (!leavesMap[empId]) leavesMap[empId] = {};
    let currentDateKey = startDateKey;
    while (currentDateKey <= endDateKey) {
      // Full-day leave wins over half if both exist on same day.
      const prev = leavesMap[empId][currentDateKey];
      if (prev !== "full") {
        leavesMap[empId][currentDateKey] = kind;
      }
      currentDateKey = opts.addDays(currentDateKey, 1);
    }
  }
  return leavesMap;
}

export function approvedLeaveOnDay(
  map: ApprovedLeavesMap | Record<string, Record<string, boolean>>,
  employeeId: string,
  dateKey: string,
): ApprovedLeaveDayKind | null {
  const cell = map[String(employeeId)]?.[dateKey];
  if (!cell) return null;
  if (cell === true) return "full";
  if (cell === "full" || cell === "first_half" || cell === "second_half") return cell;
  return null;
}
