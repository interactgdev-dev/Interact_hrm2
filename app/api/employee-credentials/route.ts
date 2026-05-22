import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../lib/db";

export async function GET() {
  try {
    const sql = `
      SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.username,
        e.password,
        ec.email_work,
        ec.email_other,
        ec.phone_mobile
      FROM hrm_employees e
      LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
      ORDER BY e.id
    `;
    
    const [employees] = await query(sql) as any;
    return NextResponse.json({ success: true, employees });
  } catch (error: any) {
    console.error("Error fetching employee credentials:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, username, email, password } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Employee ID is required" },
        { status: 400 }
      );
    }

    // Update username in hrm_employees table
    if (username !== undefined) {
      await query(
        `UPDATE hrm_employees SET username = ? WHERE id = ?`,
        [username, id]
      );
    }

    // Update password in hrm_employees table if provided (plain text)
    if (password !== undefined && password !== "") {
      await query(
        `UPDATE hrm_employees SET password = ? WHERE id = ?`,
        [password, id]
      );
    }

    // Update email in employee_contacts table
    if (email !== undefined) {
      // Check if contact record exists
      const [contactCheck] = await query(
        `SELECT id FROM employee_contacts WHERE employee_id = ?`,
        [id]
      ) as any;

      if (contactCheck.length > 0) {
        // Update existing record - update email_work
        await query(
          `UPDATE employee_contacts SET email_work = ? WHERE employee_id = ?`,
          [email, id]
        );
      } else {
        // Insert new record
        await query(
          `INSERT INTO employee_contacts (employee_id, email_work) VALUES (?, ?)`,
          [id, email]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error updating employee credentials:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
