import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import {
  getLeaveCycleStartYmd,
  leaveDateToYmd,
  shouldApplyLeaveAdjustment,
} from "../../../lib/leave-cycle";
import {
  BEREAVEMENT_ALLOWANCE,
  MATERNITY_ALLOWANCE,
  PATERNITY_ALLOWANCE,
  normalizeEmployeeGender,
} from "../../../lib/leave-categories";

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

function annualAllowanceForStatus(employmentStatus: unknown): number {
  const s = String(employmentStatus || "").trim().toLowerCase();
  return s.includes("probation") ? 3 : 20;
}

/** One row per employee — multiple jobs/allowance rows must not duplicate the list. */
function dedupeEmployeesById<T extends { id?: unknown }>(rows: T[]): T[] {
  const seen = new Map<number, T>();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!seen.has(id)) seen.set(id, row);
  }
  return [...seen.values()];
}

type UsedBucket = {
  annual_used: number;
  bereavement_used: number;
  maternity_used: number;
  paternity_used: number;
};

function bumpUsed(bucket: UsedBucket, category: string, days: number) {
  const c = String(category || "").toLowerCase();
  if (c === "bereavement") bucket.bereavement_used += days;
  else if (c === "maternity") bucket.maternity_used += days;
  else if (c === "paternity") bucket.paternity_used += days;
  else bucket.annual_used += days;
}

// GET: Fetch employees with leave allowances (scoped by viewer hierarchy)
export async function GET(req: NextRequest) {
  let conn;
  try {
    conn = await pool.getConnection();

    const viewerId =
      req.headers.get("x-hrm-employee-id") ||
      req.headers.get("x-employee-id") ||
      req.nextUrl.searchParams.get("viewerId") ||
      "";

    const [rows]: any = await conn.execute(`
      SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.employee_code,
        e.employment_status,
        e.gender,
        j.joined_date,
        d.name AS department_name,
        COALESCE(ela.annual_balance_adjustment, 0) as annual_balance_adjustment,
        COALESCE(ela.bereavement_balance_adjustment, 0) as bereavement_balance_adjustment,
        COALESCE(ela.maternity_balance_adjustment, 0) as maternity_balance_adjustment,
        COALESCE(ela.paternity_balance_adjustment, 0) as paternity_balance_adjustment,
        ela.updated_at as allowance_updated_at
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN employee_leave_allowances ela ON e.id = ela.employee_id
      WHERE e.status IN ('enabled', 'active')
      ORDER BY e.id
    `);

    let scopedRows = dedupeEmployeesById(Array.isArray(rows) ? rows : []);
    if (viewerId.trim()) {
      try {
        const { resolveViewerDataScope, rowInViewerScope } = await import(
          "@/lib/access-control/data-scope"
        );
        const scope = await resolveViewerDataScope(viewerId.trim());
        if (scope.mode !== "all") {
          scopedRows = scopedRows.filter((r: any) =>
            rowInViewerScope(scope, {
              employeeId: r.id,
              departmentName: r.department_name,
            }),
          );
        }
      } catch {
        /* keep full list if scope helper fails */
      }
    }

    const employeeIds = scopedRows
      .map((r: any) => Number(r.id))
      .filter((id: number) => Number.isFinite(id) && id > 0);
    let leaveRows: any[] = [];
    if (employeeIds.length > 0) {
      const placeholders = employeeIds.map(() => "?").join(",");
      // Match numeric + string employee_id (Mongo / mixed legacy rows).
      const [leaves]: any = await conn.execute(
        `SELECT employee_id, leave_category, total_days, start_date, updated_at
         FROM employee_leaves
         WHERE status = 'approved'
           AND (employee_id IN (${placeholders})
             OR CAST(employee_id AS CHAR) IN (${employeeIds.map(() => "?").join(",")}))`,
        [...employeeIds, ...employeeIds.map(String)],
      );
      leaveRows = Array.isArray(leaves) ? leaves : [];
    }

    const usedByEmployee = new Map<number, UsedBucket>();
    const cycleStartByEmployee = new Map<number, string | null>();
    scopedRows.forEach((emp: any) => {
      const empId = Number(emp.id);
      usedByEmployee.set(empId, {
        annual_used: 0,
        bereavement_used: 0,
        maternity_used: 0,
        paternity_used: 0,
      });
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
      bumpUsed(current, leave.leave_category, days);
    });

    const employeesWithBalance = scopedRows.map((emp: any) => {
      const empId = Number(emp.id);
      const used = usedByEmployee.get(empId) || {
        annual_used: 0,
        bereavement_used: 0,
        maternity_used: 0,
        paternity_used: 0,
      };
      const cycleStart = cycleStartByEmployee.get(empId) || null;
      const applyAdj = shouldApplyLeaveAdjustment(
        emp.allowance_updated_at,
        cycleStart,
      );
      const annualAdjustment = applyAdj
        ? Number(emp.annual_balance_adjustment || 0)
        : 0;
      const bereavementAdjustment = applyAdj
        ? Number(emp.bereavement_balance_adjustment || 0)
        : 0;
      const maternityAdjustment = applyAdj
        ? Number(emp.maternity_balance_adjustment || 0)
        : 0;
      const paternityAdjustment = applyAdj
        ? Number(emp.paternity_balance_adjustment || 0)
        : 0;
      const annualAllowance = annualAllowanceForStatus(emp.employment_status);
      const bereavementAllowance = BEREAVEMENT_ALLOWANCE;
      const maternityAllowance = MATERNITY_ALLOWANCE;
      const paternityAllowance = PATERNITY_ALLOWANCE;
      const genderNorm = normalizeEmployeeGender(emp.gender);

      return {
        ...emp,
        gender: emp.gender || null,
        annual_allowance: annualAllowance,
        bereavement_allowance: bereavementAllowance,
        maternity_allowance: genderNorm === "female" ? maternityAllowance : 0,
        paternity_allowance: genderNorm === "male" ? paternityAllowance : 0,
        // Effective used = allowance − remaining (tickets + HR adjustments).
        annual_used: roundLeaveDays(
          Math.max(0, annualAllowance - (annualAllowance - used.annual_used + annualAdjustment)),
        ),
        bereavement_used: roundLeaveDays(
          Math.max(
            0,
            bereavementAllowance -
              (bereavementAllowance - used.bereavement_used + bereavementAdjustment),
          ),
        ),
        maternity_used: roundLeaveDays(
          Math.max(
            0,
            maternityAllowance -
              (maternityAllowance - used.maternity_used + maternityAdjustment),
          ),
        ),
        paternity_used: roundLeaveDays(
          Math.max(
            0,
            paternityAllowance -
              (paternityAllowance - used.paternity_used + paternityAdjustment),
          ),
        ),
        annual_balance_adjustment: annualAdjustment,
        bereavement_balance_adjustment: bereavementAdjustment,
        maternity_balance_adjustment: maternityAdjustment,
        paternity_balance_adjustment: paternityAdjustment,
        leave_cycle_start: cycleStart,
        annual_current_balance: roundLeaveDays(
          annualAllowance - used.annual_used + annualAdjustment,
        ),
        bereavement_current_balance: roundLeaveDays(
          bereavementAllowance - used.bereavement_used + bereavementAdjustment,
        ),
        maternity_current_balance:
          genderNorm === "female"
            ? roundLeaveDays(
                maternityAllowance - used.maternity_used + maternityAdjustment,
              )
            : 0,
        paternity_current_balance:
          genderNorm === "male"
            ? roundLeaveDays(
                paternityAllowance - used.paternity_used + paternityAdjustment,
              )
            : 0,
      };
    });

    return NextResponse.json({
      success: true,
      employees: employeesWithBalance,
    });
  } catch (error) {
    console.error("Error fetching employee leave allowances:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    if (conn) conn.release();
  }
}

// POST: Update current balance for an employee
export async function POST(req: NextRequest) {
  let conn;
  try {
    const body = await req.json();
    const {
      employee_id,
      annual_current_balance,
      bereavement_current_balance,
      maternity_current_balance,
      paternity_current_balance,
    } = body;

    if (!employee_id) {
      return NextResponse.json(
        { success: false, error: "employee_id is required" },
        { status: 400 },
      );
    }

    conn = await pool.getConnection();

    const [empRows]: any = await conn.execute(
      `
      SELECT 
        e.id,
        e.employment_status,
        e.gender,
        j.joined_date,
        d.name AS department_name
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      WHERE e.id = ?
    `,
      [employee_id],
    );

    if (empRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 },
      );
    }

    const emp = empRows[0];

    const viewerId =
      req.headers.get("x-hrm-employee-id") ||
      req.headers.get("x-employee-id") ||
      String(body?.viewerId || "").trim() ||
      "";
    const isAdminViewer =
      String(req.headers.get("x-hrm-portal") || "").toLowerCase() === "admin" ||
      String(body?.portal || "").toLowerCase() === "admin";

    if (!viewerId && !isAdminViewer) {
      return NextResponse.json(
        { success: false, error: "viewerId is required" },
        { status: 401 },
      );
    }
    try {
      if (viewerId && !isAdminViewer) {
        const { getEmployeeAccessPayload } = await import(
          "@/lib/access-control/store"
        );
        const { permissionSetHas } = await import(
          "@/lib/access-control/permission-scope"
        );
        const access = await getEmployeeAccessPayload(viewerId);
        const perms = Array.isArray(access?.permissions) ? access.permissions : [];
        if (!permissionSetHas(perms, "leave.balances.edit")) {
          return NextResponse.json(
            {
              success: false,
              error: "Only HR Admin can edit leave balances",
            },
            { status: 403 },
          );
        }
        const { resolveViewerDataScope, rowInViewerScope } = await import(
          "@/lib/access-control/data-scope"
        );
        const scope = await resolveViewerDataScope(viewerId);
        if (
          scope.mode !== "all" &&
          !rowInViewerScope(scope, {
            employeeId: emp.id,
            departmentName: emp.department_name,
          })
        ) {
          return NextResponse.json(
            { success: false, error: "Out of scope" },
            { status: 403 },
          );
        }
      }
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Permission check failed",
        },
        { status: 403 },
      );
    }
    const genderNorm = normalizeEmployeeGender(emp.gender);
    const cycleStart = getLeaveCycleStartYmd(emp.joined_date || null);
    const annualTarget = parseLeaveDays(annual_current_balance);
    const bereavementTarget = parseLeaveDays(bereavement_current_balance);
    const maternityTarget = parseLeaveDays(maternity_current_balance);
    const paternityTarget = parseLeaveDays(paternity_current_balance);
    const annualAllowance = annualAllowanceForStatus(emp.employment_status);
    const bereavementAllowance = BEREAVEMENT_ALLOWANCE;
    const maternityAllowance = MATERNITY_ALLOWANCE;
    const paternityAllowance = PATERNITY_ALLOWANCE;

    const eid = Number(employee_id);
    const [leaveRows]: any = await conn.execute(
      `SELECT leave_category, total_days, start_date
       FROM employee_leaves
       WHERE status = 'approved'
         AND (employee_id = ? OR CAST(employee_id AS CHAR) = ?)`,
      [eid, String(eid)],
    );

    const used: UsedBucket = {
      annual_used: 0,
      bereavement_used: 0,
      maternity_used: 0,
      paternity_used: 0,
    };
    (Array.isArray(leaveRows) ? leaveRows : []).forEach((leave: any) => {
      const startYmd = leaveDateToYmd(leave?.start_date);
      if (cycleStart && startYmd && startYmd < cycleStart) return;
      const days = Number(leave.total_days || 0);
      if (!Number.isFinite(days) || days <= 0) return;
      bumpUsed(used, leave.leave_category, days);
    });

    const annualAdjustment = roundLeaveDays(
      annualTarget - (annualAllowance - used.annual_used),
    );
    const bereavementAdjustment = roundLeaveDays(
      bereavementTarget - (bereavementAllowance - used.bereavement_used),
    );
    const maternityAdjustment =
      genderNorm === "female"
        ? roundLeaveDays(
            maternityTarget - (maternityAllowance - used.maternity_used),
          )
        : 0;
    const paternityAdjustment =
      genderNorm === "male"
        ? roundLeaveDays(
            paternityTarget - (paternityAllowance - used.paternity_used),
          )
        : 0;

    // Real timestamp — Mongo adapter stores SQL NOW() as the literal string "NOW()",
    // which made cycle checks drop adjustments after refresh (Ayyaz / DM balances).
    const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");

    await conn.execute(
      `INSERT INTO employee_leave_allowances
        (employee_id, annual_balance_adjustment, bereavement_balance_adjustment,
         maternity_balance_adjustment, paternity_balance_adjustment,
         annual_allowance, bereavement_allowance, maternity_allowance, paternity_allowance,
         casual_allowance, sick_allowance, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 15, ?)
      ON DUPLICATE KEY UPDATE
        annual_balance_adjustment = ?,
        bereavement_balance_adjustment = ?,
        maternity_balance_adjustment = ?,
        paternity_balance_adjustment = ?,
        annual_allowance = ?,
        bereavement_allowance = ?,
        maternity_allowance = ?,
        paternity_allowance = ?,
        updated_at = ?`,
      [
        eid,
        annualAdjustment,
        bereavementAdjustment,
        maternityAdjustment,
        paternityAdjustment,
        annualAllowance,
        bereavementAllowance,
        maternityAllowance,
        paternityAllowance,
        nowIso,
        annualAdjustment,
        bereavementAdjustment,
        maternityAdjustment,
        paternityAdjustment,
        annualAllowance,
        bereavementAllowance,
        maternityAllowance,
        paternityAllowance,
        nowIso,
      ],
    );

    return NextResponse.json({
      success: true,
      message: "Leave balance updated successfully",
      annual_current_balance: annualTarget,
      bereavement_current_balance: bereavementTarget,
      maternity_current_balance:
        genderNorm === "female" ? maternityTarget : 0,
      paternity_current_balance: genderNorm === "male" ? paternityTarget : 0,
    });
  } catch (error) {
    console.error("Error updating leave allowance:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    if (conn) conn.release();
  }
}
