import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

type ContactBody = {
	employee_id?: string | number;
	street1?: string | null;
	street2?: string | null;
	city?: string | null;
	state?: string | null;
	zip?: string | null;
	country?: string | null;
	permanent_street?: string | null;
	permanent_city?: string | null;
	permanent_state?: string | null;
	permanent_zip?: string | null;
	permanent_country?: string | null;
	phone_home?: string | null;
	phone_mobile?: string | null;
	phone_work?: string | null;
	email_work?: string | null;
	email_other?: string | null;
};

function contactValues(body: ContactBody) {
	return [
		body.street1 ?? null,
		body.street2 ?? null,
		body.city ?? null,
		body.state ?? null,
		body.zip ?? null,
		body.country ?? null,
		body.permanent_street ?? null,
		body.permanent_city ?? null,
		body.permanent_state ?? null,
		body.permanent_zip ?? null,
		body.permanent_country ?? null,
		body.phone_home ?? null,
		body.phone_mobile ?? null,
		body.phone_work ?? null,
		body.email_work ?? null,
		body.email_other ?? null,
	];
}

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
		const body = (await req.json()) as ContactBody;
		const employee_id = body.employee_id;
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		const values = contactValues(body);

		// Edit mode used PUT even when no contact row exists — upsert so save actually persists.
		const [existing]: any = await pool.execute(
			'SELECT id FROM employee_contacts WHERE employee_id = ? LIMIT 1',
			[employee_id]
		);
		if (existing && existing.length > 0) {
			await pool.execute(
				`UPDATE employee_contacts SET
				   street1 = ?, street2 = ?, city = ?, state = ?, zip = ?, country = ?,
				   permanent_street = ?, permanent_city = ?, permanent_state = ?, permanent_zip = ?, permanent_country = ?,
				   phone_home = ?, phone_mobile = ?, phone_work = ?, email_work = ?, email_other = ?
				 WHERE employee_id = ?`,
				[...values, employee_id]
			);
		} else {
			await pool.execute(
				`INSERT INTO employee_contacts (
				   employee_id, street1, street2, city, state, zip, country,
				   permanent_street, permanent_city, permanent_state, permanent_zip, permanent_country,
				   phone_home, phone_mobile, phone_work, email_work, email_other
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[employee_id, ...values]
			);
		}
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as ContactBody;
		const employee_id = body.employee_id;
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		const values = contactValues(body);
		await pool.execute(
			`INSERT INTO employee_contacts (
			   employee_id, street1, street2, city, state, zip, country,
			   permanent_street, permanent_city, permanent_state, permanent_zip, permanent_country,
			   phone_home, phone_mobile, phone_work, email_work, email_other
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[employee_id, ...values]
		);
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}
