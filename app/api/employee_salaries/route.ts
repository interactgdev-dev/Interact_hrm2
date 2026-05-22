// GET /api/employee_salaries/all - return all employee salaries
export async function GET_ALL(req: NextRequest) {
	try {
		const [rows]: any = await pool.execute('SELECT employee_id, amount FROM employee_salaries');
		return NextResponse.json({ success: true, salaries: rows });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}
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
			'SELECT * FROM employee_salaries WHERE employee_id = ?',
			[employeeId]
		);
		if (rows && rows.length > 0) {
			return NextResponse.json({ success: true, salary: rows[0] });
		} else {
			return NextResponse.json({ success: false, error: 'Salary not found' });
		}
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function PUT(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, component, payGrade, payFrequency, currency, amount, comments, directDeposit, accountNumber, accountType, routingNumber, depositAmount } = body;
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		await pool.execute(
			`UPDATE employee_salaries SET component = ?, pay_grade = ?, pay_frequency = ?, currency = ?, amount = ?, comments = ?, direct_deposit = ?, account_number = ?, account_type = ?, routing_number = ?, deposit_amount = ?
			 WHERE employee_id = ?` ,
			[component, payGrade, payFrequency, currency, amount, comments, directDeposit ? 1 : 0, accountNumber, accountType, routingNumber, depositAmount, employee_id]
		);
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	try {
		const body = await req.json();
		const { employee_id, component, payGrade, payFrequency, currency, amount, comments, directDeposit, accountNumber, accountType, routingNumber, depositAmount } = body;
		if (!employee_id) {
			return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
		}
		await pool.execute(
			`INSERT INTO employee_salaries (employee_id, component, pay_grade, pay_frequency, currency, amount, comments, direct_deposit, account_number, account_type, routing_number, deposit_amount)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
			[employee_id, component, payGrade, payFrequency, currency, amount, comments, directDeposit ? 1 : 0, accountNumber, accountType, routingNumber, depositAmount]
		);
		return NextResponse.json({ success: true });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}
