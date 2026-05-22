import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

export async function GET(req: NextRequest) {
	const { searchParams } = new URL(req.url);
	const fromDate = searchParams.get('fromDate');
	const toDate = searchParams.get('toDate');
	if (!fromDate || !toDate) {
		return NextResponse.json({ success: false, error: 'fromDate and toDate required' }, { status: 400 });
	}

	try {
		// Fetch all attendance records for the date range
		const [rows]: any = await pool.query(`
			SELECT ea.*, 
				CONCAT(e.first_name, ' ', e.last_name) as employee_name,
				e.pseudonym AS pseudonym,
				d.name AS department_name
			FROM employee_attendance ea
			LEFT JOIN hrm_employees e ON ea.employee_id = e.id
			LEFT JOIN employee_jobs j ON e.id = j.employee_id
			LEFT JOIN departments d ON j.department_id = d.id
			WHERE DATE(ea.date) BETWEEN ? AND ?
		`, [fromDate, toDate]);

		// Group records by employee_id
		const byEmployee: Record<string, any[]> = {};
		rows.forEach((rec: any) => {
			if (!byEmployee[rec.employee_id]) byEmployee[rec.employee_id] = [];
			byEmployee[rec.employee_id].push(rec);
		});

		// Get all dates in range
		const fromDateObj = new Date(fromDate);
		const toDateObj = new Date(toDate);
		const allDates: string[] = [];
		for (let d = new Date(fromDateObj); d <= toDateObj; d.setDate(d.getDate() + 1)) {
			const dateKey = d.toISOString().slice(0, 10);
			allDates.push(dateKey);
		}

		// For each employee, calculate total deduction (copied from monthly attendance page)
		const result = Object.entries(byEmployee).map(([employee_id, records]) => {
			// Group by date
			const byDate: Record<string, any[]> = {};
			records.forEach((rec: any) => {
				const dateKey = rec.date ? rec.date.toISOString().slice(0, 10) : null;
				if (!dateKey) return;
				if (!byDate[dateKey]) byDate[dateKey] = [];
				byDate[dateKey].push(rec);
			});

			let totalDeduction = 0;
			let hasHalfDay = false;
			allDates.forEach(dateKey => {
				// Weekend skip (0=Sun, 6=Sat)
				const weekday = new Date(dateKey).getDay();
				if (weekday === 0 || weekday === 6) return;
				const dayRecords = byDate[dateKey] || [];
				let dayDeduction = 0;
				if (dayRecords.length === 0) {
					// No record, consider as absent (100%)
					dayDeduction = 100;
				} else {
					// If any record has leave_type 'approved', no deduction
					const approvedLeave = dayRecords.some(r => r.leave_type && r.leave_type.toLowerCase() === 'approved');
					if (approvedLeave) {
						dayDeduction = 0;
					} else {
						// If any record has meta.deduction, use it, else 0
						let metaDeduction = 0;
						if (dayRecords[0]?.deduction !== undefined && dayRecords[0]?.deduction !== null) {
							metaDeduction = parseInt(dayRecords[0].deduction) || 0;
						} else {
							const status = dayRecords[0]?.status?.toLowerCase() || '';
							if (status === 'absent') metaDeduction = 100;
							else if (status === 'half day') metaDeduction = 50;
							else metaDeduction = 0;
						}
						if (metaDeduction === 50) hasHalfDay = true;
						dayDeduction = metaDeduction;
					}
				}
				totalDeduction += dayDeduction;
			});
			let tunpaid_days = totalDeduction / 100;
			// Only show .0 if there is a half day
			if (!hasHalfDay) tunpaid_days = Math.floor(tunpaid_days);
			return {
				employee_id,
				total_deduction: totalDeduction, // e.g. 1150 for 11.5 days
				tunpaid_days,
			};
		});

		return NextResponse.json({ success: true, data: result });
	} catch (err) {
		return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
	}
}
