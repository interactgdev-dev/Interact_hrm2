import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const month = formData.get("month") as string; // Format: YYYY-MM

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (!month) {
      return NextResponse.json({ error: "Month parameter is required" }, { status: 400 });
    }

    // Parse year and month
    const [year, monthNumber] = month.split("-").map(Number);

    if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
      return NextResponse.json({ error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
    }

    // Read Excel file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Excel file is empty" }, { status: 400 });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const row of data as any[]) {
        const employeeId = row["Employee ID"];
        const employeeName = row["Employee Name"];

        if (!employeeId) {
          errors.push(`Skipped row: Missing Employee ID`);
          errorCount++;
          continue;
        }

        // Verify employee exists
        const [empCheck]: any = await connection.query(
          "SELECT id FROM hrm_employees WHERE id = ?",
          [employeeId]
        );

        if (!empCheck || empCheck.length === 0) {
          errors.push(`Employee ID ${employeeId} not found in database`);
          errorCount++;
          continue;
        }

        // Parse values (convert empty strings to 0)
        const train6hAmt = parseFloat(row["6H Train Amt"]) || 0;
        const arrears = parseFloat(row["Arrears"]) || 0;
        const kpiAdd = parseFloat(row["KPI Add"]) || 0;
        const commission = parseFloat(row["Commission"]) || 0;
        const existingClientIncentive = parseFloat(row["Existing Client Incentive"]) || 0;
        const trainerIncentive = parseFloat(row["Trainer Incentive"]) || 0;
        const floorIncentive = parseFloat(row["Floor Incentive"]) || 0;

        // Insert or update commissions data
        await connection.query(
          `INSERT INTO employee_commissions 
           (employee_id, month, year, month_number, train_6h_amt, arrears, kpi_add, commission, 
            existing_client_incentive, trainer_incentive, floor_incentive)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           train_6h_amt = VALUES(train_6h_amt),
           arrears = VALUES(arrears),
           kpi_add = VALUES(kpi_add),
           commission = VALUES(commission),
           existing_client_incentive = VALUES(existing_client_incentive),
           trainer_incentive = VALUES(trainer_incentive),
           floor_incentive = VALUES(floor_incentive),
           updated_at = CURRENT_TIMESTAMP`,
          [
            employeeId,
            month,
            year,
            monthNumber,
            train6hAmt,
            arrears,
            kpiAdd,
            commission,
            existingClientIncentive,
            trainerIncentive,
            floorIncentive,
          ]
        );

        successCount++;
      }

      await connection.commit();

      return NextResponse.json({
        success: true,
        message: `Successfully processed ${successCount} records`,
        successCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error uploading commissions:", error);
    return NextResponse.json({ error: "Failed to upload commissions data" }, { status: 500 });
  }
}
