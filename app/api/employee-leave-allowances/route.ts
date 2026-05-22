import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import { getLeaveCycleStartYmd } from "../../../lib/leave-cycle";

function toYmd(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (m) return m[1];
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// GET: Fetch all employees with their leave allowances
export async function GET(req: NextRequest) {
  let conn;
  try {
    conn = await pool.getConnection();

    // Fetch active employees with fixed allowances and adjustments.
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
      if (cycleStart && leave?.start_date && String(leave.start_date).slice(0, 10) < cycleStart) {
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
    
    // Calculate current balances with current-cycle-only adjustments.
    const employeesWithBalance = rows.map((emp: any) => {
      const empId = Number(emp.id);
      const annualUsed = usedByEmployee.get(empId)?.annual_used || 0;
      const bereavementUsed = usedByEmployee.get(empId)?.bereavement_used || 0;
      const cycleStart = cycleStartByEmployee.get(empId) || null;
      const adjustmentUpdatedAt = toYmd(emp?.allowance_updated_at);
      const isCurrentCycleAdjustment =
        !cycleStart || (adjustmentUpdatedAt !== null && adjustmentUpdatedAt >= cycleStart);
      const annualAdjustment = isCurrentCycleAdjustment ? Number(emp.annual_balance_adjustment || 0) : 0;
      const bereavementAdjustment = isCurrentCycleAdjustment
        ? Number(emp.bereavement_balance_adjustment || 0)
        : 0;

      return {
        ...emp,
        annual_used: annualUsed,
        bereavement_used: bereavementUsed,
        annual_balance_adjustment: annualAdjustment,
        bereavement_balance_adjustment: bereavementAdjustment,
        leave_cycle_start: cycleStart,
        annual_current_balance: emp.annual_allowance - annualUsed + annualAdjustment,
        bereavement_current_balance: emp.bereavement_allowance - bereavementUsed + bereavementAdjustment,
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

    // Get employee info and calculate adjustments needed
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

    let usedSql = `
      SELECT
        COALESCE(SUM(CASE WHEN leave_category != 'bereavement' THEN total_days ELSE 0 END), 0) as annual_used,
        COALESCE(SUM(CASE WHEN leave_category = 'bereavement' THEN total_days ELSE 0 END), 0) as bereavement_used
      FROM employee_leaves
      WHERE employee_id = ? AND status = 'approved'
    `;
    const usedParams: any[] = [employee_id];
    if (cycleStart) {
      usedSql += " AND start_date >= ?";
      usedParams.push(cycleStart);
    }
    const [usedRows]: any = await conn.execute(usedSql, usedParams);
    const annualUsed = Number(usedRows?.[0]?.annual_used || 0);
    const bereavementUsed = Number(usedRows?.[0]?.bereavement_used || 0);
    
    // Calculate balance adjustments
    // current_balance = (allowance - used) + adjustment
    // So: adjustment = current_balance - (allowance - used)
    const annualAdjustment = annual_current_balance - (emp.annual_allowance - annualUsed);
    const bereavementAdjustment = bereavement_current_balance - (emp.bereavement_allowance - bereavementUsed);

    // Insert or update balance adjustments
    const [result]: any = await conn.execute(`
      INSERT INTO employee_leave_allowances 
        (employee_id, annual_balance_adjustment, bereavement_balance_adjustment, annual_allowance, bereavement_allowance, casual_allowance, sick_allowance)
      VALUES (?, ?, ?, ?, ?, 10, 15)
      ON DUPLICATE KEY UPDATE
        annual_balance_adjustment = VALUES(annual_balance_adjustment),
        bereavement_balance_adjustment = VALUES(bereavement_balance_adjustment),
        updated_at = CURRENT_TIMESTAMP
    `, [employee_id, annualAdjustment, bereavementAdjustment, emp.annual_allowance, emp.bereavement_allowance]);

    return NextResponse.json({
      success: true,
      message: "Leave balance updated successfully"
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
