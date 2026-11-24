/**
 * Shared leave balance calculation (approved leaves deduct; rejected do not).
 */

import { pool } from "@/lib/db";
import { getLeaveCycleStartYmd, leaveDateToYmd } from "@/lib/leave-cycle";
import {
  BEREAVEMENT_ALLOWANCE,
  MATERNITY_ALLOWANCE,
  PATERNITY_ALLOWANCE,
  normalizeEmployeeGender,
} from "@/lib/leave-categories";
import { getDateStringInTimeZone } from "@/lib/timezone";

function pickLatestAllowanceRow(rows: any[]): any | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let best = rows[0];
  let bestMs = 0;
  for (const row of rows) {
    const ymd = leaveDateToYmd(row?.updated_at);
    let ms = ymd ? Date.parse(`${ymd}T00:00:00Z`) : 0;
    if (!Number.isFinite(ms) || ms <= 0) {
      const idn = Number(row?.id);
      ms = Number.isFinite(idn) ? idn : 0;
    }
    if (ms >= bestMs) {
      bestMs = ms;
      best = row;
    }
  }
  return best;
}

export type LeaveBalanceResult = {
  success: true;
  employee_id: string | number;
  resolvedEmployeeId: number | null;
  employment_status: "Probation" | "Permanent";
  gender: string | null;
  leaveCycleStart: string | null;
  annualBalance: number;
  annualAllowance: number;
  bereavementBalance: number;
  maternityBalance: number;
  maternityAllowance: number;
  paternityBalance: number;
  paternityAllowance: number;
  annualBalanceAdjustment: number;
  bereavementBalanceAdjustment: number;
  maternityBalanceAdjustment: number;
  paternityBalanceAdjustment: number;
  usedLeave: Record<string, number>;
  totalUsedDays: number;
};

export type LeaveBalanceError = { success: false; error: string };

export async function getEmployeeLeaveBalance(
  employeeIdRaw: string | number
): Promise<LeaveBalanceResult | LeaveBalanceError> {
  let conn: any;
  try {
    const employee_id = String(employeeIdRaw || "").trim();
    if (!employee_id) {
      return { success: false, error: "employee_id is required" };
    }

    conn = await pool.getConnection();

    const [empRows]: any = await conn.execute(
      "SELECT id, employee_code, employment_status, gender FROM hrm_employees WHERE employee_code = ? OR CAST(id AS CHAR) = ? OR username = ?",
      [employee_id, employee_id, employee_id]
    );
    const emp = empRows.length > 0 ? empRows[0] : null;
    const resolvedEmployeeId = emp?.id ? Number(emp.id) : null;
    const genderRaw = emp?.gender != null ? String(emp.gender) : null;
    const genderNorm = normalizeEmployeeGender(genderRaw);

    const [jobRows]: any = await conn.execute(
      "SELECT employment_status, DATE_FORMAT(joined_date, '%Y-%m-%d') AS joined_date FROM employee_jobs WHERE employee_id = ?",
      [resolvedEmployeeId]
    );
    const job = jobRows.length > 0 ? jobRows[0] : null;

    const empStatusRaw: string =
      emp?.employment_status || job?.employment_status || "";
    const effectiveStatus: "Probation" | "Permanent" =
      empStatusRaw === "Probation" ? "Probation" : "Permanent";

    const eid = resolvedEmployeeId;
    const [allowanceResult]: any = await conn.execute(
      `SELECT * FROM employee_leave_allowances
       WHERE employee_id = ? OR CAST(employee_id AS CHAR) = ?`,
      [eid, String(eid ?? "")],
    );
    // Mongo may lack UNIQUE on employee_id → multiple rows; use latest edit.
    const customAllowance = pickLatestAllowanceRow(
      Array.isArray(allowanceResult) ? allowanceResult : [],
    );

    const annualAllowance = effectiveStatus === "Probation" ? 3 : 20;
    const bereavementAllowance = BEREAVEMENT_ALLOWANCE;
    const maternityAllowance = MATERNITY_ALLOWANCE;
    const paternityAllowance = PATERNITY_ALLOWANCE;
    const leaveCycleStart = getLeaveCycleStartYmd(job?.joined_date || null);

    // Always apply latest stored HR adjustment (must match Balances page after refresh).
    const annualBalanceAdjustment = Number(
      customAllowance?.annual_balance_adjustment ?? 0,
    );
    const bereavementBalanceAdjustment = Number(
      customAllowance?.bereavement_balance_adjustment ?? 0,
    );
    const maternityBalanceAdjustment = Number(
      customAllowance?.maternity_balance_adjustment ?? 0,
    );
    const paternityBalanceAdjustment = Number(
      customAllowance?.paternity_balance_adjustment ?? 0,
    );

    let leavesQuery =
      "SELECT id, leave_category, total_days, start_date, updated_at, reason, status FROM employee_leaves WHERE (employee_id = ? OR CAST(employee_id AS CHAR) = ?) AND status = 'approved'";
    const leaveId = resolvedEmployeeId ?? employee_id;
    const leaveParams: any[] = [leaveId, String(leaveId)];
    const todayYmd = getDateStringInTimeZone(new Date());
    if (leaveCycleStart) {
      leavesQuery += " AND DATE(COALESCE(updated_at, start_date)) >= ?";
      leaveParams.push(leaveCycleStart);
    }
    leavesQuery += " AND DATE(COALESCE(updated_at, start_date)) <= ?";
    leaveParams.push(todayYmd);
    const [leavesRaw]: any = await conn.execute(leavesQuery, leaveParams);
    const { dedupeLeavesByTicketMarker } = await import("@/lib/leave-row-dedupe");
    const leaves = dedupeLeavesByTicketMarker(
      Array.isArray(leavesRaw) ? leavesRaw : [],
    );

    const usedLeave: Record<string, number> = {};
    let totalUsedDays = 0;
    for (const leave of leaves as any[]) {
      const category = String(leave.leave_category || "annual");
      const days = Number(leave.total_days || 0);
      usedLeave[category] = (usedLeave[category] || 0) + days;
      totalUsedDays += days;
    }

    const bereavementUsedDays = usedLeave.bereavement || 0;
    const maternityUsedDays = usedLeave.maternity || 0;
    const paternityUsedDays = usedLeave.paternity || 0;
    const annualUsedDays =
      totalUsedDays - bereavementUsedDays - maternityUsedDays - paternityUsedDays;
    // Cap at policy max; allow negative when used exceeds allowance (over-limit).
    const clampBal = (raw: number, max: number) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return 0;
      return Math.round(Math.min(max, n) * 2) / 2;
    };
    const annualBalance = clampBal(
      annualAllowance - annualUsedDays + annualBalanceAdjustment,
      annualAllowance,
    );
    const bereavementBalance = clampBal(
      bereavementAllowance - bereavementUsedDays + bereavementBalanceAdjustment,
      bereavementAllowance,
    );
    const maternityBalance = clampBal(
      maternityAllowance - maternityUsedDays + maternityBalanceAdjustment,
      maternityAllowance,
    );
    const paternityBalance = clampBal(
      paternityAllowance - paternityUsedDays + paternityBalanceAdjustment,
      paternityAllowance,
    );

    return {
      success: true,
      employee_id,
      resolvedEmployeeId,
      employment_status: effectiveStatus,
      gender: genderRaw,
      leaveCycleStart,
      annualBalance,
      annualAllowance,
      bereavementBalance,
      maternityBalance: genderNorm === "female" ? maternityBalance : 0,
      maternityAllowance: genderNorm === "female" ? maternityAllowance : 0,
      paternityBalance: genderNorm === "male" ? paternityBalance : 0,
      paternityAllowance: genderNorm === "male" ? paternityAllowance : 0,
      annualBalanceAdjustment,
      bereavementBalanceAdjustment,
      maternityBalanceAdjustment,
      paternityBalanceAdjustment,
      usedLeave,
      totalUsedDays,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (conn) conn.release();
  }
}

/** Remaining days for a leave category. */
export function remainingForCategory(
  balance: LeaveBalanceResult,
  category: string
): number {
  const cat = String(category || "annual").toLowerCase();
  if (cat === "bereavement") return balance.bereavementBalance;
  if (cat === "maternity") return balance.maternityBalance;
  if (cat === "paternity") return balance.paternityBalance;
  return balance.annualBalance;
}

/**
 * Leave apply / generate-ticket must stay allowed at 0 or negative balance.
 * Only reject invalid day counts (half-day 0.5 OK).
 */
export function assertLeaveBalanceAllowsRequest(
  _balance: LeaveBalanceResult,
  opts: { leaveCategory?: string; totalDays?: number }
): { ok: true } | { ok: false; error: string } {
  const raw = Number(opts.totalDays);
  // Allow half-day (0.5); reject zero / NaN / negative.
  const days = Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (days <= 0) {
    return { ok: false, error: "Please select type of leave." };
  }
  return { ok: true };
}
