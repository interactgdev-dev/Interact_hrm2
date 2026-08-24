import { isAutoClockOutRecord } from "@/lib/attendance-auto-clock-out";

/** Extra work beyond assigned shift before OT is shown/counted (1 hour). */
export const OVERTIME_MIN_SECONDS = 60 * 60;

export function isOvertimeAllowed(
  value: boolean | number | string | null | undefined,
): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * Billable overtime: only when shift allows OT, employee clocked out manually
 * (not auto clock-out), and worked ≥1h past assigned shift.
 */
export function resolveBillableOvertimeSeconds(opts: {
  totalSeconds: number;
  assignedShiftSeconds: number | null | undefined;
  allowOvertime?: boolean | number | string | null;
  autoClockOut?: boolean | number | string | null;
  minSeconds?: number;
}): number | null {
  if (isAutoClockOutRecord(opts.autoClockOut)) return null;
  if (!isOvertimeAllowed(opts.allowOvertime)) return null;
  const assigned = opts.assignedShiftSeconds;
  if (!assigned || assigned <= 0) return null;
  const overtime = opts.totalSeconds - assigned;
  const min = opts.minSeconds ?? OVERTIME_MIN_SECONDS;
  if (overtime >= min) return overtime;
  return null;
}
