import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// GET: Fetch all loan installments (includes payable_this_month)
export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month");
    const [rows]: any = await pool.query(`
      SELECT employee_id, month, original_amount, paid_amount,
             COALESCE(payable_this_month, original_amount) AS payable_this_month,
             status, CONCAT(employee_id, '-', month) AS loan_key,
             created_at, updated_at
      FROM loan_installments
      ${month ? "WHERE month = ?" : ""}
      ORDER BY employee_id, month
    `, month ? [month] : []);
    return NextResponse.json({ success: true, records: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

// POST: Add new loan with installments
export async function POST(req: NextRequest) {
  try {
    const { employee_id, loan_amount, installments, start_month } = await req.json();
    if (!employee_id || !loan_amount || !installments || !start_month) {
      return NextResponse.json(
        { success: false, error: "employee_id, loan_amount, installments, start_month required" },
        { status: 400 }
      );
    }
    const amount = parseFloat(loan_amount);
    const numInstallments = parseInt(installments, 10);
    if (isNaN(amount) || amount <= 0 || isNaN(numInstallments) || numInstallments < 1) {
      return NextResponse.json(
        { success: false, error: "Invalid loan_amount or installments" },
        { status: 400 }
      );
    }
    const perMonth = Math.round((amount / numInstallments) * 100) / 100;
    const [y, m] = start_month.split("-").map(Number);
    const inserted: number[] = [];
    for (let i = 0; i < numInstallments; i++) {
      const d = new Date(y, m - 1 + i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const [result]: any = await pool.query(
        `INSERT INTO loan_installments 
         (employee_id, month, original_amount, paid_amount, payable_this_month, status, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 'pending', NOW(), NOW())`,
        [employee_id, month, perMonth, perMonth]
      );
      if (result?.insertId) inserted.push(result.insertId);
    }
    return NextResponse.json({ success: true, ids: inserted });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

// PATCH: Update payable_this_month and/or status
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_id, month, payable_this_month, status, adjust_remaining } = body;
    if (!employee_id || !month) {
      return NextResponse.json(
        { success: false, error: "employee_id and month required" },
        { status: 400 }
      );
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Read current row first to calculate diff for auto-adjust.
      const [currentRows]: any = await conn.query(
        `SELECT employee_id, month, original_amount,
                COALESCE(payable_this_month, original_amount) AS payable_this_month,
                status
         FROM loan_installments
         WHERE employee_id = ? AND month = ?
         LIMIT 1`,
        [employee_id, month]
      );
      const current = Array.isArray(currentRows) && currentRows.length > 0 ? currentRows[0] : null;
      if (!current) {
        await conn.rollback();
        return NextResponse.json(
          { success: false, error: "Loan installment row not found" },
          { status: 404 }
        );
      }

      const updates: string[] = [];
      const params: any[] = [];

      let newPayable: number | null = null;
      if (payable_this_month != null) {
        const val = parseFloat(payable_this_month);
        if (!isNaN(val) && val >= 0) {
          newPayable = val;
          updates.push("payable_this_month = ?");
          params.push(val);
        }
      }

      if (status && ["paid", "pending", "stop"].includes(status)) {
        updates.push("status = ?");
        params.push(status);
        // Auto-fill paid_amount from status
        if (status === "paid") {
          updates.push("paid_amount = ?");
          params.push(newPayable ?? Number(current.payable_this_month ?? current.original_amount ?? 0));
        } else if (status === "pending" || status === "stop") {
          updates.push("paid_amount = 0");
        }
      }

      if (updates.length === 0) {
        await conn.rollback();
        return NextResponse.json(
          { success: false, error: "payable_this_month or status required" },
          { status: 400 }
        );
      }

      params.push(employee_id, month);
      await conn.query(
        `UPDATE loan_installments SET ${updates.join(", ")}, updated_at = NOW() WHERE employee_id = ? AND month = ?`,
        params
      );

      // Auto-adjust remaining months: total loan must stay constant.
      // Example: 500 total, 2 installments (250 each). Month1=150 → Month2=350.
      if (adjust_remaining && newPayable != null) {
        const [allRows]: any = await conn.query(
          `SELECT month, original_amount, paid_amount, status,
                  COALESCE(payable_this_month, original_amount) AS payable_this_month
           FROM loan_installments
           WHERE employee_id = ?
           ORDER BY month ASC`,
          [employee_id]
        );
        if (Array.isArray(allRows) && allRows.length > 0) {
          // Find consecutive block containing current month (same loan)
          const months = allRows.map((r: any) => r.month);
          const idx = months.indexOf(month);
          if (idx >= 0) {
            let start = idx;
            let end = idx;
            while (start > 0 && months[start - 1] === prevMonth(months[start])) start--;
            while (end < months.length - 1 && months[end + 1] === nextMonth(months[end])) end++;
            const block = allRows.slice(start, end + 1);
            const totalLoan = block.reduce((s: number, r: any) => s + Number(r.original_amount ?? 0), 0);
            const round2 = (n: number) => Math.round(n * 100) / 100;

            // Allocated = months <= current (current gets new value, others: paid use paid_amount else payable)
            let allocated = 0;
            for (let i = 0; i <= idx; i++) {
              const r = block[i];
              const amt = i === idx
                ? newPayable
                : (String(r.status || "").toLowerCase() === "paid"
                  ? Number(r.paid_amount ?? 0)
                  : Number(r.payable_this_month ?? r.original_amount ?? 0));
              allocated += amt;
            }
            const remaining = round2(Math.max(0, totalLoan - allocated));
            const futureRows = block.filter((_: any, i: number) => i > idx && String(block[i].status || "").toLowerCase() === "pending");
            const count = futureRows.length;

            if (count > 0 && remaining >= 0) {
              const perMonth = round2(remaining / count);
              let applied = 0;
              for (let i = 0; i < futureRows.length; i++) {
                const r = futureRows[i];
                const val = i === futureRows.length - 1 ? round2(remaining - applied) : perMonth;
                applied = round2(applied + val);
                await conn.query(
                  `UPDATE loan_installments SET payable_this_month = ?, updated_at = NOW() WHERE employee_id = ? AND month = ?`,
                  [Math.max(0, val), employee_id, r.month]
                );
              }
            }
          }
        }
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

// DELETE: Remove loan installment record
export async function DELETE(req: NextRequest) {
  try {
    const { employee_id, month } = await req.json();
    if (!employee_id || !month) {
      return NextResponse.json(
        { success: false, error: "employee_id and month required" },
        { status: 400 }
      );
    }
    await pool.query(
      `DELETE FROM loan_installments WHERE employee_id = ? AND month = ?`,
      [employee_id, month]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
