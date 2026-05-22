import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../lib/db";

export async function GET() {
  try {
    // Fetch all employees with status = 'enabled' or 'active'
    const employees = await query(
      `SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.employee_code,
        e.status,
        sa.shift_name,
        sa.start_time,
        sa.end_time,
        sa.assigned_date
      FROM hrm_employees e
      LEFT JOIN shift_assignments sa ON e.id = sa.employee_id
      WHERE e.status IN ('enabled', 'active')
      ORDER BY e.id`
    );

    return NextResponse.json({ success: true, employees });
  } catch (error: any) {
    console.error("Error fetching employees:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_id, shift_name, start_time, end_time, assigned_date } =
      body;

    if (!employee_id || !shift_name || !start_time || !end_time) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields",
        },
        { status: 400 }
      );
    }

    // Check if assignment already exists
    const existing = (await query(
      `SELECT id FROM shift_assignments WHERE employee_id = ? AND assigned_date = ?`,
      [employee_id, assigned_date || new Date().toISOString().split("T")[0]]
    )) as any[];

    if (existing.length > 0) {
      // Update existing
      await query(
        `UPDATE shift_assignments SET shift_name = ?, start_time = ?, end_time = ? 
         WHERE employee_id = ? AND assigned_date = ?`,
        [
          shift_name,
          start_time,
          end_time,
          employee_id,
          assigned_date || new Date().toISOString().split("T")[0],
        ]
      );
    } else {
      // Create new
      await query(
        `INSERT INTO shift_assignments (employee_id, shift_name, start_time, end_time, assigned_date) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          employee_id,
          shift_name,
          start_time,
          end_time,
          assigned_date || new Date().toISOString().split("T")[0],
        ]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error assigning shift:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
