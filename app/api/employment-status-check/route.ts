import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";

export async function GET(_req: NextRequest) {
	let conn;
	try {
		conn = await pool.getConnection();
		const [rows] = await conn.execute(
			`SELECT
				 CAST(e.id AS CHAR) AS employee_id,
				 e.employee_code,
				 e.first_name,
				 e.last_name,
				 e.employment_status,
				 j.joined_date,
				 DATEDIFF(CURDATE(), j.joined_date) AS days_since_joining,
				 CASE
					 WHEN j.joined_date IS NOT NULL
								AND DATE_ADD(j.joined_date, INTERVAL 3 MONTH) <= CURDATE()
					 THEN 1 ELSE 0
				 END AS eligible_for_permanent
			 FROM hrm_employees e
			 LEFT JOIN employee_jobs j ON e.id = j.employee_id
			 WHERE LOWER(TRIM(COALESCE(e.employment_status, ''))) = 'probation'
			 ORDER BY j.joined_date ASC, e.id ASC`
		);

		const employees = (rows as any[]).map((row) => ({
			employee_id: String(row.employee_id),
			employee_code: row.employee_code || null,
			employee_name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
			employment_status: row.employment_status || "",
			joined_date: row.joined_date ? String(row.joined_date).slice(0, 10) : null,
			days_since_joining: row.joined_date
				? Number(row.days_since_joining || 0)
				: null,
			eligible_for_permanent: Number(row.eligible_for_permanent || 0) === 1,
		}));

		const eligible_count = employees.filter(
			(employee) => employee.eligible_for_permanent
		).length;

		return NextResponse.json({
			success: true,
			total_probation_employees: employees.length,
			eligible_count,
			employees,
		});
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		console.error("employment-status-check GET error:", error);
		return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
	} finally {
		if (conn) conn.release();
	}
}
