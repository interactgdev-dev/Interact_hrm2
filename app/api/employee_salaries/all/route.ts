import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../../lib/db';

// GET /api/employee_salaries/all - return all employees with their basic salary
export async function GET(req: NextRequest) {
  try {
    const [rows]: any = await pool.execute(`
      SELECT e.id as employee_id, e.first_name, e.last_name, e.pseudonym, d.name AS department_name,
        COALESCE(SUM(s.amount), 0) as amount
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN employee_salaries s ON e.id = s.employee_id
      GROUP BY e.id, e.first_name, e.last_name, e.pseudonym, d.name
      ORDER BY e.id DESC
    `);
    return NextResponse.json({ success: true, salaries: rows });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
