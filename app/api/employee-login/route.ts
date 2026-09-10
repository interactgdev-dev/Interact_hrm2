import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import bcrypt from "bcryptjs";
import {
  employeeLoginIdLower,
  normalizeEmployeeLoginId,
  parseHrmEmployeeId,
} from "@/lib/employee-login-lookup";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const loginId = normalizeEmployeeLoginId(body.loginId);
    const password = String(body.password ?? "");

    if (!loginId || !password) {
      return NextResponse.json({ success: false, error: "Missing credentials" }, { status: 400 });
    }

    const loginLower = employeeLoginIdLower(loginId);
    const hrmEmployeeId = parseHrmEmployeeId(loginId);
    const idMatch = hrmEmployeeId ?? -1;

    // Keep WHERE mongo-sql-adapter friendly: LOWER(TRIM(col)) = ? is supported.
    const [rows]: any = await pool.query(
      `SELECT e.*, ec.email_work AS email
       FROM hrm_employees e
       LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
       WHERE (
         LOWER(TRIM(e.username)) = ?
         OR LOWER(TRIM(ec.email_work)) = ?
         OR e.id = ?
       )
       LIMIT 1`,
      [loginLower, loginLower, idMatch]
    );

    if (!rows.length) {
      return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 });
    }

    const employee = rows[0];

    if (typeof employee.password !== "string") {
      return NextResponse.json({ success: false, error: "Password not set for this user." }, { status: 401 });
    }

    let passwordMatch = false;
    if (employee.password.startsWith("$2a$") || employee.password.startsWith("$2b$")) {
      passwordMatch = await bcrypt.compare(password, employee.password);
    } else {
      passwordMatch = password === employee.password;
    }

    if (!passwordMatch) {
      return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 });
    }

    if (employee.status !== "active" && employee.status !== "enabled") {
      return NextResponse.json({ success: false, error: "Account is inactive. Please contact admin." }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      employee,
      username: employee.username || employee.email || loginId,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
