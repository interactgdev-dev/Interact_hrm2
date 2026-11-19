import { NextRequest, NextResponse } from "next/server";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "@/lib/db";

const CHILD_TABLES = [
  "employee_attendance",
  "employee_jobs",
  "employee_contacts",
  "employee_emergency_contacts",
  "employee_salaries",
  "employee_leave_allowances",
  "employee_leaves",
  "employee_tickets",
  "employee_attachments",
  "employee_commissions",
  "employee_financial_requests",
  "employee_face_enrollment",
  "hrm_employee_documents",
  "hrm_form_assignments",
  "hrm_profile_pictures",
  "hrm_saved_logins",
  "hrm_tardy_notes",
  "hrm_team_members",
  "breaks",
  "prayer_breaks",
  "refreshment_breaks",
  "meeting_breaks",
  "shift_assignments",
  "loan_salary",
  "loan_installments",
  "advance_salary",
  "employee_credentials",
  "employees",
];

async function reassignEmployeeId(
  conn: PoolConnection,
  fromId: number,
  toId: number,
  employeeCode?: string | null,
) {
  const [targetRows] = await conn.execute(
    "SELECT id FROM hrm_employees WHERE id = ? LIMIT 1",
    [toId],
  );
  if (Array.isArray(targetRows) && targetRows.length > 0) {
    throw new Error(`Employee id ${toId} already exists`);
  }

  const [sourceRows] = await conn.execute(
    "SELECT id FROM hrm_employees WHERE id = ? LIMIT 1",
    [fromId],
  );
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    throw new Error(`Employee id ${fromId} not found`);
  }

  await conn.query("SET FOREIGN_KEY_CHECKS=0");
  try {
    for (const table of CHILD_TABLES) {
      try {
        await conn.execute(
          `UPDATE \`${table}\` SET employee_id = ? WHERE employee_id = ?`,
          [toId, fromId],
        );
      } catch {
        /* table may not exist on this environment */
      }
    }

    if (employeeCode != null && String(employeeCode).trim() !== "") {
      await conn.execute(
        "UPDATE hrm_employees SET id = ?, employee_code = ? WHERE id = ?",
        [toId, String(employeeCode).trim(), fromId],
      );
    } else {
      await conn.execute("UPDATE hrm_employees SET id = ? WHERE id = ?", [
        toId,
        fromId,
      ]);
    }

    const nextAuto = Math.max(toId, fromId) + 1;
    await conn.query(`ALTER TABLE hrm_employees AUTO_INCREMENT = ${nextAuto}`);
  } finally {
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
  }
}

/** POST { from_id: 42, to_id: 83, employee_code?: "83" } */
export async function POST(req: NextRequest) {
  let conn: PoolConnection | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    const fromId = Number(body.from_id);
    const toId = Number(body.to_id);
    const employeeCode =
      body.employee_code != null ? String(body.employee_code) : null;

    if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId <= 0 || toId <= 0) {
      return NextResponse.json(
        { success: false, error: "from_id and to_id are required positive numbers" },
        { status: 400 },
      );
    }
    if (fromId === toId) {
      return NextResponse.json(
        { success: false, error: "from_id and to_id must differ" },
        { status: 400 },
      );
    }

    conn = await pool.getConnection();
    await reassignEmployeeId(conn, fromId, toId, employeeCode);

    return NextResponse.json({
      success: true,
      from_id: fromId,
      to_id: toId,
      employee_code: employeeCode,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    conn?.release();
  }
}
