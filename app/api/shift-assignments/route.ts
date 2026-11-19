import { NextRequest, NextResponse } from "next/server";
import type { PoolConnection } from "mysql2/promise";
import { upsertShiftAssignment } from "@/lib/shift-assignment-upsert";
import { pool, query } from "@/lib/db";

function parseAllowOvertime(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === 1 || value === "1") return true;
  return false;
}

/** Legacy alias for shift assignment list + assign used by older shift-setup pages. */
export async function GET() {
  try {
    const [rows] = (await query(
      `SELECT
        sa.id,
        d.name AS department_name,
        e.first_name,
        e.last_name,
        sa.shift_name,
        sa.assigned_date AS assign_date,
        sa.created_at
      FROM shift_assignments sa
      JOIN hrm_employees e ON e.id = sa.employee_id
      LEFT JOIN employee_jobs ej ON ej.employee_id = e.id
      LEFT JOIN departments d ON d.id = ej.department_id
      WHERE sa.shift_name IS NOT NULL
        AND sa.start_time IS NOT NULL
        AND sa.end_time IS NOT NULL
      ORDER BY sa.assigned_date DESC, sa.id DESC`,
    )) as any;

    return NextResponse.json(rows);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let conn: PoolConnection | undefined;
  try {
    const body = await req.json();
    const {
      employee_id,
      shift_id,
      assign_date,
      assigned_date,
    } = body;

    if (!employee_id) {
      return NextResponse.json(
        { success: false, error: "employee_id is required" },
        { status: 400 },
      );
    }

    let shiftName = body.shift_name as string | undefined;
    let startTime = body.start_time as string | undefined;
    let endTime = body.end_time as string | undefined;

    if (shift_id) {
      const [shiftRows] = (await query(
        `SELECT name, shift_in, shift_out FROM master_shifts WHERE id = ? LIMIT 1`,
        [shift_id],
      )) as any;
      const shift = shiftRows?.[0];
      if (!shift) {
        return NextResponse.json(
          { success: false, error: "Shift not found" },
          { status: 404 },
        );
      }
      shiftName = shift.name;
      startTime = String(shift.shift_in).slice(0, 5);
      endTime = String(shift.shift_out).slice(0, 5);
    }

    if (!shiftName || !startTime || !endTime) {
      return NextResponse.json(
        { success: false, error: "shift_id or shift_name/start_time/end_time required" },
        { status: 400 },
      );
    }

    const empId = Number(employee_id);
    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid employee_id" },
        { status: 400 },
      );
    }

    const assignDate =
      assign_date || assigned_date || new Date().toISOString().split("T")[0];
    const allowOT = parseAllowOvertime(body.allow_overtime, false);

    conn = await pool.getConnection();
    await upsertShiftAssignment(
      conn,
      empId,
      String(shiftName).trim(),
      String(startTime).trim(),
      String(endTime).trim(),
      assignDate,
      allowOT,
    );

    return NextResponse.json({
      success: true,
      message: "Shift assignment saved successfully",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  } finally {
    conn?.release();
  }
}
