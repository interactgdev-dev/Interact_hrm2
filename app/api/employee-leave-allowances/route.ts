import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import {
  getLeaveCycleStartYmd,
  leaveDateToYmd,
} from "../../../lib/leave-cycle";
import {
  BEREAVEMENT_ALLOWANCE,
  MATERNITY_ALLOWANCE,
  PATERNITY_ALLOWANCE,
  normalizeEmployeeGender,
} from "../../../lib/leave-categories";
import { getDateStringInTimeZone } from "../../../lib/timezone";

function parseLeaveDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // Allow negative remaining (over-limit); round to half-days.
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

/** One row per employee — multiple jobs must not duplicate the list. */
function dedupeEmployeesById<T extends { id?: unknown }>(rows: T[]): T[] {
  const seen = new Map<number, T>();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!seen.has(id)) seen.set(id, row);
  }
  return [...seen.values()];
}

type AllowanceRow = {
  id?: number | string;
  employee_id?: number | string;
  annual_balance_adjustment?: number;
  bereavement_balance_adjustment?: number;
  maternity_balance_adjustment?: number;
  paternity_balance_adjustment?: number;
  updated_at?: unknown;
};

function allowanceUpdatedMs(row: AllowanceRow): number {
  const ymd = leaveDateToYmd(row?.updated_at);
  if (ymd) {
    const ms = Date.parse(`${ymd}T00:00:00Z`);
    if (Number.isFinite(ms)) return ms;
  }
  const raw = row?.updated_at;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.getTime();
  const n = Number(row?.id);
  return Number.isFinite(n) ? n : 0;
}

/** Latest allowance row per employee (Mongo may lack UNIQUE → many inserts). */
function latestAllowanceByEmployee(
  rows: AllowanceRow[],
): Map<number, AllowanceRow> {
  const map = new Map<number, AllowanceRow>();
  for (const row of rows) {
    const eid = Number(row?.employee_id);
    if (!Number.isFinite(eid) || eid <= 0) continue;
    const prev = map.get(eid);
    if (!prev || allowanceUpdatedMs(row) >= allowanceUpdatedMs(prev)) {
      map.set(eid, row);
    }
  }
  return map;
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

    // Do NOT join allowances here — Mongo often has duplicate ela rows (no UNIQUE),
    // and LEFT JOIN + first-row dedupe kept a stale adjustment (Ayyaz −2.5 after edit).
    const [rows]: any = await conn.execute(`
      SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.employee_code,
        e.employment_status,
        e.gender,
        j.joined_date,
        d.name AS department_name
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
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

    let allowanceByEmp = new Map<number, AllowanceRow>();
    let leaveRows: any[] = [];
    if (employeeIds.length > 0) {
      const placeholders = employeeIds.map(() => "?").join(",");
      try {
        const [allowRows]: any = await conn.execute(
          `SELECT id, employee_id,
                  annual_balance_adjustment, bereavement_balance_adjustment,
                  maternity_balance_adjustment, paternity_balance_adjustment,
                  updated_at
           FROM employee_leave_allowances
           WHERE employee_id IN (${placeholders})
              OR CAST(employee_id AS CHAR) IN (${employeeIds.map(() => "?").join(",")})`,
          [...employeeIds, ...employeeIds.map(String)],
        );
        allowanceByEmp = latestAllowanceByEmployee(
          Array.isArray(allowRows) ? allowRows : [],
        );
      } catch {
        allowanceByEmp = new Map();
      }

      const [leaves]: any = await conn.execute(
        `SELECT id, employee_id, leave_category, total_days, start_date, updated_at, reason, status
         FROM employee_leaves
         WHERE status = 'approved'
           AND (employee_id IN (${placeholders})
             OR CAST(employee_id AS CHAR) IN (${employeeIds.map(() => "?").join(",")}))`,
        [...employeeIds, ...employeeIds.map(String)],
      );
      const { dedupeLeavesByTicketMarker } = await import(
        "@/lib/leave-row-dedupe"
      );
      leaveRows = dedupeLeavesByTicketMarker(
        Array.isArray(leaves) ? leaves : [],
      );
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

    const todayYmd = getDateStringInTimeZone(new Date());
    leaveRows.forEach((leave: any) => {
      const empId = Number(leave.employee_id);
      const current = usedByEmployee.get(empId);
      if (!current) return;

      const cycleStart = cycleStartByEmployee.get(empId) || null;
      const leaveYmd =
        leaveDateToYmd(leave?.updated_at) || leaveDateToYmd(leave?.start_date);
      if (cycleStart && leaveYmd && leaveYmd < cycleStart) return;
      if (leaveYmd && todayYmd && leaveYmd > todayYmd) return;

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
      const ela = allowanceByEmp.get(empId);
      // Always apply latest stored HR adjustment on Balances (edits must survive refresh).
      const annualAdjustment = Number(ela?.annual_balance_adjustment || 0);
      const bereavementAdjustment = Number(
        ela?.bereavement_balance_adjustment || 0,
      );
      const maternityAdjustment = Number(ela?.maternity_balance_adjustment || 0);
      const paternityAdjustment = Number(ela?.paternity_balance_adjustment || 0);
      const annualAllowance = annualAllowanceForStatus(emp.employment_status);
      const bereavementAllowance = BEREAVEMENT_ALLOWANCE;
      const maternityAllowance = MATERNITY_ALLOWANCE;
      const paternityAllowance = PATERNITY_ALLOWANCE;
      const genderNorm = normalizeEmployeeGender(emp.gender);

      // Cap at policy max; allow negative when used exceeds allowance.
      const clampBal = (raw: number, max: number) =>
        roundLeaveDays(Math.min(max, raw));

      const annualCurrent = clampBal(
        annualAllowance - used.annual_used + annualAdjustment,
        annualAllowance,
      );
      const bereavementCurrent = clampBal(
        bereavementAllowance - used.bereavement_used + bereavementAdjustment,
        bereavementAllowance,
      );
      const maternityCurrent =
        genderNorm === "female"
          ? clampBal(
              maternityAllowance - used.maternity_used + maternityAdjustment,
              maternityAllowance,
            )
          : 0;
      const paternityCurrent =
        genderNorm === "male"
          ? clampBal(
              paternityAllowance - used.paternity_used + paternityAdjustment,
              paternityAllowance,
            )
          : 0;

      return {
        ...emp,
        gender: emp.gender || null,
        annual_allowance: annualAllowance,
        bereavement_allowance: bereavementAllowance,
        maternity_allowance: genderNorm === "female" ? maternityAllowance : 0,
        paternity_allowance: genderNorm === "male" ? paternityAllowance : 0,
        // Actual approved days used (can exceed allowance when over-limit).
        annual_used: roundLeaveDays(Math.max(0, used.annual_used)),
        bereavement_used: roundLeaveDays(Math.max(0, used.bereavement_used)),
        maternity_used: roundLeaveDays(Math.max(0, used.maternity_used)),
        paternity_used: roundLeaveDays(Math.max(0, used.paternity_used)),
        annual_balance_adjustment: annualAdjustment,
        bereavement_balance_adjustment: bereavementAdjustment,
        maternity_balance_adjustment: maternityAdjustment,
        paternity_balance_adjustment: paternityAdjustment,
        leave_cycle_start: cycleStart,
        annual_current_balance: annualCurrent,
        bereavement_current_balance: bereavementCurrent,
        maternity_current_balance: maternityCurrent,
        paternity_current_balance: paternityCurrent,
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
    const annualAllowance = annualAllowanceForStatus(emp.employment_status);
    const bereavementAllowance = BEREAVEMENT_ALLOWANCE;
    const maternityAllowance = MATERNITY_ALLOWANCE;
    const paternityAllowance = PATERNITY_ALLOWANCE;
    // Allow HR to set negative remaining (over-limit); still cap at policy max.
    const clampTarget = (raw: unknown, max: number) =>
      Math.min(max, parseLeaveDays(raw));
    const annualTarget = clampTarget(annual_current_balance, annualAllowance);
    const bereavementTarget = clampTarget(
      bereavement_current_balance,
      bereavementAllowance,
    );
    const maternityTarget = clampTarget(
      maternity_current_balance,
      maternityAllowance,
    );
    const paternityTarget = clampTarget(
      paternity_current_balance,
      paternityAllowance,
    );

    const eid = Number(employee_id);
    const [leaveRows]: any = await conn.execute(
      `SELECT id, leave_category, total_days, start_date, updated_at, reason, status
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
    const todayYmd = getDateStringInTimeZone(new Date());
    const { dedupeLeavesByTicketMarker } = await import(
      "@/lib/leave-row-dedupe"
    );
    dedupeLeavesByTicketMarker(
      Array.isArray(leaveRows) ? leaveRows : [],
    ).forEach((leave: any) => {
      const leaveYmd =
        leaveDateToYmd(leave?.updated_at) || leaveDateToYmd(leave?.start_date);
      if (cycleStart && leaveYmd && leaveYmd < cycleStart) return;
      if (leaveYmd && todayYmd && leaveYmd > todayYmd) return;
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

    // Real ISO timestamp — Mongo adapter stores SQL NOW() as literal "NOW()".
    const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");

    // Mongo often has no UNIQUE on employee_id, so ON DUPLICATE KEY never updates —
    // each save inserts another row and GET used to keep the first (stale) one.
    const [existingRows]: any = await conn.execute(
      `SELECT id FROM employee_leave_allowances
       WHERE employee_id = ? OR CAST(employee_id AS CHAR) = ?
       ORDER BY id DESC`,
      [eid, String(eid)],
    );
    const existing = Array.isArray(existingRows) ? existingRows : [];
    const keepId = existing[0]?.id;

    if (keepId != null) {
      await conn.execute(
        `UPDATE employee_leave_allowances SET
          annual_balance_adjustment = ?,
          bereavement_balance_adjustment = ?,
          maternity_balance_adjustment = ?,
          paternity_balance_adjustment = ?,
          annual_allowance = ?,
          bereavement_allowance = ?,
          maternity_allowance = ?,
          paternity_allowance = ?,
          updated_at = ?
         WHERE id = ?`,
        [
          annualAdjustment,
          bereavementAdjustment,
          maternityAdjustment,
          paternityAdjustment,
          annualAllowance,
          bereavementAllowance,
          maternityAllowance,
          paternityAllowance,
          nowIso,
          keepId,
        ],
      );
      for (const extra of existing.slice(1)) {
        if (extra?.id == null) continue;
        try {
          await conn.execute(
            `DELETE FROM employee_leave_allowances WHERE id = ?`,
            [extra.id],
          );
        } catch {
          /* ignore cleanup failures */
        }
      }
    } else {
      await conn.execute(
        `INSERT INTO employee_leave_allowances
          (employee_id, annual_balance_adjustment, bereavement_balance_adjustment,
           maternity_balance_adjustment, paternity_balance_adjustment,
           annual_allowance, bereavement_allowance, maternity_allowance, paternity_allowance,
           casual_allowance, sick_allowance, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 15, ?)`,
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
        ],
      );
    }

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
