import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get("month"); // Format: YYYY-MM

    if (!month) {
      return NextResponse.json({ error: "Month parameter is required" }, { status: 400 });
    }

    const connection = await pool.getConnection();

    try {
      const [commissions]: any = await connection.query(
        `SELECT 
          ec.employee_id,
          ec.month,
          ec.train_6h_amt,
          ec.arrears,
          ec.kpi_add,
          ec.commission,
          ec.existing_client_incentive,
          ec.trainer_incentive,
          ec.floor_incentive,
          CONCAT(e.first_name, ' ', e.last_name) as employee_name
         FROM employee_commissions ec
         LEFT JOIN hrm_employees e ON ec.employee_id = e.id
         WHERE ec.month = ?
         ORDER BY ec.employee_id ASC`,
        [month]
      );

      return NextResponse.json({
        success: true,
        data: commissions || [],
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error fetching commissions:", error);
    return NextResponse.json({ error: "Failed to fetch commissions data" }, { status: 500 });
  }
}
