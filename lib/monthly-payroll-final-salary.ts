/**
 * Server-side Monthly Payroll Final Salary (default formula).
 * Matches admin Monthly Payroll getPayrollBreakdown on a fresh load
 * (auto tax; no unsaved manual Break/KPI/Other/Tax overrides).
 */
import { query } from "@/lib/db";
import { monthlySalaryTaxFromGross } from "@/lib/pakistan-salary-tax";
import {
  medicalDeductionForPackage,
  normalizeMedicalPackage,
  type MedicalPackageId,
} from "@/lib/medical-package";

function asRows<T>(result: any): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function idKeys(raw: string | number): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const keys = [s];
  if (/^\d+$/.test(s)) {
    const n = String(Number(s));
    if (n !== s) keys.push(n);
  }
  return keys;
}

function putMap(map: Record<string, number>, employeeId: string | number, amount: number) {
  if (!(amount > 0)) return;
  for (const k of idKeys(employeeId)) map[k] = amount;
}

function lookupMap(map: Record<string, number>, employeeId: string | number): number {
  for (const k of idKeys(employeeId)) {
    const n = Number(map[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function truncPerHourRate(basic: number, workingDays: number, hoursPerDay: number): number {
  if (!(basic > 0) || !(workingDays > 0) || !(hoursPerDay > 0)) return 0;
  return Math.floor(basic / workingDays / hoursPerDay);
}

function paidHoursPerDay(workingHours: unknown): number {
  const n = Number(workingHours);
  return Number.isFinite(n) && n > 0 ? n : 9;
}

function monthBounds(month: string): { fromDate: string; toDate: string; daysInMonth: number } {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return {
    fromDate: `${month}-01`,
    toDate: `${month}-${String(daysInMonth).padStart(2, "0")}`,
    daysInMonth,
  };
}

async function countWorkingDays(month: string): Promise<number> {
  const { daysInMonth } = monthBounds(month);
  const [y, m] = month.split("-").map(Number);
  const overrides: Record<string, string> = {};
  try {
    const [rows]: any = await query(
      `SELECT date, status FROM company_calendar_days
       WHERE date >= ? AND date <= ?`,
      [`${month}-01`, `${month}-${String(daysInMonth).padStart(2, "0")}`],
    );
    for (const row of asRows<{ date?: string | Date; status?: string }>(rows)) {
      const raw = row.date;
      const key =
        raw instanceof Date
          ? raw.toISOString().slice(0, 10)
          : String(raw || "").slice(0, 10);
      if (key) overrides[key] = String(row.status || "").toLowerCase();
    }
  } catch {
    /* calendar optional */
  }

  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${month}-${String(day).padStart(2, "0")}`;
    const override = overrides[dateKey];
    if (override === "working") {
      count += 1;
      continue;
    }
    if (override === "off" || override === "holiday") continue;
    const weekday = new Date(y, m - 1, day).getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

async function loadUnpaidDaysMap(month: string): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const { fromDate, toDate } = monthBounds(month);
  try {
    const [rows]: any = await query(
      `SELECT ea.employee_id, ea.date, ea.status, ea.leave_type, ea.deduction
       FROM employee_attendance ea
       WHERE DATE(ea.date) BETWEEN ? AND ?`,
      [fromDate, toDate],
    );
    const byEmpDate: Record<string, Record<string, any[]>> = {};
    for (const rec of asRows<any>(rows)) {
      const empId = String(rec.employee_id ?? "").trim();
      if (!empId) continue;
      const raw = rec.date;
      const dateKey =
        raw instanceof Date
          ? raw.toISOString().slice(0, 10)
          : String(raw || "").slice(0, 10);
      if (!dateKey) continue;
      if (!byEmpDate[empId]) byEmpDate[empId] = {};
      if (!byEmpDate[empId][dateKey]) byEmpDate[empId][dateKey] = [];
      byEmpDate[empId][dateKey].push(rec);
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();

    for (const [empId, byDate] of Object.entries(byEmpDate)) {
      let totalDeduction = 0;
      let hasHalfDay = false;
      for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${month}-${String(day).padStart(2, "0")}`;
        const weekday = new Date(y, m - 1, day).getDay();
        if (weekday === 0 || weekday === 6) continue;
        if (dateKey > todayKey) continue;
        const dayRecords = byDate[dateKey] || [];
        let dayDeduction = 0;
        if (dayRecords.length === 0) {
          dayDeduction = 100;
        } else {
          const approvedLeave = dayRecords.some(
            (r) => r.leave_type && String(r.leave_type).toLowerCase() === "approved",
          );
          if (!approvedLeave) {
            let metaDeduction = 0;
            if (dayRecords[0]?.deduction != null && dayRecords[0]?.deduction !== "") {
              metaDeduction = parseInt(String(dayRecords[0].deduction), 10) || 0;
            } else {
              const status = String(dayRecords[0]?.status || "").toLowerCase();
              if (status === "absent") metaDeduction = 100;
              else if (status === "half day" || status === "half-day") metaDeduction = 50;
            }
            if (metaDeduction === 50) hasHalfDay = true;
            dayDeduction = metaDeduction;
          }
        }
        totalDeduction += dayDeduction;
      }
      let unpaid = totalDeduction / 100;
      if (!hasHalfDay) unpaid = Math.floor(unpaid);
      putMap(map, empId, unpaid > 0 ? unpaid : 0);
      // putMap skips 0 — set explicitly
      for (const k of idKeys(empId)) map[k] = unpaid;
    }
  } catch {
    /* attendance optional */
  }
  return map;
}

async function loadAdvanceLoanMaps(month: string): Promise<{
  advances: Record<string, number>;
  loans: Record<string, number>;
}> {
  const advances: Record<string, number> = {};
  const loans: Record<string, number> = {};
  try {
    const [advRows]: any = await query(
      `SELECT employee_id, advance_amount AS amount
       FROM advance_salary
       WHERE DATE_FORMAT(created_at, '%Y-%m') = ?`,
      [month],
    );
    for (const row of asRows<{ employee_id?: number; amount?: number }>(advRows)) {
      putMap(advances, Number(row.employee_id), money(row.amount));
    }
  } catch {
    /* legacy advance optional */
  }
  try {
    const [adv2]: any = await query(
      `SELECT employee_id, amount
       FROM employee_advances
       WHERE payroll_month = ?
         AND LOWER(TRIM(status)) NOT IN ('paid','cancelled','stop')`,
      [month],
    );
    for (const row of asRows<{ employee_id?: number; amount?: number }>(adv2)) {
      const id = Number(row.employee_id);
      const amt = money(row.amount);
      if (!(amt > 0)) continue;
      const prev = lookupMap(advances, id);
      putMap(advances, id, Math.max(prev, amt));
    }
  } catch {
    /* ledger optional */
  }
  try {
    const [loanRows]: any = await query(
      `SELECT employee_id, COALESCE(payable_this_month, original_amount, 0) AS amount
       FROM loan_installments
       WHERE month = ?
         AND LOWER(TRIM(COALESCE(status,'pending'))) NOT IN ('paid','stop','cancelled')`,
      [month],
    );
    for (const row of asRows<{ employee_id?: number; amount?: number }>(loanRows)) {
      putMap(loans, Number(row.employee_id), money(row.amount));
    }
  } catch {
    /* legacy loans */
  }
  try {
    const [loan2]: any = await query(
      `SELECT l.employee_id, i.payable_amount AS amount
       FROM employee_loan_installments i
       INNER JOIN employee_loans l ON l.id = i.loan_id
       WHERE i.due_month = ?
         AND LOWER(TRIM(COALESCE(i.status,'pending'))) NOT IN ('paid','stop','cancelled')`,
      [month],
    );
    for (const row of asRows<{ employee_id?: number; amount?: number }>(loan2)) {
      const id = Number(row.employee_id);
      const amt = money(row.amount);
      if (!(amt > 0)) continue;
      putMap(loans, id, lookupMap(loans, id) + amt);
    }
  } catch {
    /* new loans optional */
  }
  return { advances, loans };
}

export type FinalSalaryRow = {
  employee_id: number;
  final_salary: number;
  basic_salary: number;
};

/**
 * Compute Final Salary map for a payroll month (same core formula as Monthly Payroll).
 */
export async function computeMonthlyFinalSalaries(
  month: string,
): Promise<Record<string, number>> {
  if (!/^\d{4}-\d{2}$/.test(month)) return {};

  const workingDays = await countWorkingDays(month);
  const unpaidMap = await loadUnpaidDaysMap(month);
  const { advances, loans } = await loadAdvanceLoanMaps(month);

  const basicMap: Record<string, number> = {};
  const fuelDefault: Record<string, number> = {};
  const ctdDefault: Record<string, number> = {};
  const medicalPkg: Record<string, MedicalPackageId> = {};
  const hoursMap: Record<string, number> = {};

  try {
    const [empRows]: any = await query(
      `SELECT e.id, e.working_hours FROM hrm_employees e`,
    );
    for (const row of asRows<{ id?: number; working_hours?: unknown }>(empRows)) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      for (const k of idKeys(id)) hoursMap[k] = paidHoursPerDay(row.working_hours);
    }
  } catch {
    /* ignore */
  }

  try {
    const [salRows]: any = await query(
      `SELECT employee_id, amount, fuel_allowance, company_transport_deduction, medical_package
       FROM employee_salaries ORDER BY id ASC`,
    );
    for (const row of asRows<any>(salRows)) {
      const id = Number(row.employee_id);
      if (!Number.isFinite(id)) continue;
      const amt = money(row.amount);
      if (amt > 0) {
        for (const k of idKeys(id)) basicMap[k] = (basicMap[k] || 0) + amt;
      }
      const fuel = money(row.fuel_allowance);
      if (fuel > 0) putMap(fuelDefault, id, fuel);
      const ctd = money(row.company_transport_deduction);
      if (ctd > 0) putMap(ctdDefault, id, ctd);
      const pkg = normalizeMedicalPackage(row.medical_package);
      if (pkg) {
        for (const k of idKeys(id)) medicalPkg[k] = pkg;
      }
    }
  } catch {
    /* ignore */
  }

  const fuelAdj: Record<string, number> = {};
  const ctdAdj: Record<string, number> = {};
  const unpaidAdj: Record<string, number> = {};
  const claimsAdj: Record<string, number> = {};
  try {
    const [adjRows]: any = await query(
      `SELECT employee_id, ctd, fuel_allowance, unpaid_days, medical_claims
       FROM monthly_payroll_adjustments WHERE month = ?`,
      [month],
    );
    for (const row of asRows<any>(adjRows)) {
      const id = String(row.employee_id ?? "").trim();
      if (!id) continue;
      if (row.fuel_allowance != null && row.fuel_allowance !== "") {
        putMap(fuelAdj, id, money(row.fuel_allowance));
      }
      if (row.ctd != null && row.ctd !== "") {
        putMap(ctdAdj, id, money(row.ctd));
      }
      if (row.unpaid_days != null && row.unpaid_days !== "") {
        const u = Number(row.unpaid_days);
        if (Number.isFinite(u) && u >= 0) {
          for (const k of idKeys(id)) unpaidAdj[k] = u;
        }
      }
      if (row.medical_claims != null && row.medical_claims !== "") {
        putMap(claimsAdj, id, money(row.medical_claims));
      }
    }
  } catch {
    /* ignore */
  }

  // Employee Claims ledger (approved/paid) overrides / fills medical_claims for the month.
  try {
    const { sumApprovedClaimsByPayrollMonth } = await import(
      "@/lib/employee-claims"
    );
    const claimSums = await sumApprovedClaimsByPayrollMonth(month);
    for (const [id, total] of Object.entries(claimSums)) {
      if (total > 0) putMap(claimsAdj, id, total);
    }
  } catch {
    /* claims table may not exist yet */
  }

  const commissions: Record<
    string,
    {
      train: number;
      arrears: number;
      kpi: number;
      commission: number;
      existing: number;
      trainer: number;
      floor: number;
    }
  > = {};
  try {
    const [cRows]: any = await query(
      `SELECT employee_id, train_6h_amt, arrears, kpi_add, commission,
              existing_client_incentive, trainer_incentive, floor_incentive
       FROM employee_commissions WHERE month = ?`,
      [month],
    );
    for (const row of asRows<any>(cRows)) {
      const id = String(row.employee_id ?? "").trim();
      if (!id) continue;
      const payload = {
        train: money(row.train_6h_amt),
        arrears: money(row.arrears),
        kpi: money(row.kpi_add),
        commission: money(row.commission),
        existing: money(row.existing_client_incentive),
        trainer: money(row.trainer_incentive),
        floor: money(row.floor_incentive),
      };
      for (const k of idKeys(id)) commissions[k] = payload;
    }
  } catch {
    /* ignore */
  }

  // Prefer synced snapshots when present (exact Monthly Payroll values incl. OT / manual)
  const synced: Record<string, number> = {};
  try {
    const [sRows]: any = await query(
      `SELECT employee_id, final_salary FROM monthly_payroll_final_salaries WHERE month = ?`,
      [month],
    );
    for (const row of asRows<{ employee_id?: number; final_salary?: number }>(sRows)) {
      const id = Number(row.employee_id);
      const amt = Number(row.final_salary);
      if (Number.isFinite(id) && Number.isFinite(amt) && amt >= 0) {
        for (const k of idKeys(id)) synced[k] = amt;
      }
    }
  } catch {
    /* table may not exist yet */
  }

  const out: Record<string, number> = {};
  const employeeIds = new Set<number>();
  for (const k of Object.keys(basicMap)) {
    const n = Number(k);
    if (Number.isFinite(n)) employeeIds.add(n);
  }

  for (const employeeId of employeeIds) {
    const syncedAmt = lookupMap(synced, employeeId);
    if (syncedAmt > 0 || Object.prototype.hasOwnProperty.call(synced, String(employeeId))) {
      // Use synced even if 0
      const raw = synced[String(employeeId)] ?? synced[String(Number(employeeId))];
      if (raw != null && Number.isFinite(Number(raw))) {
        out[String(employeeId)] = Math.max(0, Number(raw));
        continue;
      }
    }

    const basicSalary = lookupMap(basicMap, employeeId);
    const hours = hoursMap[String(employeeId)] || hoursMap[String(Number(employeeId))] || 9;
    const perHour = truncPerHourRate(basicSalary, workingDays, hours);
    const fullDayPay = perHour * hours;

    const unpaidDays =
      unpaidAdj[String(employeeId)] ??
      unpaidAdj[String(Number(employeeId))] ??
      unpaidMap[String(employeeId)] ??
      unpaidMap[String(Number(employeeId))] ??
      0;

    const unpaidDaysSalary =
      fullDayPay > 0 && unpaidDays > 0 ? Math.floor(fullDayPay * unpaidDays) : 0;

    const fuel =
      lookupMap(fuelAdj, employeeId) || lookupMap(fuelDefault, employeeId);
    const ctd = lookupMap(ctdAdj, employeeId) || lookupMap(ctdDefault, employeeId);
    const claims = lookupMap(claimsAdj, employeeId);
    const pkg =
      medicalPkg[String(employeeId)] || medicalPkg[String(Number(employeeId))];
    const medicalDedc = medicalDeductionForPackage(pkg);

    const comm =
      commissions[String(employeeId)] || commissions[String(Number(employeeId))];
    const train = comm?.train || 0;
    const arrears = comm?.arrears || 0;
    const kpiAdd = comm?.kpi || 0;
    const commission = comm?.commission || 0;
    const existing = comm?.existing || 0;
    const trainer = comm?.trainer || 0;
    const floor = comm?.floor || 0;

    // OT omitted in fallback compute (use synced snapshot from Monthly Payroll for exact OT)
    const otSalary = 0;

    const grossSalary =
      basicSalary +
      fuel +
      otSalary +
      train +
      arrears +
      kpiAdd +
      commission +
      existing +
      trainer +
      floor +
      claims;

    const advanceDeduction = lookupMap(advances, employeeId);
    const loanDeduction = lookupMap(loans, employeeId);

    const totalDeductions =
      unpaidDaysSalary + ctd + medicalDedc + advanceDeduction + loanDeduction;

    const netBeforeTax = Math.max(0, grossSalary - totalDeductions);
    const tax = monthlySalaryTaxFromGross(netBeforeTax);
    const finalSalary = Math.max(0, netBeforeTax - tax);
    out[String(employeeId)] = finalSalary;
  }

  return out;
}

export async function upsertMonthlyFinalSalaries(
  month: string,
  rows: Array<{ employee_id: number; final_salary: number }>,
  updatedBy?: number | null,
  source = "monthly_payroll",
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    const employeeId = Number(row.employee_id);
    const finalSalary = Number(row.final_salary);
    if (!Number.isFinite(employeeId) || employeeId <= 0) continue;
    if (!Number.isFinite(finalSalary) || finalSalary < 0) continue;
    await query(
      `INSERT INTO monthly_payroll_final_salaries
         (employee_id, month, final_salary, source, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         final_salary = VALUES(final_salary),
         source = VALUES(source),
         updated_by = VALUES(updated_by)`,
      [employeeId, month, finalSalary, source, updatedBy ?? null],
    );
    n += 1;
  }
  return n;
}
