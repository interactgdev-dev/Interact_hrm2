import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// POST: Save loan records
export async function POST(req: NextRequest) {
  try {
    const { employee_id, month, advance_amount } = await req.json();
    if (!employee_id || !month || advance_amount == null) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }
    // Insert or update loan record
    await query(
      `INSERT INTO loan_records (employee_id, month, advance_amount)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE advance_amount = VALUES(advance_amount)`,
      [employee_id, month, advance_amount]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message || "DB error" }, { status: 500 });
  }
}

// GET: Fetch loan records for a month
export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month");
    if (!month) {
      return NextResponse.json({ success: false, error: "Month required" }, { status: 400 });
    }
    const records = await query(
      `SELECT employee_id, advance_amount FROM loan_records WHERE month = ?`,
      [month]
    );
    return NextResponse.json({ success: true, records });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message || "DB error" }, { status: 500 });
  }
}

// DELETE: Remove loan record
export async function DELETE(req: NextRequest) {
  try {
    const { employee_id, month } = await req.json();
    if (!employee_id || !month) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }
    await query(
      `DELETE FROM loan_records WHERE employee_id = ? AND month = ?`,
      [employee_id, month]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message || "DB error" }, { status: 500 });
  }
}
