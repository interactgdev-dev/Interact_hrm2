export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !status) return NextResponse.json({ success: false, error: 'id and status required' }, { status: 400 });
    await pool.execute('UPDATE hrm_employees SET status = ? WHERE id = ?', [status, id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const departmentId = searchParams.get('department_id');

    let query = '';
    let params: any[] = [];
    if (departmentId) {
      query = `
        SELECT e.id, e.first_name, e.last_name, e.employee_code, e.gender, e.nationality, e.status, e.pseudonym, d.name AS department_name, ec.phone_mobile, ec.email_other, ec.email_work
        FROM hrm_employees e
        LEFT JOIN employee_jobs j ON e.id = j.employee_id
        LEFT JOIN departments d ON j.department_id = d.id
        LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
        WHERE j.department_id = ?
      `;
      params.push(departmentId);
    } else {
      query = `
        SELECT e.id, e.first_name, e.last_name, e.employee_code, e.gender, e.nationality, e.status, e.pseudonym, d.name AS department_name, ec.phone_mobile, ec.email_other, ec.email_work
        FROM hrm_employees e
        LEFT JOIN employee_jobs j ON e.id = j.employee_id
        LEFT JOIN departments d ON j.department_id = d.id
        LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
        ORDER BY e.id DESC
      `;
    }
    const [rows] = await pool.query(query, params);
    return NextResponse.json({ success: true, employees: rows });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    
    // Delete all related records first (ignore errors if tables don't exist)
    const tables = [
      'employee_contacts',
      'employee_emergency_contacts', 
      'employee_jobs',
      'employee_salaries',
      'employee_attachments',
      'employee_attendance',
      'employee_breaks',
      'employee_leaves',
      'hrm_shifts_assignments',
      'prayer_breaks'
    ];
    
    for (const table of tables) {
      try {
        await pool.execute(`DELETE FROM ${table} WHERE employee_id = ?`, [id]);
      } catch (e) {
        // Ignore if table doesn't exist
      }
    }
    
    // Finally delete the employee
    await pool.execute('DELETE FROM hrm_employees WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
