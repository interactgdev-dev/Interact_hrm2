import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

export async function GET(req: NextRequest) {
	try {
		const { searchParams } = new URL(req.url);
		const employeeId = searchParams.get('employeeId');
		if (!employeeId) {
			return NextResponse.json({ success: false, error: 'employeeId is required' }, { status: 400 });
		}
		const [rows]: any = await pool.execute(
			'SELECT * FROM employee_jobs WHERE employee_id = ?',
			[employeeId]
		);
		console.log('GET employee_jobs - Employee ID:', employeeId);
		console.log('GET employee_jobs - DB Result:', rows[0]);
		if (rows && rows.length > 0) {
			console.log('GET employee_jobs - Returning department_id:', rows[0]?.department_id);
			return NextResponse.json({ success: true, job: rows[0] });
		} else {
			return NextResponse.json({ success: false, error: 'Job not found' });
		}
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function PUT(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, joinedDate, jobTitle, jobSpecification, jobCategory, subUnit, location, employmentStatus, includeContract, departmentId } = body;
		console.log('PUT employee_jobs - Received body:', body);
		console.log('PUT employee_jobs - Department ID received:', departmentId);
		console.log('PUT employee_jobs - Department ID type:', typeof departmentId);
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		
		// Check if record exists
		const [existing]: any = await pool.execute(
			'SELECT * FROM employee_jobs WHERE employee_id = ?',
			[employee_id]
		);
		
		if (existing && existing.length > 0) {
			// Record exists, UPDATE
			await pool.execute(
				`UPDATE employee_jobs SET joined_date = ?, job_title = ?, job_specification = ?, job_category = ?, sub_unit = ?, location = ?, employment_status = ?, include_contract = ?, department_id = ?
				 WHERE employee_id = ?` ,
				[joinedDate || null, jobTitle, jobSpecification, jobCategory, subUnit, location, employmentStatus, includeContract ? 1 : 0, departmentId || null, employee_id]
			);
			console.log('PUT employee_jobs - Successfully UPDATED employee_id:', employee_id, 'with department_id:', departmentId || null);
			
			// Also sync employment_status back to hrm_employees table
			if (employmentStatus) {
				try {
					await pool.execute(
						`UPDATE hrm_employees SET employment_status = ? WHERE id = ?`,
						[employmentStatus, employee_id]
					);
					console.log('PUT employee_jobs - Also synced employment_status to hrm_employees');
				} catch (syncErr) {
					console.log('PUT employee_jobs - Note: Could not sync to hrm_employees:', syncErr);
				}
			}
		} else {
			// Record doesn't exist, INSERT
			await pool.execute(
				`INSERT INTO employee_jobs (employee_id, joined_date, job_title, job_specification, job_category, sub_unit, location, employment_status, include_contract, department_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
				[employee_id, joinedDate || null, jobTitle, jobSpecification, jobCategory, subUnit, location, employmentStatus, includeContract ? 1 : 0, departmentId || null]
			);
			console.log('PUT employee_jobs - Successfully INSERTED employee_id:', employee_id, 'with department_id:', departmentId || null);
		}
		
		return NextResponse.json({ success: true });
	} catch (err) {
		console.error('PUT employee_jobs - Error:', err);
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, joinedDate, jobTitle, jobSpecification, jobCategory, subUnit, location, employmentStatus, includeContract, departmentId } = body;
		console.log('POST employee_jobs - Received body:', body);
		console.log('POST employee_jobs - Department ID received:', departmentId);
		console.log('POST employee_jobs - Department ID after null check:', departmentId || null);
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		await pool.execute(
			`INSERT INTO employee_jobs (employee_id, joined_date, job_title, job_specification, job_category, sub_unit, location, employment_status, include_contract, department_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
			[employee_id, joinedDate || null, jobTitle, jobSpecification, jobCategory, subUnit, location, employmentStatus, includeContract ? 1 : 0, departmentId || null]
		);
		console.log('POST employee_jobs - Successfully inserted employee_id:', employee_id, 'with department_id:', departmentId || null);
		
		// Also sync employment_status to hrm_employees table
		if (employmentStatus) {
			try {
				await pool.execute(
					`UPDATE hrm_employees SET employment_status = ? WHERE id = ?`,
					[employmentStatus, employee_id]
				);
				console.log('POST employee_jobs - Also synced employment_status to hrm_employees');
			} catch (syncErr) {
				console.log('POST employee_jobs - Note: Could not sync to hrm_employees:', syncErr);
			}
		}
		
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}
