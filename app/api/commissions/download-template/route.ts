import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get("month"); // Format: YYYY-MM

    if (!month) {
      return NextResponse.json({ error: "Month parameter is required" }, { status: 400 });
    }

    const connection = await pool.getConnection();

    try {
      // Fetch all active employees
      const [employees]: any = await connection.query(
        `SELECT id, CONCAT(first_name, ' ', last_name) as name 
         FROM hrm_employees 
         WHERE employment_status IN ('Permanent', 'Contract', 'Probation')
         ORDER BY id ASC`
      );

      if (!employees || employees.length === 0) {
        return NextResponse.json({ error: "No employees found" }, { status: 404 });
      }

      // Create Excel data
      const excelData = employees.map((emp: any) => ({
        "Employee ID": emp.id,
        "Employee Name": emp.name,
        "6H Train Amt": "",
        "Arrears": "",
        "KPI Add": "",
        "Commission": "",
        "Existing Client Incentive": "",
        "Trainer Incentive": "",
        "Floor Incentive": "",
      }));

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      // Set column widths
      ws["!cols"] = [
        { wch: 12 }, // Employee ID
        { wch: 25 }, // Employee Name
        { wch: 15 }, // 6H Train Amt
        { wch: 15 }, // Arrears
        { wch: 12 }, // KPI Add
        { wch: 15 }, // Commission
        { wch: 28 }, // Existing Client Incentive
        { wch: 20 }, // Trainer Incentive
        { wch: 18 }, // Floor Incentive
      ];

      XLSX.utils.book_append_sheet(wb, ws, "Commissions");

      // Generate buffer
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      // Return as downloadable file
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="Commissions_Template_${month}.xlsx"`,
        },
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error generating template:", error);
    return NextResponse.json({ error: "Failed to generate template" }, { status: 500 });
  }
}
