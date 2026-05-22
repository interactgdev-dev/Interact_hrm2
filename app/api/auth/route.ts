import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

export async function POST(req: NextRequest) {
  try {
    const { loginId, password } = await req.json();
    if (!loginId || !password) {
      return NextResponse.json({ success: false, error: 'Missing credentials' }, { status: 400 });
    }
    // Check admin
    if ((loginId === 'admin@interact.com' || loginId === 'interactadmin' || loginId === 'admin') && password === 'interact123') {
      return NextResponse.json({ success: true, isAdmin: true });
    }
    // Check employee in hrm_employees
    const [rows] = await pool.query('SELECT * FROM hrm_employees WHERE (username = ? OR employee_code = ?) AND password = ?', [loginId, loginId, password]);
    if (Array.isArray(rows) && rows.length > 0) {
      const emp = rows[0] as { status?: string; role?: string; id: any; employee_code: any; first_name: string; last_name: string };
      if (emp.status === 'inactive' || emp.status === 'disabled') {
        return NextResponse.json({ success: false, error: 'Your account is inactive. Please contact admin.' }, { status: 403 });
      }
      return NextResponse.json({ success: true, isAdmin: false, role: emp.role || 'Officer', employee: { id: emp.id, employee_code: emp.employee_code, name: emp.first_name + ' ' + emp.last_name } });
    }
    return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
