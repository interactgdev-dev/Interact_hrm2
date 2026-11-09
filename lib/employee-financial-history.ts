import { query } from "@/lib/db";

export type AdvanceRow = {
  id: number;
  employee_id: number;
  payroll_month: string;
  amount: number;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LoanInstallmentRow = {
  id: number;
  loan_id: number;
  installment_no: number;
  due_month: string;
  original_amount: number;
  payable_amount: number;
  paid_amount: number;
  status: string;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LoanRow = {
  id: number;
  employee_id: number;
  principal: number;
  installment_count: number;
  start_month: string;
  status: string;
  notes: string | null;
  issued_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  installments?: LoanInstallmentRow[];
  remaining_amount?: number;
  paid_total?: number;
};

function asRows<T>(result: any): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nextYm(ym: string): string {
  const [y, m] = String(ym).slice(0, 7).split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function decorateLoan(loan: LoanRow, inst: LoanInstallmentRow[]): LoanRow {
  const paidTotal = inst.reduce((s, r) => s + num(r.paid_amount), 0);
  const remaining = inst.reduce((s, r) => {
    const due = Math.max(0, num(r.payable_amount) - num(r.paid_amount));
    return s + (String(r.status).toLowerCase() === "paid" ? 0 : due);
  }, 0);
  return {
    ...loan,
    principal: num(loan.principal),
    installment_count: num(loan.installment_count) || inst.length,
    installments: inst.map((r) => ({
      ...r,
      original_amount: num(r.original_amount),
      payable_amount: num(r.payable_amount),
      paid_amount: num(r.paid_amount),
    })),
    paid_total: paidTotal,
    remaining_amount: remaining,
  };
}

/** Read legacy loan_installments and group consecutive months into loan masters. */
async function fetchLoansFromLegacy(opts: {
  employeeId?: number;
  year?: string;
}): Promise<LoanRow[]> {
  const where: string[] = ["employee_id IS NOT NULL", "month IS NOT NULL"];
  const params: any[] = [];
  if (opts.employeeId != null) {
    where.push("employee_id = ?");
    params.push(opts.employeeId);
  }
  if (opts.year) {
    where.push("LEFT(month, 4) = ?");
    params.push(opts.year);
  }

  const [raw]: any = await query(
    `SELECT employee_id, month, original_amount, paid_amount,
            COALESCE(payable_this_month, original_amount) AS payable_this_month,
            status, created_at, updated_at
     FROM loan_installments
     WHERE ${where.join(" AND ")}
     ORDER BY employee_id ASC, month ASC, created_at ASC`,
    params,
  );
  const rows = asRows<{
    employee_id: number;
    month: string;
    original_amount: number;
    paid_amount: number;
    payable_this_month: number;
    status: string;
    created_at: string;
    updated_at: string;
  }>(raw);

  const byEmp = new Map<number, typeof rows>();
  for (const row of rows) {
    const id = Number(row.employee_id);
    const list = byEmp.get(id) || [];
    list.push(row);
    byEmp.set(id, list);
  }

  const out: LoanRow[] = [];
  let synthId = -1;
  for (const [employeeId, empRows] of byEmp) {
    const sorted = [...empRows].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const blocks: (typeof sorted)[] = [];
    let current: typeof sorted = [];
    for (const row of sorted) {
      if (current.length === 0) {
        current = [row];
        continue;
      }
      const prev = String(current[current.length - 1].month).slice(0, 7);
      const cur = String(row.month).slice(0, 7);
      if (cur === nextYm(prev)) current.push(row);
      else {
        blocks.push(current);
        current = [row];
      }
    }
    if (current.length) blocks.push(current);

    for (const block of blocks) {
      const loanId = synthId--;
      const startMonth = String(block[0].month).slice(0, 7);
      const principal = block.reduce((s, r) => s + num(r.original_amount), 0);
      const anyPending = block.some(
        (r) => String(r.status || "pending").toLowerCase() === "pending",
      );
      const installments: LoanInstallmentRow[] = block.map((r, i) => {
        const st = String(r.status || "pending").toLowerCase();
        const payable = num(r.payable_this_month ?? r.original_amount);
        return {
          id: loanId * 100 - (i + 1),
          loan_id: loanId,
          installment_no: i + 1,
          due_month: String(r.month).slice(0, 7),
          original_amount: num(r.original_amount),
          payable_amount: payable,
          paid_amount: st === "paid" ? num(r.paid_amount) || payable : num(r.paid_amount),
          status: st || "pending",
          paid_at: st === "paid" ? r.updated_at || r.created_at || null : null,
          notes: "From loan page",
          created_at: r.created_at,
          updated_at: r.updated_at || r.created_at,
        };
      });
      out.push(
        decorateLoan(
          {
            id: loanId,
            employee_id: employeeId,
            principal,
            installment_count: block.length,
            start_month: startMonth,
            status: anyPending ? "active" : "closed",
            notes: "From loan page",
            issued_at: block[0].created_at || null,
            created_by: null,
            created_at: block[0].created_at,
            updated_at: block[block.length - 1].updated_at || block[block.length - 1].created_at,
          },
          installments,
        ),
      );
    }
  }
  return out;
}

async function fetchAdvancesFromLegacy(opts: {
  employeeId?: number;
  year?: string;
  monthFrom?: string;
  monthTo?: string;
}): Promise<AdvanceRow[]> {
  const where: string[] = ["employee_id IS NOT NULL", "advance_amount IS NOT NULL"];
  const params: any[] = [];
  if (opts.employeeId != null) {
    where.push("employee_id = ?");
    params.push(opts.employeeId);
  }
  if (opts.year) {
    where.push("DATE_FORMAT(created_at, '%Y') = ?");
    params.push(opts.year);
  }
  if (opts.monthFrom) {
    where.push("DATE_FORMAT(created_at, '%Y-%m') >= ?");
    params.push(opts.monthFrom);
  }
  if (opts.monthTo) {
    where.push("DATE_FORMAT(created_at, '%Y-%m') <= ?");
    params.push(opts.monthTo);
  }

  const [raw]: any = await query(
    `SELECT id, employee_id, DATE_FORMAT(created_at, '%Y-%m') AS payroll_month,
            advance_amount AS amount, created_at, updated_at
     FROM advance_salary
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, id DESC`,
    params,
  );
  return asRows<{
    id: number;
    employee_id: number;
    payroll_month: string;
    amount: number;
    created_at: string;
    updated_at: string;
  }>(raw).map((r) => ({
    id: Number(r.id),
    employee_id: Number(r.employee_id),
    payroll_month: String(r.payroll_month).slice(0, 7),
    amount: num(r.amount),
    status: "active",
    notes: "From advance page",
    created_by: null,
    created_at: r.created_at,
    updated_at: r.updated_at || r.created_at,
  }));
}

export async function fetchAdvances(opts: {
  employeeId?: number;
  year?: string;
  monthFrom?: string;
  monthTo?: string;
}): Promise<AdvanceRow[]> {
  let ledger: AdvanceRow[] = [];
  try {
    const where: string[] = ["status <> 'cancelled'"];
    const params: any[] = [];

    if (opts.employeeId != null) {
      where.push("employee_id = ?");
      params.push(opts.employeeId);
    }
    if (opts.year) {
      where.push("LEFT(payroll_month, 4) = ?");
      params.push(opts.year);
    }
    if (opts.monthFrom) {
      where.push("payroll_month >= ?");
      params.push(opts.monthFrom);
    }
    if (opts.monthTo) {
      where.push("payroll_month <= ?");
      params.push(opts.monthTo);
    }

    const [result]: any = await query(
      `SELECT id, employee_id, payroll_month, amount, status, notes, created_by, created_at, updated_at
       FROM employee_advances
       WHERE ${where.join(" AND ")}
       ORDER BY payroll_month DESC, id DESC`,
      params,
    );
    ledger = asRows<AdvanceRow>(result).map((a) => ({
      ...a,
      employee_id: Number(a.employee_id),
      amount: num(a.amount),
    }));
  } catch {
    ledger = [];
  }

  // Merge any legacy advances missing from ledger (same employee + month)
  try {
    const legacy = await fetchAdvancesFromLegacy(opts);
    const have = new Set(ledger.map((a) => `${a.employee_id}|${a.payroll_month}`));
    for (const row of legacy) {
      const key = `${row.employee_id}|${row.payroll_month}`;
      if (have.has(key)) continue;
      ledger.push(row);
      have.add(key);
    }
  } catch {
    /* ignore */
  }

  return ledger.sort((a, b) => String(b.payroll_month).localeCompare(String(a.payroll_month)));
}

export async function fetchLoansWithInstallments(opts: {
  employeeId?: number;
  year?: string;
  loanId?: number;
}): Promise<LoanRow[]> {
  let loans: LoanRow[] = [];
  try {
    const where: string[] = ["1=1"];
    const params: any[] = [];

    if (opts.loanId != null) {
      where.push("id = ?");
      params.push(opts.loanId);
    }
    if (opts.employeeId != null) {
      where.push("employee_id = ?");
      params.push(opts.employeeId);
    }
    if (opts.year) {
      where.push(`(
        LEFT(start_month, 4) = ?
        OR id IN (
          SELECT loan_id FROM employee_loan_installments WHERE LEFT(due_month, 4) = ?
        )
      )`);
      params.push(opts.year, opts.year);
    }

    const [loanResult]: any = await query(
      `SELECT id, employee_id, principal, installment_count, start_month, status, notes,
              issued_at, created_by, created_at, updated_at
       FROM employee_loans
       WHERE ${where.join(" AND ")}
       ORDER BY start_month DESC, id DESC`,
      params,
    );
    const base = asRows<LoanRow>(loanResult);
    if (base.length > 0) {
      const ids = base.map((l) => l.id);
      const placeholders = ids.map(() => "?").join(",");
      const [instResult]: any = await query(
        `SELECT id, loan_id, installment_no, due_month, original_amount, payable_amount,
                paid_amount, status, paid_at, notes, created_at, updated_at
         FROM employee_loan_installments
         WHERE loan_id IN (${placeholders})
         ORDER BY loan_id, installment_no ASC`,
        ids,
      );
      const installments = asRows<LoanInstallmentRow>(instResult);
      const byLoan = new Map<number, LoanInstallmentRow[]>();
      for (const row of installments) {
        const list = byLoan.get(row.loan_id) || [];
        list.push(row);
        byLoan.set(row.loan_id, list);
      }
      loans = base.map((loan) => decorateLoan(loan, byLoan.get(loan.id) || []));
    }
  } catch {
    loans = [];
  }

  // Always merge legacy loan page rows so History never shows 0 when Loan page has data
  if (opts.loanId == null) {
    try {
      const legacy = await fetchLoansFromLegacy({
        employeeId: opts.employeeId,
        year: opts.year,
      });
      const legacyPaid = new Map<string, LoanInstallmentRow>();
      for (const leg of legacy) {
        for (const inst of leg.installments || []) {
          const key = `${Number(leg.employee_id)}|${inst.due_month}`;
          if (String(inst.status || "").toLowerCase() === "paid") {
            legacyPaid.set(key, inst);
          }
        }
      }

      // Heal history rows: if Loan page installment is Paid, History must show Paid too
      for (const loan of loans) {
        const insts = loan.installments || [];
        for (const inst of insts) {
          const key = `${Number(loan.employee_id)}|${inst.due_month}`;
          const paidLeg = legacyPaid.get(key);
          if (!paidLeg) continue;
          if (String(inst.status || "").toLowerCase() === "paid") continue;
          inst.status = "paid";
          inst.paid_amount = num(paidLeg.paid_amount) || num(inst.payable_amount) || num(inst.original_amount);
          inst.paid_at = paidLeg.paid_at || inst.paid_at || paidLeg.updated_at || null;
        }
        if (insts.length) {
          const anyPending = insts.some(
            (r) => String(r.status || "pending").toLowerCase() === "pending",
          );
          loan.status = anyPending ? "active" : "closed";
          Object.assign(loan, decorateLoan(loan, insts));
        }
      }

      const covered = new Set<string>();
      for (const loan of loans) {
        for (const inst of loan.installments || []) {
          covered.add(`${Number(loan.employee_id)}|${inst.due_month}`);
        }
      }
      for (const leg of legacy) {
        const months = (leg.installments || []).map((i) => i.due_month);
        if (months.length > 0 && months.every((m) => covered.has(`${Number(leg.employee_id)}|${m}`))) {
          continue;
        }
        loans.push(leg);
      }
    } catch {
      /* ignore */
    }
  }

  return loans;
}

/** Same source as overview cards — keeps table counts in sync. */
export function buildActivitySummaryFromData(advances: AdvanceRow[], loans: LoanRow[]) {
  const map = new Map<
    number,
    {
      employee_id: number;
      advance_count: number;
      advance_total: number;
      loan_count: number;
      loan_principal: number;
    }
  >();

  for (const a of advances) {
    if (String(a.status || "").toLowerCase() === "cancelled") continue;
    const id = Number(a.employee_id);
    if (!Number.isFinite(id)) continue;
    const cur = map.get(id) || {
      employee_id: id,
      advance_count: 0,
      advance_total: 0,
      loan_count: 0,
      loan_principal: 0,
    };
    cur.advance_count += 1;
    cur.advance_total += num(a.amount);
    map.set(id, cur);
  }

  for (const l of loans) {
    const id = Number(l.employee_id);
    if (!Number.isFinite(id)) continue;
    const cur = map.get(id) || {
      employee_id: id,
      advance_count: 0,
      advance_total: 0,
      loan_count: 0,
      loan_principal: 0,
    };
    cur.loan_count += 1;
    cur.loan_principal += num(l.principal);
    map.set(id, cur);
  }

  return Array.from(map.values()).sort((a, b) => a.employee_id - b.employee_id);
}

export function buildYearOverview(advances: AdvanceRow[], loans: LoanRow[], year: string) {
  const advanceActive = advances.filter((a) => String(a.status).toLowerCase() !== "cancelled");
  const advancesTakenCount = advanceActive.length;
  const advancesTakenTotal = advanceActive.reduce((s, a) => s + num(a.amount), 0);

  // Count any loan that starts in year OR has installments in year
  const loansIssued = loans.filter((l) => {
    if (String(l.start_month || "").startsWith(year)) return true;
    return (l.installments || []).some((i) => String(i.due_month || "").startsWith(year));
  });
  const loansTakenCount = loansIssued.length;
  const loansTakenPrincipal = loansIssued.reduce((s, l) => s + num(l.principal), 0);

  let recoveredThisYear = 0;
  let activeRemaining = 0;
  for (const loan of loans) {
    activeRemaining += num(loan.remaining_amount);
    for (const inst of loan.installments || []) {
      if (String(inst.due_month || "").startsWith(year)) {
        recoveredThisYear += num(inst.paid_amount);
      }
    }
  }

  return {
    year,
    advances_taken_count: advancesTakenCount,
    advances_taken_total: advancesTakenTotal,
    loans_taken_count: loansTakenCount,
    loans_taken_principal: loansTakenPrincipal,
    recoveries_this_year: recoveredThisYear,
    active_loan_remaining: activeRemaining,
  };
}

/** Best-effort dual-write so History stays current while old pages still write legacy tables. */
export async function syncAdvanceLedger(opts: {
  employeeId: number | string;
  payrollMonth: string;
  amount: number | null;
  clear?: boolean;
}) {
  try {
    if (opts.clear || opts.amount == null) {
      await query(
        `DELETE FROM employee_advances WHERE employee_id = ? AND payroll_month = ?`,
        [opts.employeeId, opts.payrollMonth],
      );
      return;
    }
    const [existing]: any = await query(
      `SELECT id FROM employee_advances
       WHERE employee_id = ? AND payroll_month = ? AND status <> 'cancelled'
       ORDER BY id DESC LIMIT 1`,
      [opts.employeeId, opts.payrollMonth],
    );
    const rows = asRows<{ id: number }>(existing);
    if (rows.length > 0) {
      // Re-saving amount from Advance page re-opens deduction (active).
      // Do not touch rows already paid unless amount actually changes.
      await query(
        `UPDATE employee_advances
         SET amount = ?,
             status = CASE
               WHEN LOWER(status) = 'paid' AND amount = ? THEN status
               ELSE 'active'
             END,
             updated_at = NOW()
         WHERE id = ?`,
        [opts.amount, opts.amount, rows[0].id],
      );
      await query(
        `DELETE FROM employee_advances
         WHERE employee_id = ? AND payroll_month = ? AND id <> ? AND LOWER(status) <> 'paid'`,
        [opts.employeeId, opts.payrollMonth, rows[0].id],
      );
      return;
    }
    await query(
      `INSERT INTO employee_advances (employee_id, payroll_month, amount, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'Synced from advance page', NOW(), NOW())`,
      [opts.employeeId, opts.payrollMonth, opts.amount],
    );
  } catch {
    // Table may not exist until migration runs; never block legacy save.
  }
}

export async function syncNewLoanFromLegacy(opts: {
  employeeId: number | string;
  principal: number;
  installmentCount: number;
  startMonth: string;
  perMonth: number;
}) {
  try {
    const [result]: any = await query(
      `INSERT INTO employee_loans
         (employee_id, principal, installment_count, start_month, status, notes, issued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'Synced from loan page', NOW(), NOW(), NOW())`,
      [opts.employeeId, opts.principal, opts.installmentCount, opts.startMonth],
    );
    const loanId = result?.insertId;
    if (!loanId) return;

    const [y, m] = opts.startMonth.split("-").map(Number);
    for (let i = 0; i < opts.installmentCount; i++) {
      const d = new Date(y, m - 1 + i, 1);
      const dueMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await query(
        `INSERT INTO employee_loan_installments
           (loan_id, installment_no, due_month, original_amount, payable_amount, paid_amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'pending', NOW(), NOW())`,
        [loanId, i + 1, dueMonth, opts.perMonth, opts.perMonth],
      );
    }
  } catch {
    // ignore until migration applied
  }
}

export async function syncLoanInstallmentFromLegacy(opts: {
  employeeId: number | string;
  month: string;
  payable?: number | null;
  status?: string | null;
  paidAmount?: number | null;
}) {
  try {
    const [rows]: any = await query(
      `SELECT i.id, i.loan_id
       FROM employee_loan_installments i
       INNER JOIN employee_loans l ON l.id = i.loan_id
       WHERE l.employee_id = ? AND i.due_month = ?
       ORDER BY i.id DESC LIMIT 1`,
      [opts.employeeId, opts.month],
    );
    const list = asRows<{ id: number; loan_id: number }>(rows);
    if (list.length === 0) return;

    const updates: string[] = [];
    const params: any[] = [];
    if (opts.payable != null && Number.isFinite(Number(opts.payable))) {
      updates.push("payable_amount = ?");
      params.push(Number(opts.payable));
    }
    if (opts.status) {
      updates.push("status = ?");
      params.push(opts.status);
      if (opts.status === "paid") {
        updates.push("paid_at = NOW()");
        if (opts.paidAmount != null) {
          updates.push("paid_amount = ?");
          params.push(Number(opts.paidAmount));
        }
      } else {
        updates.push("paid_at = NULL");
        updates.push("paid_amount = 0");
      }
    } else if (opts.paidAmount != null) {
      updates.push("paid_amount = ?");
      params.push(Number(opts.paidAmount));
    }
    if (updates.length === 0) return;
    params.push(list[0].id);
    await query(
      `UPDATE employee_loan_installments SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`,
      params,
    );

    // Close loan when no pending installments remain
    const [pending]: any = await query(
      `SELECT COUNT(*) AS c FROM employee_loan_installments
       WHERE loan_id = ? AND LOWER(status) = 'pending'`,
      [list[0].loan_id],
    );
    const pendingCount = num(asRows<{ c: number }>(pending)[0]?.c);
    if (pendingCount === 0) {
      await query(
        `UPDATE employee_loans SET status = 'closed', updated_at = NOW() WHERE id = ?`,
        [list[0].loan_id],
      );
    }
  } catch {
    // ignore
  }
}

/**
 * Pull missing rows from legacy advance_salary / loan_installments into the
 * history tables so Financial History stays complete even if dual-write missed.
 */
export async function reconcileLegacyFinancialHistory(): Promise<void> {
  try {
    // --- Advances ---
    const [legacyAdv]: any = await query(
      `SELECT employee_id, DATE_FORMAT(created_at, '%Y-%m') AS payroll_month,
              advance_amount, created_at, updated_at
       FROM advance_salary
       WHERE employee_id IS NOT NULL AND advance_amount IS NOT NULL
       ORDER BY created_at ASC, id ASC`,
    );
    const advances = asRows<{
      employee_id: number;
      payroll_month: string;
      advance_amount: number;
      created_at: string;
      updated_at: string;
    }>(legacyAdv);

    for (const a of advances) {
      const month = String(a.payroll_month || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const [exists]: any = await query(
        `SELECT id FROM employee_advances
         WHERE employee_id = ? AND payroll_month = ? AND status <> 'cancelled'
         LIMIT 1`,
        [a.employee_id, month],
      );
      if (asRows(exists).length > 0) continue;
      await query(
        `INSERT INTO employee_advances
           (employee_id, payroll_month, amount, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 'Reconciled from advance_salary', ?, ?)`,
        [
          a.employee_id,
          month,
          num(a.advance_amount),
          a.created_at || new Date(),
          a.updated_at || a.created_at || new Date(),
        ],
      );
    }

    // --- Loans: consecutive month blocks per employee ---
    const [legacyLoans]: any = await query(
      `SELECT employee_id, month, original_amount, paid_amount,
              COALESCE(payable_this_month, original_amount) AS payable_this_month,
              status, created_at, updated_at
       FROM loan_installments
       WHERE employee_id IS NOT NULL AND month IS NOT NULL
       ORDER BY employee_id ASC, month ASC, created_at ASC`,
    );
    const loanRows = asRows<{
      employee_id: number;
      month: string;
      original_amount: number;
      paid_amount: number;
      payable_this_month: number;
      status: string;
      created_at: string;
      updated_at: string;
    }>(legacyLoans);

    const byEmp = new Map<number, typeof loanRows>();
    for (const row of loanRows) {
      const id = Number(row.employee_id);
      const list = byEmp.get(id) || [];
      list.push(row);
      byEmp.set(id, list);
    }

    for (const [employeeId, rows] of byEmp) {
      // Skip if every legacy month already exists in new installment table
      const months = rows.map((r) => String(r.month).slice(0, 7));
      const placeholders = months.map(() => "?").join(",");
      const [existingInst]: any = await query(
        `SELECT i.due_month
         FROM employee_loan_installments i
         INNER JOIN employee_loans l ON l.id = i.loan_id
         WHERE l.employee_id = ? AND i.due_month IN (${placeholders})`,
        [employeeId, ...months],
      );
      const have = new Set(asRows<{ due_month: string }>(existingInst).map((r) => r.due_month));
      const missing = rows.filter((r) => !have.has(String(r.month).slice(0, 7)));
      if (missing.length === 0) continue;

      // Split missing into consecutive blocks
      const sorted = [...missing].sort((a, b) => String(a.month).localeCompare(String(b.month)));
      const blocks: (typeof sorted)[] = [];
      let current: typeof sorted = [];
      for (const row of sorted) {
        if (current.length === 0) {
          current = [row];
          continue;
        }
        const prev = String(current[current.length - 1].month).slice(0, 7);
        const cur = String(row.month).slice(0, 7);
        if (cur === nextYm(prev)) current.push(row);
        else {
          blocks.push(current);
          current = [row];
        }
      }
      if (current.length) blocks.push(current);

      for (const block of blocks) {
        const principal = block.reduce((s, r) => s + num(r.original_amount), 0);
        const startMonth = String(block[0].month).slice(0, 7);
        const anyPending = block.some(
          (r) => String(r.status || "pending").toLowerCase() === "pending",
        );
        const [ins]: any = await query(
          `INSERT INTO employee_loans
             (employee_id, principal, installment_count, start_month, status, notes, issued_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Reconciled from loan_installments', ?, ?, ?)`,
          [
            employeeId,
            principal,
            block.length,
            startMonth,
            anyPending ? "active" : "closed",
            block[0].created_at || new Date(),
            block[0].created_at || new Date(),
            block[block.length - 1].updated_at || block[block.length - 1].created_at || new Date(),
          ],
        );
        const loanId = ins?.insertId;
        if (!loanId) continue;

        for (let i = 0; i < block.length; i++) {
          const r = block[i];
          const st = String(r.status || "pending").toLowerCase();
          const payable = num(r.payable_this_month ?? r.original_amount);
          const paidAmt = st === "paid" ? num(r.paid_amount) || payable : num(r.paid_amount);
          await query(
            `INSERT INTO employee_loan_installments
               (loan_id, installment_no, due_month, original_amount, payable_amount, paid_amount, status, paid_at, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Reconciled from loan_installments', ?, ?)`,
            [
              loanId,
              i + 1,
              String(r.month).slice(0, 7),
              num(r.original_amount),
              payable,
              paidAmt,
              st || "pending",
              st === "paid" ? r.updated_at || r.created_at || new Date() : null,
              r.created_at || new Date(),
              r.updated_at || r.created_at || new Date(),
            ],
          );
        }
      }
    }
  } catch {
    // Tables may not exist yet — history GET should still respond.
  }
}

/** Mark advance + loan installment for an employee/month as paid (legacy + history). */
export async function markMonthDeductionsPaid(
  employeeId: number | string,
  month: string,
): Promise<{ advance: boolean; loan: boolean }> {
  let advance = false;
  let loan = false;
  const empId = Number(employeeId);
  if (!Number.isFinite(empId) || empId <= 0 || !/^\d{4}-\d{2}$/.test(month)) {
    return { advance, loan };
  }

  // --- Advance (history ledger + legacy advance_salary) ---
  try {
    const [advRows]: any = await query(
      `SELECT id FROM employee_advances
       WHERE employee_id = ? AND payroll_month = ? AND LOWER(status) NOT IN ('paid','cancelled')
       ORDER BY id DESC`,
      [empId, month],
    );
    const adv = asRows<{ id: number }>(advRows);
    if (adv.length > 0) {
      await query(
        `UPDATE employee_advances
         SET status = 'paid',
             notes = 'Marked paid from monthly payroll',
             updated_at = NOW()
         WHERE employee_id = ? AND payroll_month = ? AND LOWER(status) NOT IN ('paid','cancelled')`,
        [empId, month],
      );
      advance = true;
    } else {
      const [legacy]: any = await query(
        `SELECT advance_amount FROM advance_salary
         WHERE employee_id = ?
           AND (DATE_FORMAT(created_at, '%Y-%m') = ? OR DATE_FORMAT(updated_at, '%Y-%m') = ?)
         ORDER BY id DESC LIMIT 1`,
        [empId, month, month],
      );
      const leg = asRows<{ advance_amount: number }>(legacy);
      if (leg.length > 0 && num(leg[0].advance_amount) > 0) {
        await syncAdvanceLedger({
          employeeId: empId,
          payrollMonth: month,
          amount: num(leg[0].advance_amount),
        });
        await query(
          `UPDATE employee_advances
           SET status = 'paid',
               notes = 'Marked paid from monthly payroll',
               updated_at = NOW()
           WHERE employee_id = ? AND payroll_month = ? AND LOWER(status) <> 'cancelled'`,
          [empId, month],
        );
        advance = true;
      }
    }
  } catch {
    /* table may be missing on old env */
  }

  // --- Loan installment (legacy + history) ---
  try {
    let payable = 0;
    const [li]: any = await query(
      `SELECT original_amount, payable_this_month, paid_amount, status
       FROM loan_installments WHERE employee_id = ? AND month = ? LIMIT 1`,
      [empId, month],
    );
    const rows = asRows<{
      original_amount: number;
      payable_this_month: number;
      paid_amount: number;
      status: string;
    }>(li);
    if (rows.length > 0) {
      payable = num(rows[0].payable_this_month ?? rows[0].original_amount);
      await query(
        `UPDATE loan_installments
         SET status = 'paid', paid_amount = ?, updated_at = NOW()
         WHERE employee_id = ? AND month = ?`,
        [payable, empId, month],
      );
      loan = true;
    }

    // Direct history installment update (does not depend on legacy row existing)
    const [histInst]: any = await query(
      `SELECT i.id, i.payable_amount, i.paid_amount, i.status
       FROM employee_loan_installments i
       INNER JOIN employee_loans l ON l.id = i.loan_id
       WHERE l.employee_id = ? AND i.due_month = ?
       ORDER BY i.id DESC LIMIT 1`,
      [empId, month],
    );
    const hist = asRows<{
      id: number;
      payable_amount: number;
      paid_amount: number;
      status: string;
    }>(histInst);
    if (hist.length > 0) {
      const st = String(hist[0].status || "").toLowerCase();
      if (st !== "paid" && st !== "stopped") {
        const pay = payable > 0 ? payable : num(hist[0].payable_amount);
        await query(
          `UPDATE employee_loan_installments
           SET status = 'paid', paid_amount = ?, paid_at = NOW(),
               notes = 'Marked paid from monthly payroll', updated_at = NOW()
           WHERE id = ?`,
          [pay, hist[0].id],
        );
        loan = true;
        // Close loan master if no pending installments left
        const [loanIdRows]: any = await query(
          `SELECT loan_id FROM employee_loan_installments WHERE id = ?`,
          [hist[0].id],
        );
        const loanId = asRows<{ loan_id: number }>(loanIdRows)[0]?.loan_id;
        if (loanId) {
          const [pending]: any = await query(
            `SELECT COUNT(*) AS c FROM employee_loan_installments
             WHERE loan_id = ? AND LOWER(status) = 'pending'`,
            [loanId],
          );
          if (num(asRows<{ c: number }>(pending)[0]?.c) === 0) {
            await query(
              `UPDATE employee_loans SET status = 'closed', updated_at = NOW() WHERE id = ?`,
              [loanId],
            );
          }
        }
      }
    } else if (loan) {
      // History row missing — reconcile from legacy then mark
      await reconcileLegacyFinancialHistory();
      await syncLoanInstallmentFromLegacy({
        employeeId: empId,
        month,
        payable: payable > 0 ? payable : null,
        status: "paid",
        paidAmount: payable > 0 ? payable : null,
      });
    } else {
      // No legacy row either — still try sync after reconcile
      await reconcileLegacyFinancialHistory();
      await syncLoanInstallmentFromLegacy({
        employeeId: empId,
        month,
        status: "paid",
      });
    }

    if (loan && payable > 0) {
      await syncLoanInstallmentFromLegacy({
        employeeId: empId,
        month,
        payable,
        status: "paid",
        paidAmount: payable,
      });
    }
  } catch {
    /* ignore */
  }

  return { advance, loan };
}

export type MarkPaidMonthResult = {
  employees_updated: number;
  advances_marked: number;
  loans_marked: number;
  history_loans_marked: number;
};

/**
 * Bulk-mark every advance + loan installment for a payroll month as paid.
 * Uses month-wide UPDATEs first (reliable), then per-employee sync for ledger gaps.
 */
export async function markMonthDeductionsPaidForAll(
  month: string,
): Promise<MarkPaidMonthResult> {
  const empty: MarkPaidMonthResult = {
    employees_updated: 0,
    advances_marked: 0,
    loans_marked: 0,
    history_loans_marked: 0,
  };
  if (!/^\d{4}-\d{2}$/.test(month)) return empty;

  const ids = new Set<number>();
  const addIds = (rows: { employee_id: number }[]) => {
    for (const r of rows) {
      const id = Number(r.employee_id);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
  };

  let advancesMarked = 0;
  let loansMarked = 0;
  let historyLoansMarked = 0;

  // 1) Ensure history ledger rows exist for legacy advances this month
  try {
    const [legacyAdv]: any = await query(
      `SELECT employee_id, advance_amount
       FROM advance_salary
       WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
          OR DATE_FORMAT(updated_at, '%Y-%m') = ?`,
      [month, month],
    );
    for (const row of asRows<{ employee_id: number; advance_amount: number }>(legacyAdv)) {
      addIds([row]);
      const amt = num(row.advance_amount);
      if (!(amt > 0)) continue;
      await syncAdvanceLedger({
        employeeId: Number(row.employee_id),
        payrollMonth: month,
        amount: amt,
      });
    }
  } catch {
    /* ignore */
  }

  // 2) Bulk mark advances in history ledger
  try {
    const [res]: any = await query(
      `UPDATE employee_advances
       SET status = 'paid',
           notes = 'Marked paid from monthly payroll',
           updated_at = NOW()
       WHERE payroll_month = ?
         AND LOWER(COALESCE(status, 'active')) NOT IN ('paid', 'cancelled')`,
      [month],
    );
    advancesMarked = Number(res?.affectedRows || 0);
  } catch {
    /* ignore */
  }

  // 3) Bulk mark legacy loan installments (Loan page source of truth)
  try {
    const [res]: any = await query(
      `UPDATE loan_installments
       SET status = 'paid',
           paid_amount = COALESCE(payable_this_month, original_amount, paid_amount, 0),
           updated_at = NOW()
       WHERE month = ?
         AND LOWER(COALESCE(status, 'pending')) <> 'paid'`,
      [month],
    );
    loansMarked = Number(res?.affectedRows || 0);
  } catch {
    /* ignore */
  }

  // 4) Reconcile so history installments exist for legacy loans
  try {
    await reconcileLegacyFinancialHistory();
  } catch {
    /* ignore */
  }

  // 5) Bulk mark history loan installments for this due month
  try {
    const [res]: any = await query(
      `UPDATE employee_loan_installments i
       INNER JOIN employee_loans l ON l.id = i.loan_id
       SET i.status = 'paid',
           i.paid_amount = COALESCE(NULLIF(i.paid_amount, 0), i.payable_amount, i.original_amount, 0),
           i.paid_at = COALESCE(i.paid_at, NOW()),
           i.notes = 'Marked paid from monthly payroll',
           i.updated_at = NOW()
       WHERE i.due_month = ?
         AND LOWER(COALESCE(i.status, 'pending')) NOT IN ('paid', 'stopped', 'stop')`,
      [month],
    );
    historyLoansMarked = Number(res?.affectedRows || 0);
  } catch {
    /* ignore */
  }

  // 6) Close loan masters with no pending installments left
  try {
    await query(
      `UPDATE employee_loans l
       SET l.status = 'closed', l.updated_at = NOW()
       WHERE LOWER(COALESCE(l.status, 'active')) = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM employee_loan_installments i
           WHERE i.loan_id = l.id AND LOWER(COALESCE(i.status, 'pending')) = 'pending'
         )
         AND EXISTS (
           SELECT 1 FROM employee_loan_installments i2
           WHERE i2.loan_id = l.id AND i2.due_month = ?
         )`,
      [month],
    );
  } catch {
    /* ignore */
  }

  // Collect employee ids touched this month (for response count)
  try {
    const [c]: any = await query(
      `SELECT DISTINCT employee_id FROM employee_advances WHERE payroll_month = ?`,
      [month],
    );
    addIds(asRows<{ employee_id: number }>(c));
  } catch {
    /* ignore */
  }
  try {
    const [b]: any = await query(
      `SELECT DISTINCT employee_id FROM loan_installments WHERE month = ?`,
      [month],
    );
    addIds(asRows<{ employee_id: number }>(b));
  } catch {
    /* ignore */
  }
  try {
    const [d]: any = await query(
      `SELECT DISTINCT l.employee_id
       FROM employee_loans l
       INNER JOIN employee_loan_installments i ON i.loan_id = l.id
       WHERE i.due_month = ?`,
      [month],
    );
    addIds(asRows<{ employee_id: number }>(d));
  } catch {
    /* ignore */
  }

  // Per-employee pass as safety net (covers edge ID / sync gaps)
  let n = 0;
  for (const id of ids) {
    const res = await markMonthDeductionsPaid(id, month);
    if (res.advance || res.loan) n += 1;
  }

  return {
    employees_updated: Math.max(n, ids.size > 0 && (advancesMarked > 0 || loansMarked > 0 || historyLoansMarked > 0) ? ids.size : n),
    advances_marked: advancesMarked,
    loans_marked: loansMarked,
    history_loans_marked: historyLoansMarked,
  };
}

export async function fetchEmployeeActivitySummary(year: string) {
  const [advResult]: any = await query(
    `SELECT employee_id,
            COUNT(*) AS advance_count,
            COALESCE(SUM(amount), 0) AS advance_total
     FROM employee_advances
     WHERE LEFT(payroll_month, 4) = ? AND status <> 'cancelled'
     GROUP BY employee_id`,
    [year],
  );
  const [loanResult]: any = await query(
    `SELECT employee_id,
            COUNT(*) AS loan_count,
            COALESCE(SUM(principal), 0) AS loan_principal
     FROM employee_loans
     WHERE LEFT(start_month, 4) = ?
        OR id IN (
          SELECT loan_id FROM employee_loan_installments WHERE LEFT(due_month, 4) = ?
        )
     GROUP BY employee_id`,
    [year, year],
  );

  const advRows = asRows<{ employee_id: number; advance_count: number; advance_total: number }>(
    advResult,
  );
  const loanRows = asRows<{ employee_id: number; loan_count: number; loan_principal: number }>(
    loanResult,
  );

  const map = new Map<
    number,
    {
      employee_id: number;
      advance_count: number;
      advance_total: number;
      loan_count: number;
      loan_principal: number;
    }
  >();

  for (const r of advRows) {
    map.set(Number(r.employee_id), {
      employee_id: Number(r.employee_id),
      advance_count: num(r.advance_count),
      advance_total: num(r.advance_total),
      loan_count: 0,
      loan_principal: 0,
    });
  }
  for (const r of loanRows) {
    const id = Number(r.employee_id);
    const cur = map.get(id) || {
      employee_id: id,
      advance_count: 0,
      advance_total: 0,
      loan_count: 0,
      loan_principal: 0,
    };
    cur.loan_count = num(r.loan_count);
    cur.loan_principal = num(r.loan_principal);
    map.set(id, cur);
  }

  return Array.from(map.values()).sort((a, b) => a.employee_id - b.employee_id);
}
