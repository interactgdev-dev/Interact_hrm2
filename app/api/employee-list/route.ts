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

function formatAddress(...parts: unknown[]) {
  return parts
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(", ");
}

/** Keep calendar dates as YYYY-MM-DD (avoid UTC shifting DOB by one day). */
function toDateOnly(value: unknown) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const departmentId = searchParams.get('department_id');

    const selectCols = `
        SELECT e.id, e.first_name, e.last_name, e.employee_code, e.gender, e.nationality, e.status, e.pseudonym,
          e.father_name, e.dob, e.cnic_number, e.cnic_issuance_date, e.cnic_expiry_date, e.blood_group,
          d.name AS department_name, j.job_title,
          ec.phone_mobile, ec.email_other, ec.email_work,
          ec.street1, ec.street2, ec.city, ec.state, ec.zip, ec.country,
          ec.permanent_street, ec.permanent_city, ec.permanent_state, ec.permanent_zip, ec.permanent_country
        FROM hrm_employees e
        LEFT JOIN employee_jobs j ON e.id = j.employee_id
        LEFT JOIN departments d ON j.department_id = d.id
        LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
    `;
    let query = '';
    let params: any[] = [];
    if (departmentId) {
      query = `${selectCols} WHERE j.department_id = ?`;
      params.push(departmentId);
    } else {
      query = `${selectCols} ORDER BY e.id DESC`;
    }
    const [rows]: any = await pool.query(query, params);

    const salaryMap: Record<string, number> = {};
    const bankNameMap: Record<string, string> = {};
    const accountNumberMap: Record<string, string> = {};
    const fuelAllowanceMap: Record<string, number> = {};
    try {
      const [salaryRows]: any = await pool.query(
        "SELECT employee_id, amount, account_number, routing_number, fuel_allowance FROM employee_salaries ORDER BY id ASC"
      );
      for (const row of salaryRows || []) {
        const id = String(row.employee_id ?? "").trim();
        if (!id) continue;
        const amt = Number(row.amount);
        if (Number.isFinite(amt) && amt > 0) {
          salaryMap[id] = (salaryMap[id] || 0) + amt;
        }
        const bank = String(row.routing_number ?? "").trim();
        if (bank) bankNameMap[id] = bank;
        const account = String(row.account_number ?? "").trim();
        if (account) accountNumberMap[id] = account;
        const fuel = Number(row.fuel_allowance);
        if (Number.isFinite(fuel) && fuel > 0) {
          fuelAllowanceMap[id] = fuel;
        }
      }
    } catch {
      /* salary table optional */
    }

    const emergencyMap: Record<string, string> = {};
    try {
      const [emergencyRows]: any = await pool.query(
        "SELECT employee_id, phone FROM employee_emergency_contacts ORDER BY id ASC"
      );
      for (const row of emergencyRows || []) {
        const id = String(row.employee_id ?? "").trim();
        const phone = String(row.phone ?? "").trim();
        if (!id || !phone || emergencyMap[id]) continue;
        emergencyMap[id] = phone;
      }
    } catch {
      /* emergency table optional */
    }

    const employees = (rows || []).map((row: any) => {
      const id = String(row.id ?? "");
      return {
        ...row,
        dob: toDateOnly(row.dob),
        cnic_issuance_date: toDateOnly(row.cnic_issuance_date),
        cnic_expiry_date: toDateOnly(row.cnic_expiry_date),
        present_address: formatAddress(
          row.street1,
          row.street2,
          row.city,
          row.state,
          row.zip,
          row.country
        ),
        permanent_address: formatAddress(
          row.permanent_street,
          row.permanent_city,
          row.permanent_state,
          row.permanent_zip,
          row.permanent_country
        ),
        basic_salary: salaryMap[id] || 0,
        bank_name: bankNameMap[id] || "",
        account_number: accountNumberMap[id] || "",
        fuel_allowance: fuelAllowanceMap[id] || 0,
        emergency_phone: emergencyMap[id] || "",
      };
    });

    return NextResponse.json({ success: true, employees });
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
