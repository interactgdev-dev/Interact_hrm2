import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

export async function GET(req: NextRequest) {
  let conn;
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get('employeeId');
    const username = searchParams.get('username');
    
    // At least one parameter is required
    if (!employeeId && !username) {
      return NextResponse.json({ success: false, error: 'employeeId or username is required' }, { status: 400 });
    }
    
    conn = await pool.getConnection();
    if (!conn) {
      throw new Error("Failed to get database connection from pool");
    }
    
      let query = `SELECT e.*, d.name AS department_name 
        FROM hrm_employees e
        LEFT JOIN employee_jobs j ON e.id = j.employee_id
        LEFT JOIN departments d ON j.department_id = d.id
        WHERE `;
    let params: string[] = [];
    
    if (employeeId) {
      // Search by employee_code, id, or username
        query += '(e.employee_code = ? OR CAST(e.id AS CHAR) = ? OR e.username = ?)';
      params = [employeeId, employeeId, employeeId];
    } else if (username) {
        query += 'e.username = ?';
      params = [username];
    }
    
    const [rows]: any = await conn.execute(query, params);
    if (rows && rows.length > 0) {
      return NextResponse.json({ success: true, employee: rows[0] });
    } else {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }
  } catch (err) {
    console.error('GET hrm_employees error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(req: NextRequest) {
  let conn;
  try {
    const data = await req.json();
    console.log('Received data:', data);
    const {
      first_name,
      middle_name,
      last_name,
      father_name,
      employee_code,
      dob,
      gender,
      marital_status,
      nationality,
      blood_group,
      profile_img,
      username,
      password,
      status,
      role,
      cnic_number,
      cnic_issuance_date,
      cnic_expiry_date,
      employment_status,
      employment_type,
      working_hours
    } = data;
    conn = await pool.getConnection();
    if (!conn) {
      throw new Error("Failed to get database connection from pool");
    }
    // Convert empty employee_code to null to avoid duplicate key constraint
    const empCode = employee_code && employee_code.trim() !== '' ? employee_code : null;
    const empType = employment_type === "Part Time" || employment_type === "Full Time" ? employment_type : null;
    let hoursVal: number | null = null;
    if (empType === "Full Time") {
      hoursVal = 9;
    } else if (empType === "Part Time") {
      const n = Number(working_hours);
      hoursVal = Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
    }
    const fatherName = father_name && String(father_name).trim() !== "" ? String(father_name).trim() : null;
    const bloodGroup = blood_group && String(blood_group).trim() !== "" ? String(blood_group).trim() : null;
    const cnicIssue = cnic_issuance_date && String(cnic_issuance_date).slice(0, 10) || null;
    const cnicExpiry = cnic_expiry_date && String(cnic_expiry_date).slice(0, 10) || null;
    const [result]: any = await conn.execute(
      `INSERT INTO hrm_employees (first_name, pseudonym, last_name, father_name, employee_code, dob, gender, marital_status, nationality, blood_group, profile_img, username, password, status, role, cnic_number, cnic_issuance_date, cnic_expiry_date, employment_status, employment_type, working_hours, face_verification_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [first_name, middle_name, last_name, fatherName, empCode, dob, gender, marital_status, nationality, bloodGroup, profile_img, username, password, status, role, cnic_number, cnicIssue, cnicExpiry, employment_status, empType, hoursVal]
    );
    const insertedId = result.insertId;
    console.log('Insert successful, ID:', insertedId);
    return NextResponse.json({ success: true, id: insertedId });
  } catch (err) {
    console.error('POST Error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

export async function PUT(req: NextRequest) {
  let conn;
  try {
    const data = await req.json();
    console.log('PUT Received data:', data);
    const {
      id,
      first_name,
      middle_name,
      last_name,
      father_name,
      employee_code,
      dob,
      gender,
      marital_status,
      nationality,
      blood_group,
      profile_img,
      username,
      password,
      status,
      role,
      cnic_number,
      cnic_issuance_date,
      cnic_expiry_date,
      employment_status,
      employment_type,
      working_hours
    } = data;
    if (!id && !employee_code && !username) {
      return NextResponse.json({ success: false, error: 'id or employee_code or username is required' }, { status: 400 });
    }
    conn = await pool.getConnection();
    if (!conn) {
      throw new Error("Failed to get database connection from pool");
    }
    const whereClause = id ? 'id = ?' : (employee_code ? 'employee_code = ?' : 'username = ?');
    const whereValue = id ? id : (employee_code ? employee_code : username);
    
    // Convert empty employee_code to null to avoid duplicate key constraint
    const empCode = employee_code && employee_code.trim() !== '' ? employee_code : null;
    const empType = employment_type === "Part Time" || employment_type === "Full Time" ? employment_type : null;
    let hoursVal: number | null = null;
    if (empType === "Full Time") {
      hoursVal = 9;
    } else if (empType === "Part Time") {
      const n = Number(working_hours);
      hoursVal = Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
    }
    const fatherName = father_name && String(father_name).trim() !== "" ? String(father_name).trim() : null;
    const bloodGroup = blood_group && String(blood_group).trim() !== "" ? String(blood_group).trim() : null;
    const cnicIssue = cnic_issuance_date && String(cnic_issuance_date).slice(0, 10) || null;
    const cnicExpiry = cnic_expiry_date && String(cnic_expiry_date).slice(0, 10) || null;
    
    console.log('Update Query:', `UPDATE hrm_employees SET first_name = ?, pseudonym = ?, last_name = ?, father_name = ?, employee_code = ?, dob = ?, gender = ?, marital_status = ?, nationality = ?, blood_group = ?, profile_img = ?, username = ?, password = ?, status = ?, role = ?, cnic_number = ?, cnic_issuance_date = ?, cnic_expiry_date = ?, employment_status = ?, employment_type = ?, working_hours = ? WHERE ${whereClause}`);
    console.log('Parameters:', [first_name, middle_name, last_name, fatherName, empCode, dob, gender, marital_status, nationality, bloodGroup, profile_img, username, password, status, role, cnic_number, cnicIssue, cnicExpiry, employment_status, empType, hoursVal, whereValue]);
    
    const [result]: any = await conn.execute(
      `UPDATE hrm_employees SET first_name = ?, pseudonym = ?, last_name = ?, father_name = ?, employee_code = ?, dob = ?, gender = ?, marital_status = ?, nationality = ?, blood_group = ?, profile_img = ?, username = ?, password = ?, status = ?, role = ?, cnic_number = ?, cnic_issuance_date = ?, cnic_expiry_date = ?, employment_status = ?, employment_type = ?, working_hours = ? WHERE ${whereClause}`,
      [first_name, middle_name, last_name, fatherName, empCode, dob, gender, marital_status, nationality, bloodGroup, profile_img, username, password, status, role, cnic_number, cnicIssue, cnicExpiry, employment_status, empType, hoursVal, whereValue]
    );
    
    console.log('Affected rows:', result.affectedRows);
    
    // Also update employment_status in employee_jobs table to keep it in sync
    if (employment_status) {
      try {
        await conn.execute(
          `UPDATE employee_jobs SET employment_status = ? WHERE employee_id = ?`,
          [employment_status, whereValue]
        );
        console.log('employee_jobs.employment_status also updated');
      } catch (jobErr) {
        console.log('Note: Could not update employee_jobs (may not exist yet):', jobErr);
      }
    }
    
    console.log('Update successful');
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('PUT Error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
