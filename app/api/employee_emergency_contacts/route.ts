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
			'SELECT * FROM employee_emergency_contacts WHERE employee_id = ? ORDER BY id LIMIT 2',
			[employeeId]
		);
		return NextResponse.json({ success: true, contacts: rows });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function PUT(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, contacts } = body;
		if (!employee_id || !Array.isArray(contacts)) {
			return NextResponse.json({ success: false, error: 'employee_id and contacts[] required' }, { status: 400 });
		}
		// Delete old contacts
		await pool.execute('DELETE FROM employee_emergency_contacts WHERE employee_id = ?', [employee_id]);
		// Insert new contacts
		for (const contact of contacts) {
			const { contact_name, relationship, phone } = contact;
			await pool.execute(
				`INSERT INTO employee_emergency_contacts (employee_id, contact_name, relationship, phone) VALUES (?, ?, ?, ?)` ,
				[employee_id, contact_name, relationship, phone]
			);
		}
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, contacts } = body;
		// contacts: array of { contact_name, relationship, phone }
		if (!employee_id || !Array.isArray(contacts)) {
			return NextResponse.json({ success: false, error: 'employee_id and contacts[] required' }, { status: 400 });
		}
		for (const contact of contacts) {
			const { contact_name, relationship, phone } = contact;
			await pool.execute(
				`INSERT INTO employee_emergency_contacts (employee_id, contact_name, relationship, phone) VALUES (?, ?, ?, ?)` ,
				[employee_id, contact_name, relationship, phone]
			);
		}
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}
