import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';
import ExcelJS from 'exceljs';

type RowResult = { row: number; status: 'inserted' | 'skipped' | 'failed'; reason?: string; employeeId?: number };

function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function nz<T = string>(v: any): T | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : (s as unknown as T);
}

// Flexible header mapping - normalizes various header formats to our field names
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_MAP: Record<string, string> = {
  // Personal Details
  'firstname': 'first_name',
  'fname': 'first_name',
  'middlename': 'middle_name',
  'mname': 'middle_name',
  'pseudonym': 'middle_name',
  'lastname': 'last_name',
  'lname': 'last_name',
  'surname': 'last_name',
  'employeecode': 'employee_code',
  'employeeid': 'employee_code',
  'empcode': 'employee_code',
  'empid': 'employee_code',
  'dob': 'dob',
  'dateofbirth': 'dob',
  'birthdate': 'dob',
  'gender': 'gender',
  'sex': 'gender',
  'maritalstatus': 'marital_status',
  'nationality': 'nationality',
  'cnic': 'cnic_number',
  'cnicnumber': 'cnic_number',
  'cnicaddress': 'cnic_address',
  'employmentstatus': 'employment_status',
  'username': 'username',
  'password': 'password',
  'status': 'status',
  'role': 'role',
  'designation': 'role',
  
  // Contact Details
  'address': 'street1',
  'street': 'street1',
  'street1': 'street1',
  'address1': 'street1',
  'street2': 'street2',
  'address2': 'street2',
  'city': 'city',
  'state': 'state',
  'province': 'state',
  'zip': 'zip',
  'zipcode': 'zip',
  'postalcode': 'zip',
  'country': 'country',
  'phone': 'phone_mobile',
  'mobile': 'phone_mobile',
  'phonemobile': 'phone_mobile',
  'cellphone': 'phone_mobile',
  'phonehome': 'phone_home',
  'homephone': 'phone_home',
  'phonework': 'phone_work',
  'workphone': 'phone_work',
  'officenumber': 'phone_work',
  'email': 'email_work',
  'emailwork': 'email_work',
  'workemail': 'email_work',
  'officeemail': 'email_work',
  'emailother': 'email_other',
  'personalemail': 'email_other',
  
  // Emergency Contacts
  'emergency1name': 'emergency1_name',
  'emergencycontact1': 'emergency1_name',
  'emergency1relation': 'emergency1_relation',
  'emergency1relationship': 'emergency1_relation',
  'emergency1phone': 'emergency1_phone',
  'emergency2name': 'emergency2_name',
  'emergencycontact2': 'emergency2_name',
  'emergency2relation': 'emergency2_relation',
  'emergency2relationship': 'emergency2_relation',
  'emergency2phone': 'emergency2_phone',
  
  // Salary
  'salary': 'salary_amount',
  'salaryamount': 'salary_amount',
  'amount': 'salary_amount',
  'salarycomponent': 'salary_component',
  'component': 'salary_component',
  'paygrade': 'salary_grade',
  'grade': 'salary_grade',
  'salarygrade': 'salary_grade',
  'payfrequency': 'salary_frequency',
  'frequency': 'salary_frequency',
  'salaryfrequency': 'salary_frequency',
  'currency': 'salary_currency',
  'salarycurrency': 'salary_currency',
  'salarycomments': 'salary_comments',
  'comments': 'salary_comments',
  'directdeposit': 'direct_deposit',
  'accountnumber': 'account_number',
  'accountno': 'account_number',
  'bankaccount': 'account_number',
  'accounttype': 'account_type',
  'routingnumber': 'routing_number',
  'bankcode': 'routing_number',
  'depositamount': 'deposit_amount'
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const template = searchParams.get('template');
    if (!template) {
      return NextResponse.json({ success: false, error: 'Missing parameter. Use ?template=1 to download.' }, { status: 400 });
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employees');
    const headers = [
      'First Name','Middle Name','Last Name','Employee Code','Date of Birth (yyyy-mm-dd)','Gender','Marital Status','Nationality','CNIC Number','CNIC Address','Employment Status','Username','Password','Status (active/disabled)','Role',
      'Address','Street 2','City','State','ZIP Code','Country','Home Phone','Mobile','Work Phone','Work Email','Personal Email',
      'Emergency Contact 1','Emergency 1 Relation','Emergency 1 Phone','Emergency Contact 2','Emergency 2 Relation','Emergency 2 Phone',
      'Salary Component','Pay Grade','Pay Frequency','Currency','Salary Amount','Salary Comments','Direct Deposit (yes/no)','Account Number','Account Type','Routing Number','Deposit Amount'
    ];
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    ws.columns = headers.map(() => ({ width: 22 }));

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="employee-import-template.xlsx"'
      }
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required (.xlsx)' }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    // Convert arrayBuffer to Uint8Array, then to Buffer for Node.js compatibility
    const uint8 = new Uint8Array(arrayBuffer);
    // @ts-ignore: ExcelJS supports Uint8Array at runtime, but types expect Buffer
    await wb.xlsx.load(uint8);
    const ws = wb.worksheets[0];
    if (!ws) return NextResponse.json({ success: false, error: 'No sheet found' }, { status: 400 });

    // Read headers
    const headerToField = new Map<number, string>();
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, col) => {
      const rawHeader = String(cell.value ?? '').trim();
      if (rawHeader) {
        const normalized = normalizeHeader(rawHeader);
        const fieldName = HEADER_MAP[normalized] || rawHeader.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
        headerToField.set(col, fieldName);
      }
    });

    const required = ['first_name','last_name'];
    const results: RowResult[] = [];
    let inserted = 0, skipped = 0, failed = 0;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (row && row.cellCount === 0) continue;
      const rowData: Record<string, any> = {};
      headerToField.forEach((fieldName, colIndex) => {
        const cell = row.getCell(colIndex);
        let value = cell.value;
        if (typeof value === 'object' && value && 'result' in (value as any)) value = (value as any).result;
        rowData[fieldName] = value;
      });

      try {
        const data = {
          first_name: nz(rowData['first_name']),
          middle_name: nz(rowData['middle_name']),
          last_name: nz(rowData['last_name']),
          employee_code: nz(rowData['employee_code']),
          dob: nz(rowData['dob'] || rowData['dateofbirthyyyymmdd']),
          gender: nz(rowData['gender']),
          marital_status: nz(rowData['marital_status']),
          nationality: nz(rowData['nationality']),
          cnic_number: nz(rowData['cnic_number']),
          cnic_address: nz(rowData['cnic_address']),
          employment_status: nz(rowData['employment_status']),
          username: nz(rowData['username']),
          password: nz(rowData['password']),
          status: nz(rowData['status'] || rowData['statusactivedisabled']) || 'disabled',
          role: nz(rowData['role']) || 'Officer'
        };

        // Validate basic
        if (!data.first_name || !data.last_name) {
          skipped++;
          console.warn(`Row ${r} skipped: first_name and last_name required`);
          results.push({ row: r, status: 'skipped', reason: 'first_name and last_name required' });
          continue;
        }

        let conn: any = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const empCode = data.employee_code && String(data.employee_code).trim() !== '' ? data.employee_code : null;
          const [res]: any = await conn.execute(
            `INSERT INTO hrm_employees (first_name, pseudonym, last_name, employee_code, dob, gender, marital_status, nationality, profile_img, username, password, status, role, cnic_number, cnic_address, employment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.first_name, data.middle_name, data.last_name, empCode, data.dob, data.gender, data.marital_status, data.nationality, null, data.username, data.password, data.status, data.role, data.cnic_number, data.cnic_address, data.employment_status]
          );
          const employeeId = res.insertId as number;

          // Contacts
              const street1 = nz(rowData['street1']),
                street2 = nz(rowData['street2']),
                city = nz(rowData['city']),
                state = nz(rowData['state']),
                zip = nz(rowData['zip']),
                country = nz(rowData['country']),
                phone_home = nz(rowData['phone_home']),
                phone_mobile = nz(rowData['phone_mobile']),
                phone_work = nz(rowData['phone_work']),
                email_work = nz(rowData['email_work']),
                email_other = nz(rowData['email_other']);
          const anyContact = street1 || street2 || city || state || zip || country || phone_home || phone_mobile || phone_work || email_work || email_other;
          if (anyContact) {
            await conn.execute(
              `INSERT INTO employee_contacts (employee_id, street1, street2, city, state, zip, country, phone_home, phone_mobile, phone_work, email_work, email_other)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [employeeId, street1, street2, city, state, zip, country, phone_home, phone_mobile, phone_work, email_work, email_other]
            );
          }

          // Emergency contacts (up to 2)
          const e1 = { name: nz(rowData['emergency1_name']), rel: nz(rowData['emergency1_relation']), phone: nz(rowData['emergency1_phone']) };
          const e2 = { name: nz(rowData['emergency2_name']), rel: nz(rowData['emergency2_relation']), phone: nz(rowData['emergency2_phone']) };
          for (const e of [e1, e2]) {
            if (e.name || e.rel || e.phone) {
              await conn.execute(
                `INSERT INTO employee_emergency_contacts (employee_id, contact_name, relationship, phone) VALUES (?, ?, ?, ?)`,
                [employeeId, e.name, e.rel, e.phone]
              );
            }
          }

          // Salary
              const salary_component = nz(rowData['salary_component']),
                salary_grade = nz(rowData['salary_grade']),
                salary_frequency = nz(rowData['salary_frequency']),
                salary_currency = nz(rowData['salary_currency']),
                salary_amount = nz(rowData['salary_amount']),
                salary_comments = nz(rowData['salary_comments']),
                direct_deposit = toBool(rowData['direct_deposit'] || rowData['directdeposityesno']),
                account_number = nz(rowData['account_number']),
                account_type = nz(rowData['account_type']),
                routing_number = nz(rowData['routing_number']),
                deposit_amount = nz(rowData['deposit_amount']);
          if (salary_amount || salary_component) {
            await conn.execute(
              `INSERT INTO employee_salaries (employee_id, component, pay_grade, pay_frequency, currency, amount, comments, direct_deposit, account_number, account_type, routing_number, deposit_amount)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [employeeId, salary_component, salary_grade, salary_frequency, salary_currency, salary_amount, salary_comments, direct_deposit ? 1 : 0, account_number, account_type, routing_number, deposit_amount]
            );
          }

          await conn.commit();
          console.log(`Row ${r} inserted successfully (employee_id=${employeeId})`);
          results.push({ row: r, status: 'inserted', employeeId });
          inserted++;
        } catch (rowErr: any) {
          try { await conn.rollback(); } catch {}
          failed++;
          const reason = rowErr?.sqlMessage || rowErr?.message || String(rowErr);
          console.error(`Row ${r} failed:`, {
            reason,
            code: rowErr?.code,
            errno: rowErr?.errno,
            sqlState: rowErr?.sqlState,
            sqlMessage: rowErr?.sqlMessage,
            stack: rowErr?.stack,
          });
          results.push({ row: r, status: 'failed', reason });
        } finally {
          try { conn.release(); } catch {}
        }
      } catch (err) {
        failed++;
        const reason = (err as any)?.message || String(err);
        console.error(`Row ${r} failed (outer):`, reason);
        results.push({ row: r, status: 'failed', reason });
      }
    }

    return NextResponse.json({ success: true, summary: { inserted, skipped, failed }, results });
  } catch (err) {
    console.error('Employee import crashed:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
