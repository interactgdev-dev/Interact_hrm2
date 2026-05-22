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
			'SELECT * FROM employee_contacts WHERE employee_id = ?',
			[employeeId]
		);
		if (rows && rows.length > 0) {
			return NextResponse.json({ success: true, contact: rows[0] });
		} else {
			return NextResponse.json({ success: false, error: 'Contact not found' });
		}
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function PUT(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, street1, street2, city, state, zip, country, phone_home, phone_mobile, phone_work, email_work, email_other } = body;
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		await pool.execute(
			`UPDATE employee_contacts SET street1 = ?, street2 = ?, city = ?, state = ?, zip = ?, country = ?, phone_home = ?, phone_mobile = ?, phone_work = ?, email_work = ?, email_other = ?
			 WHERE employee_id = ?` ,
			[street1, street2, city, state, zip, country, phone_home, phone_mobile, phone_work, email_work, email_other, employee_id]
		);
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, street1, street2, city, state, zip, country, phone_home, phone_mobile, phone_work, email_work, email_other } = body;
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		const [result] = await pool.execute(
			`INSERT INTO employee_contacts (employee_id, street1, street2, city, state, zip, country, phone_home, phone_mobile, phone_work, email_work, email_other)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
			[employee_id, street1, street2, city, state, zip, country, phone_home, phone_mobile, phone_work, email_work, email_other]
		);
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}
