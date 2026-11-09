import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { syncAdvanceLedger } from "@/lib/employee-financial-history";

function asRows<T>(result: any): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");

    // Map by employee — merge legacy advance_salary + employee_advances ledger
    const byEmp = new Map<
      string,
      {
        employee_id: number | string;
        employee_name?: string;
        pseudonym?: string | null;
        department?: string | null;
        advance_amount: number;
        payroll_month?: string;
        status?: string;
        source?: string;
      }
    >();

    if (month) {
      const [legacyRows]: any = await query(
        `SELECT employee_id, employee_name, pseudonym, department, advance_amount, created_at
         FROM advance_salary
         WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
            OR DATE_FORMAT(updated_at, '%Y-%m') = ?
         ORDER BY created_at DESC, id DESC`,
        [month, month],
      );
      for (const row of asRows<any>(legacyRows)) {
        const key = String(row.employee_id);
        if (!key || byEmp.has(key)) continue;
        byEmp.set(key, {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          pseudonym: row.pseudonym,
          department: row.department,
          advance_amount: Number(row.advance_amount) || 0,
          payroll_month: month,
          status: "active",
          source: "advance_salary",
        });
      }

      try {
        const [ledgerRows]: any = await query(
          `SELECT employee_id, amount, payroll_month, status
           FROM employee_advances
           WHERE payroll_month = ?
             AND LOWER(COALESCE(status, 'active')) NOT IN ('cancelled')
           ORDER BY id DESC`,
          [month],
        );
        for (const row of asRows<any>(ledgerRows)) {
          const key = String(row.employee_id);
          const amount = Number(row.amount) || 0;
          const status = String(row.status || "active").toLowerCase();
          const existing = byEmp.get(key);
          if (!existing) {
            byEmp.set(key, {
              employee_id: row.employee_id,
              advance_amount: amount,
              payroll_month: month,
              status,
              source: "employee_advances",
            });
            continue;
          }
          // Keep paid flag from ledger; amount = max so we don't lose the value
          existing.advance_amount = Math.max(existing.advance_amount, amount);
          existing.status = status;
          existing.source = "merged";
        }
      } catch {
        /* ledger table may not exist yet */
      }
    } else {
      const [rows]: any = await query(
        `SELECT * FROM advance_salary ORDER BY created_at DESC, id DESC`,
      );
      for (const row of asRows<any>(rows)) {
        const key = String(row.employee_id);
        if (!key || byEmp.has(key)) continue;
        byEmp.set(key, {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          pseudonym: row.pseudonym,
          department: row.department,
          advance_amount: Number(row.advance_amount) || 0,
          status: "active",
          source: "advance_salary",
        });
      }
    }

    const records = Array.from(byEmp.values());
    return NextResponse.json({ success: true, records });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 },
    );
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
        [employee_id, month],
      );
      await syncAdvanceLedger({
        employeeId: employee_id,
        payrollMonth: month,
        amount: null,
        clear: true,
      });
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
      [employee_id, month],
    );

    if (existingRows && existingRows.length > 0) {
      const rowId = existingRows[0].id;
      await query(
        `UPDATE advance_salary
         SET employee_name = ?, pseudonym = ?, department = ?, advance_amount = ?, updated_at = NOW()
         WHERE id = ?`,
        [employee_name, pseudonym || null, department, amountNum, rowId],
      );
      await query(
        `DELETE FROM advance_salary
         WHERE employee_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ? AND id <> ?`,
        [employee_id, month, rowId],
      );
      await syncAdvanceLedger({
        employeeId: employee_id,
        payrollMonth: month,
        amount: amountNum,
      });
      return NextResponse.json({
        success: true,
        message: "Advance salary record updated successfully",
        id: rowId,
      });
    }

    const createdAt = `${month}-01 12:00:00`;
    const [result]: any = await query(
      `INSERT INTO advance_salary (employee_id, employee_name, pseudonym, department, advance_amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [employee_id, employee_name, pseudonym || null, department, amountNum, createdAt],
    );

    await syncAdvanceLedger({
      employeeId: employee_id,
      payrollMonth: month,
      amount: amountNum,
    });
    return NextResponse.json({
      success: true,
      message: "Advance salary record added successfully",
      id: result.insertId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_id, month } = body;
    if (!employee_id) {
      return NextResponse.json({ success: false, message: "Missing required fields." }, { status: 400 });
    }
    if (month) {
      await query(
        `DELETE FROM advance_salary WHERE employee_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
        [employee_id, month],
      );
      await syncAdvanceLedger({
        employeeId: employee_id,
        payrollMonth: month,
        amount: null,
        clear: true,
      });
    } else {
      await query(`DELETE FROM advance_salary WHERE employee_id = ?`, [employee_id]);
      try {
        await query(`DELETE FROM employee_advances WHERE employee_id = ?`, [employee_id]);
      } catch {
        /* migration may not be applied yet */
      }
    }
    return NextResponse.json({ success: true, message: "Advance salary record removed." });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
