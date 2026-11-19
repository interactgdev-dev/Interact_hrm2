/**
 * Shared leave balance calculation (approved leaves deduct; rejected do not).
 */

import { pool } from "@/lib/db";
import {
  getLeaveCycleStartYmd,
  shouldApplyLeaveAdjustment,
} from "@/lib/leave-cycle";
import {
  BEREAVEMENT_ALLOWANCE,
  MATERNITY_ALLOWANCE,
  PATERNITY_ALLOWANCE,
  normalizeEmployeeGender,
} from "@/lib/leave-categories";
import { getDateStringInTimeZone } from "@/lib/timezone";

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

    const [allowanceResult]: any = await conn.execute(
      "SELECT * FROM employee_leave_allowances WHERE employee_id = ?",
      [resolvedEmployeeId]
    );
    const customAllowance =
      allowanceResult && allowanceResult.length > 0 ? allowanceResult[0] : null;

    const annualAllowance = effectiveStatus === "Probation" ? 3 : 20;
    const bereavementAllowance = BEREAVEMENT_ALLOWANCE;
    const maternityAllowance = MATERNITY_ALLOWANCE;
    const paternityAllowance = PATERNITY_ALLOWANCE;
    const leaveCycleStart = getLeaveCycleStartYmd(job?.joined_date || null);

    const isCurrentCycleAdjustment = shouldApplyLeaveAdjustment(
      customAllowance?.updated_at,
      leaveCycleStart
    );
    const annualBalanceAdjustment = isCurrentCycleAdjustment
      ? Number(customAllowance?.annual_balance_adjustment ?? 0)
      : 0;
    const bereavementBalanceAdjustment = isCurrentCycleAdjustment
      ? Number(customAllowance?.bereavement_balance_adjustment ?? 0)
      : 0;
    const maternityBalanceAdjustment = isCurrentCycleAdjustment
      ? Number(customAllowance?.maternity_balance_adjustment ?? 0)
      : 0;
    const paternityBalanceAdjustment = isCurrentCycleAdjustment
      ? Number(customAllowance?.paternity_balance_adjustment ?? 0)
      : 0;

    let leavesQuery =
      "SELECT leave_category, total_days, start_date, updated_at FROM employee_leaves WHERE (employee_id = ? OR CAST(employee_id AS CHAR) = ?) AND status = 'approved'";
    const leaveId = resolvedEmployeeId ?? employee_id;
    const leaveParams: any[] = [leaveId, String(leaveId)];
    const todayYmd = getDateStringInTimeZone(new Date());
    if (leaveCycleStart) {
      leavesQuery += " AND DATE(COALESCE(updated_at, start_date)) >= ?";
      leaveParams.push(leaveCycleStart);
    }
    leavesQuery += " AND DATE(COALESCE(updated_at, start_date)) <= ?";
    leaveParams.push(todayYmd);
    const [leaves]: any = await conn.execute(leavesQuery, leaveParams);

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
    const annualBalance =
      annualAllowance - annualUsedDays + annualBalanceAdjustment;
    const bereavementBalance =
      bereavementAllowance - bereavementUsedDays + bereavementBalanceAdjustment;
    const maternityBalance =
      maternityAllowance - maternityUsedDays + maternityBalanceAdjustment;
    const paternityBalance =
      paternityAllowance - paternityUsedDays + paternityBalanceAdjustment;

    return {
      success: true,
      employee_id,
      resolvedEmployeeId,
      employment_status: effectiveStatus,
      gender: genderRaw,
      leaveCycleStart,
      annualBalance: Math.max(0, annualBalance),
      annualAllowance,
      bereavementBalance: Math.max(0, bereavementBalance),
      maternityBalance:
        genderNorm === "female" ? Math.max(0, maternityBalance) : 0,
      maternityAllowance: genderNorm === "female" ? maternityAllowance : 0,
      paternityBalance:
        genderNorm === "male" ? Math.max(0, paternityBalance) : 0,
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
 * Block new leave when balance is 0, or when requested days exceed remaining.
 */
export function assertLeaveBalanceAllowsRequest(
  balance: LeaveBalanceResult,
  opts: { leaveCategory?: string; totalDays?: number }
): { ok: true } | { ok: false; error: string } {
  const cat = String(opts.leaveCategory || "annual").toLowerCase();
  const raw = Number(opts.totalDays);
  // Allow half-day (0.5); reject zero / NaN / negative.
  const days = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const remaining = remainingForCategory(balance, cat);

  if (days <= 0) {
    return { ok: false, error: "Please select type of leave." };
  }
  if (remaining <= 0) {
    const label =
      cat === "bereavement"
        ? "Bereavement"
        : cat === "maternity"
          ? "Maternity"
          : cat === "paternity"
            ? "Paternity"
            : "Leave";
    return {
      ok: false,
      error: `${label} leave balance is 0. You cannot apply for leave.`,
    };
  }
  if (days > remaining) {
    return {
      ok: false,
      error: `Not enough leave balance. Remaining: ${remaining} day(s), requested: ${days}.`,
    };
  }
  return { ok: true };
}
