import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import {
  getLeaveCycleStartYmd,
  leaveDateToYmd,
} from "../../../lib/leave-cycle";

function parseLeaveDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 2) / 2;
}

function roundLeaveDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 2) / 2;
}

// GET: Fetch all employees with their leave allowances
export async function GET(req: NextRequest) {
  let conn;
  try {
    conn = await pool.getConnection();

    const [rows]: any = await conn.execute(`
      SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.employee_code,
        e.employment_status,
        j.joined_date,
        CASE WHEN e.employment_status = 'Probation' THEN 3 ELSE 20 END as annual_allowance,
        3 as bereavement_allowance,
        COALESCE(ela.annual_balance_adjustment, 0) as annual_balance_adjustment,
        COALESCE(ela.bereavement_balance_adjustment, 0) as bereavement_balance_adjustment,
        ela.updated_at as allowance_updated_at
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN employee_leave_allowances ela ON e.id = ela.employee_id
      WHERE e.status IN ('enabled', 'active')
      ORDER BY e.id
    `);

    const employeeIds = rows.map((r: any) => r.id).filter((id: any) => id != null);
    let leaveRows: any[] = [];
    if (employeeIds.length > 0) {
      const placeholders = employeeIds.map(() => "?").join(",");
      const [leaves]: any = await conn.execute(
        `SELECT employee_id, leave_category, total_days, start_date
         FROM employee_leaves
         WHERE status = 'approved' AND employee_id IN (${placeholders})`,
        employeeIds
      );
      leaveRows = Array.isArray(leaves) ? leaves : [];
    }

    const usedByEmployee = new Map<number, { annual_used: number; bereavement_used: number }>();
    const cycleStartByEmployee = new Map<number, string | null>();
    rows.forEach((emp: any) => {
      const empId = Number(emp.id);
      usedByEmployee.set(empId, { annual_used: 0, bereavement_used: 0 });
      cycleStartByEmployee.set(empId, getLeaveCycleStartYmd(emp.joined_date || null));
    });

    leaveRows.forEach((leave: any) => {
      const empId = Number(leave.employee_id);
      const current = usedByEmployee.get(empId);
      if (!current) return;

      const cycleStart = cycleStartByEmployee.get(empId) || null;
      const startYmd = leaveDateToYmd(leave?.start_date);
      if (cycleStart && startYmd && startYmd < cycleStart) {
        return;
      }

      const days = Number(leave.total_days || 0);
      if (!Number.isFinite(days) || days <= 0) return;

      if (String(leave.leave_category || "").toLowerCase() === "bereavement") {
        current.bereavement_used += days;
      } else {
        current.annual_used += days;
      }
    });

    const employeesWithBalance = rows.map((emp: any) => {
      const empId = Number(emp.id);
      const annualUsed = usedByEmployee.get(empId)?.annual_used || 0;
      const bereavementUsed = usedByEmployee.get(empId)?.bereavement_used || 0;
      const cycleStart = cycleStartByEmployee.get(empId) || null;
      const annualAdjustment = Number(emp.annual_balance_adjustment || 0);
      const bereavementAdjustment = Number(emp.bereavement_balance_adjustment || 0);
      const annualAllowance = Number(emp.annual_allowance || 0);
      const bereavementAllowance = Number(emp.bereavement_allowance || 0);

      return {
        ...emp,
        annual_allowance: annualAllowance,
        bereavement_allowance: bereavementAllowance,
        annual_used: annualUsed,
        bereavement_used: bereavementUsed,
        annual_balance_adjustment: annualAdjustment,
        bereavement_balance_adjustment: bereavementAdjustment,
        leave_cycle_start: cycleStart,
        annual_current_balance: roundLeaveDays(annualAllowance - annualUsed + annualAdjustment),
        bereavement_current_balance: roundLeaveDays(
          bereavementAllowance - bereavementUsed + bereavementAdjustment
        ),
      };
    });

    return NextResponse.json({
      success: true,
      employees: employeesWithBalance
    });
  } catch (error) {
    console.error("Error fetching employee leave allowances:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// POST: Update current balance for an employee
export async function POST(req: NextRequest) {
  let conn;
  try {
    const { employee_id, annual_current_balance, bereavement_current_balance } = await req.json();

    if (!employee_id) {
      return NextResponse.json({
        success: false,
        error: "employee_id is required"
      }, { status: 400 });
    }

    conn = await pool.getConnection();

    const [empRows]: any = await conn.execute(`
      SELECT 
        e.id,
        e.employment_status,
        j.joined_date,
        CASE WHEN e.employment_status = 'Probation' THEN 3 ELSE 20 END as annual_allowance,
        3 as bereavement_allowance
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      WHERE e.id = ?
    `, [employee_id]);

    if (empRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Employee not found"
      }, { status: 404 });
    }

    const emp = empRows[0];
    const cycleStart = getLeaveCycleStartYmd(emp.joined_date || null);
    const annualTarget = parseLeaveDays(annual_current_balance);
    const bereavementTarget = parseLeaveDays(bereavement_current_balance);
    const annualAllowance = Number(emp.annual_allowance || 0);
    const bereavementAllowance = Number(emp.bereavement_allowance || 0);

    const [leaveRows]: any = await conn.execute(
      `SELECT leave_category, total_days, start_date
       FROM employee_leaves
       WHERE employee_id = ? AND status = 'approved'`,
      [employee_id]
    );

    let annualUsed = 0;
    let bereavementUsed = 0;
    (Array.isArray(leaveRows) ? leaveRows : []).forEach((leave: any) => {
      const startYmd = leaveDateToYmd(leave?.start_date);
      if (cycleStart && startYmd && startYmd < cycleStart) return;
      const days = Number(leave.total_days || 0);
      if (!Number.isFinite(days) || days <= 0) return;
      if (String(leave.leave_category || "").toLowerCase() === "bereavement") {
        bereavementUsed += days;
      } else {
        annualUsed += days;
      }
    });

    const annualAdjustment = roundLeaveDays(annualTarget - (annualAllowance - annualUsed));
    const bereavementAdjustment = roundLeaveDays(
      bereavementTarget - (bereavementAllowance - bereavementUsed)
    );

    await conn.execute(
      `INSERT INTO employee_leave_allowances
        (employee_id, annual_balance_adjustment, bereavement_balance_adjustment, annual_allowance, bereavement_allowance, casual_allowance, sick_allowance, updated_at)
      VALUES (?, ?, ?, ?, ?, 10, 15, NOW())
      ON DUPLICATE KEY UPDATE
        annual_balance_adjustment = ?,
        bereavement_balance_adjustment = ?,
        updated_at = NOW()`,
      [
        employee_id,
        annualAdjustment,
        bereavementAdjustment,
        annualAllowance,
        bereavementAllowance,
        annualAdjustment,
        bereavementAdjustment,
      ]
    );

    return NextResponse.json({
      success: true,
      message: "Leave balance updated successfully",
      annual_current_balance: annualTarget,
      bereavement_current_balance: bereavementTarget,
    });
  } catch (error) {
    console.error("Error updating leave allowance:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
