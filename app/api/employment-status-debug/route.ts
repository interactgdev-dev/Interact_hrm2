import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";

export async function GET(_req: NextRequest) {
	let conn;
	try {
		conn = await pool.getConnection();

		const [summaryRows] = await conn.execute(
			`SELECT
				 SUM(CASE WHEN LOWER(TRIM(COALESCE(employment_status, ''))) = 'probation' THEN 1 ELSE 0 END) AS probation_count,
				 SUM(CASE WHEN LOWER(TRIM(COALESCE(employment_status, ''))) = 'permanent' THEN 1 ELSE 0 END) AS permanent_count,
				 COUNT(*) AS total_count
			 FROM hrm_employees`
		);

		const [sampleRows] = await conn.execute(
			`SELECT
				 CAST(e.id AS CHAR) AS employee_id,
				 e.employee_code,
				 e.first_name,
				 e.last_name,
				 e.employment_status AS employee_status,
				 j.employment_status AS job_status,
				 j.joined_date,
				 DATEDIFF(CURDATE(), j.joined_date) AS days_since_joining
			 FROM hrm_employees e
			 LEFT JOIN employee_jobs j ON e.id = j.employee_id
			 ORDER BY e.id DESC
			 LIMIT 20`
		);

		const summary = (summaryRows as any[])[0] || {};

		return NextResponse.json({
			success: true,
			server_date: new Date().toISOString(),
			summary: {
				total_count: Number(summary.total_count || 0),
				probation_count: Number(summary.probation_count || 0),
				permanent_count: Number(summary.permanent_count || 0),
			},
			sample: (sampleRows as any[]).map((row) => ({
				employee_id: String(row.employee_id),
				employee_code: row.employee_code || null,
				employee_name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
				employee_status: row.employee_status || null,
				job_status: row.job_status || null,
				joined_date: row.joined_date ? String(row.joined_date).slice(0, 10) : null,
				days_since_joining: row.joined_date
					? Number(row.days_since_joining || 0)
					: null,
			})),
		});
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		console.error("employment-status-debug GET error:", error);
		return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
	} finally {
		if (conn) conn.release();
	}
}
