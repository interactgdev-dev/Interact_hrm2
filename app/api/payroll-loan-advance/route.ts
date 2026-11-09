import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

function asRows<T>(result: any): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function idKeys(raw: string | number): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const keys = [s];
  if (/^\d+$/.test(s)) {
    const n = String(Number(s));
    if (n !== s) keys.push(n);
  }
  return keys;
}

function putMax(map: Record<string, number>, employeeId: string | number, amount: number) {
  if (!(amount > 0)) return;
  for (const k of idKeys(employeeId)) {
    map[k] = Math.max(map[k] || 0, amount);
  }
}

function putSum(map: Record<string, number>, employeeId: string | number, amount: number) {
  if (!(amount > 0)) return;
  // Add once on canonical key, then mirror to aliases (avoid double-count)
  const keys = idKeys(employeeId);
  if (!keys.length) return;
  const primary = canonicalId(keys[0]);
  map[primary] = (map[primary] || 0) + amount;
  for (const k of keys) {
    if (k !== primary) map[k] = map[primary];
  }
}

function canonicalId(raw: string): string {
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
}

/**
 * GET ?month=YYYY-MM
 * Loan/Advance column = unpaid advance + unpaid loan (sum).
 *
 * Advance sources:
 *  - advance_salary (created_at month) — primary Advance page store
 *  - employee_advances (payroll_month) — history ledger
 *
 * If ledger was marked paid early but loan installment is still unpaid,
 * still include the advance amount so Monthly Payroll shows both.
 */
export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month") || "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, message: "month (YYYY-MM) required" },
        { status: 400 },
      );
    }

    const advanceAmount: Record<string, number> = {};
    const advancePaid: Record<string, boolean> = {};
    const loans: Record<string, number> = {};
    const combined: Record<string, number> = {};
    const breakdown: Record<
      string,
      { advance: number; loan: number; total: number }
    > = {};

    // 1) Legacy advance_salary for this payroll month
    try {
      const [rows]: any = await query(
        `SELECT employee_id, advance_amount
         FROM advance_salary
         WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
         ORDER BY id DESC`,
        [month],
      );
      for (const row of asRows<{ employee_id: string | number; advance_amount: unknown }>(rows)) {
        putMax(advanceAmount, row.employee_id, num(row.advance_amount));
      }
    } catch {
      /* ignore */
    }

    // 2) History ledger by payroll_month
    try {
      const [rows]: any = await query(
        `SELECT employee_id, amount, status
         FROM employee_advances
         WHERE payroll_month = ?`,
        [month],
      );
      for (const row of asRows<{
        employee_id: string | number;
        amount: unknown;
        status?: string;
      }>(rows)) {
        const st = String(row.status || "active").toLowerCase();
        if (st === "cancelled") continue;
        const amt = num(row.amount);
        if (st === "paid") {
          for (const k of idKeys(row.employee_id)) advancePaid[k] = true;
          // Keep amount so we can revive if loan still unpaid
          putMax(advanceAmount, row.employee_id, amt);
          continue;
        }
        putMax(advanceAmount, row.employee_id, amt);
      }
    } catch {
      /* ignore */
    }

    // 3) Unpaid loan installments for this month
    try {
      const [rows]: any = await query(
        `SELECT employee_id, original_amount, payable_this_month, status
         FROM loan_installments
         WHERE month = ?`,
        [month],
      );
      for (const row of asRows<{
        employee_id: string | number;
        original_amount?: unknown;
        payable_this_month?: unknown;
        status?: string;
      }>(rows)) {
        const st = String(row.status || "pending").toLowerCase();
        if (st === "paid") continue;
        const val = num(row.payable_this_month ?? row.original_amount);
        putSum(loans, row.employee_id, val);
      }
    } catch {
      /* ignore */
    }

    // Also unpaid history loan installments (due_month)
    try {
      const [rows]: any = await query(
        `SELECT li.due_month, li.payable_amount, li.paid_amount, li.status, l.employee_id
         FROM employee_loan_installments li
         INNER JOIN employee_loans l ON l.id = li.loan_id
         WHERE li.due_month = ?`,
        [month],
      );
      for (const row of asRows<{
        employee_id: string | number;
        payable_amount?: unknown;
        paid_amount?: unknown;
        status?: string;
      }>(rows)) {
        const st = String(row.status || "pending").toLowerCase();
        if (st === "paid" || st === "stopped") continue;
        const payable = num(row.payable_amount);
        const paid = num(row.paid_amount);
        const due = Math.max(0, payable - paid);
        // Don't double-count if legacy loan_installments already has value
        const existing = Math.max(
          ...idKeys(row.employee_id).map((k) => loans[k] || 0),
          0,
        );
        if (due > 0 && !(existing > 0)) putSum(loans, row.employee_id, due);
      }
    } catch {
      /* ignore */
    }

    const allIds = new Set<string>([
      ...Object.keys(advanceAmount).map(canonicalId),
      ...Object.keys(loans).map(canonicalId),
    ]);

    for (const id of allIds) {
      if (!id) continue;
      const loan = Math.max(
        ...idKeys(id).map((k) => loans[k] || 0),
        0,
      );
      let adv = Math.max(
        ...idKeys(id).map((k) => advanceAmount[k] || 0),
        0,
      );
      const markedPaid = idKeys(id).some((k) => advancePaid[k]);
      // Skip paid advance only when there is no unpaid loan left for the month
      if (markedPaid && !(loan > 0)) {
        adv = 0;
      }
      const total = adv + loan;
      if (total <= 0) continue;
      for (const k of idKeys(id)) {
        combined[k] = total;
      }
      breakdown[id] = { advance: adv, loan, total };
    }

    // Expose per-source maps used by payroll UI (after paid rules applied)
    const advancesOut: Record<string, number> = {};
    const loansOut: Record<string, number> = {};
    for (const [id, b] of Object.entries(breakdown)) {
      for (const k of idKeys(id)) {
        if (b.advance > 0) advancesOut[k] = b.advance;
        if (b.loan > 0) loansOut[k] = b.loan;
      }
    }

    return NextResponse.json({
      success: true,
      month,
      advances: advancesOut,
      loans: loansOut,
      combined,
      breakdown,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
