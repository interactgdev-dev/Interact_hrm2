import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");
    let queryStr = "SELECT * FROM advance_salary";
    const params: any[] = [];
    if (month) {
      // Filter by month (YYYY-MM)
      queryStr += " WHERE DATE_FORMAT(created_at, '%Y-%m') = ?";
      params.push(month);
    }
    queryStr += " ORDER BY created_at DESC, id DESC";

    const [rows]: any = await query(queryStr, params);
    return NextResponse.json({ success: true, records: rows || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_id, employee_name, pseudonym, department, advance_amount, month } = body;

    // Do not treat 0 / blank amount as "missing" — blank means clear for that month.
    if (!employee_id || !employee_name || !department || !month) {
      return NextResponse.json({ success: false, message: "Missing required fields." }, { status: 400 });
    }

    const isBlank =
      advance_amount === "" ||
      advance_amount === null ||
      advance_amount === undefined;

    if (isBlank) {
      await query(
        `DELETE FROM advance_salary WHERE employee_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
        [employee_id, month]
      );
      return NextResponse.json({ success: true, message: "Advance salary cleared." });
    }

    const amountNum = Number(advance_amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return NextResponse.json({ success: false, message: "Invalid advance amount." }, { status: 400 });
    }

    const [existingRows]: any = await query(
      `SELECT id FROM advance_salary
       WHERE employee_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [employee_id, month]
    );

    if (existingRows && existingRows.length > 0) {
      const rowId = existingRows[0].id;
      await query(
        `UPDATE advance_salary
         SET employee_name = ?, pseudonym = ?, department = ?, advance_amount = ?, updated_at = NOW()
         WHERE id = ?`,
        [employee_name, pseudonym || null, department, amountNum, rowId]
      );
      // Keep a single row per employee+month
      await query(
        `DELETE FROM advance_salary
         WHERE employee_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ? AND id <> ?`,
        [employee_id, month, rowId]
      );
      return NextResponse.json({
        success: true,
        message: "Advance salary record updated successfully",
        id: rowId,
      });
    }

    // Stamp created_at inside the selected month so GET month filter finds it
    const createdAt = `${month}-01 12:00:00`;
    const [result]: any = await query(
      `INSERT INTO advance_salary (employee_id, employee_name, pseudonym, department, advance_amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [employee_id, employee_name, pseudonym || null, department, amountNum, createdAt]
    );

    return NextResponse.json({
      success: true,
      message: "Advance salary record added successfully",
      id: result.insertId,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_id, month } = body;
    if (!employee_id) {
      return NextResponse.json({ success: false, message: "Missing required fields." }, { status: 400 });
    }
    // Remove advance salary record for employee (for selected month if provided)
    if (month) {
      await query(
        `DELETE FROM advance_salary WHERE employee_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
        [employee_id, month]
      );
    } else {
      await query(
        `DELETE FROM advance_salary WHERE employee_id = ?`,
        [employee_id]
      );
    }
    return NextResponse.json({ success: true, message: "Advance salary record removed." });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message || "Internal server error" }, { status: 500 });
  }
}
