import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import { parseJsonField } from "@/lib/employee-documents";
import {
  EMPLOYEE_TICKETS_TABLE,
  buildTicketNumber,
  broadcastTicketUpdate,
  ensureEmployeeTicketsTable,
  rowToTicket,
} from "@/lib/employee-tickets-table";
import { seedEmployeeMessage } from "@/lib/ticket-thread";

export const MEDICAL_SUBSCRIPTION_TITLE =
  "Interact Global - Medical Benefits Subscription Form";
export const MEDICAL_CLAIM_TITLE = "Interact Global - Medical Claim Form";

export type OpdTier = "Standard" | "Enhanced" | "Premium";

/** Annual OPD limit (family, PKR) — matches Medical Claims Tracker sheet. */
export const OPD_ANNUAL_LIMITS: Record<OpdTier, number> = {
  Standard: 24_000,
  Enhanced: 40_000,
  Premium: 50_000,
};

/** IPD per covered individual / policy year (from subscription form copy). */
export const IPD_ANNUAL_LIMIT = 150_000;

/** Policy year starts 1 October (Asia/Karachi calendar date). */
export function policyYearBounds(now = new Date()): { start: string; end: string; label: string } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const startYear = m >= 9 ? y : y - 1; // Oct=9
  const endYear = startYear + 1;
  return {
    start: `${startYear}-10-01`,
    end: `${endYear}-09-30`,
    label: `Oct ${startYear} – Sep ${endYear}`,
  };
}

export function parseOpdTier(raw: unknown): OpdTier | null {
  const s = String(raw || "").toLowerCase();
  if (!s) return null;
  if (s.includes("premium")) return "Premium";
  if (s.includes("enhanced")) return "Enhanced";
  if (s.includes("standard")) return "Standard";
  return null;
}

export function annualOpdLimitForTier(tier: OpdTier | null): number | null {
  if (!tier) return null;
  return OPD_ANNUAL_LIMITS[tier];
}

export function isMedicalClaimTemplate(title: unknown, category?: unknown): boolean {
  const t = String(title || "");
  const c = String(category || "").toLowerCase();
  if (c === "medical" && /claim/i.test(t)) return true;
  return t === MEDICAL_CLAIM_TITLE || /medical claim form/i.test(t);
}

export function isMedicalSubscriptionTemplate(title: unknown, category?: unknown): boolean {
  const t = String(title || "");
  const c = String(category || "").toLowerCase();
  if (c === "medical" && /subscription/i.test(t)) return true;
  return t === MEDICAL_SUBSCRIPTION_TITLE || /medical benefits subscription/i.test(t);
}

/** Claim amount in PKR from claim form_data. */
export function claimAmountFromFormData(formData: Record<string, unknown> | null | undefined): {
  claimType: "OPD" | "IPD" | null;
  amount: number;
} {
  if (!formData) return { claimType: null, amount: 0 };
  const typeRaw = String(formData.claim_type || "").toUpperCase();
  const isIpd = typeRaw.includes("IPD");
  const isOpd = typeRaw.includes("OPD");
  const claimType = isIpd ? "IPD" : isOpd ? "OPD" : null;
  const raw = isIpd ? formData.ipd_total_amount : formData.opd_total_amount;
  const amount = Number(String(raw ?? "").replace(/[^\d.]/g, "")) || 0;
  return { claimType, amount };
}

export type MedicalBalanceRow = {
  employeeId: number;
  employeeName: string;
  status: string;
  medicalStartMonth: string | null;
  opdTier: OpdTier | null;
  annualOpdLimit: number | null;
  opdApproved: number;
  opdRemaining: number | null;
  ipdApproved: number;
  ipdRemaining: number | null;
  budgetExceeded: boolean;
  subscriptionAssignmentId: number | null;
  subscriptionSubmittedAt: string | null;
};

type AssignmentLite = {
  id: number;
  employee_id: number;
  employee_name: string;
  template_title: string;
  template_category: string;
  status: string;
  submitted_at: string | null;
  form_data: Record<string, unknown> | null;
};

export async function loadMedicalAssignments(): Promise<AssignmentLite[]> {
  // No multi-table JOINs — Mongo SQL adapter drops INNER JOIN rows when ON aliases
  // are reversed. Enrich templates/employees in JS (same pattern as form-assignments GET).
  // Fetch all assignments then filter status in JS — Mongo `IN ('submitted',…)` can miss rows.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, employee_id, template_id, status, submitted_at, form_data
     FROM hrm_form_assignments
     ORDER BY id DESC`
  );

  const raw = (rows as Array<Record<string, unknown>>).filter((r) => {
    const s = String(r.status || "").toLowerCase();
    return s === "submitted" || s === "archived";
  });
  if (!raw.length) return [];

  const templateIds = Array.from(
    new Set(raw.map((r) => Number(r.template_id)).filter((n) => Number.isFinite(n) && n > 0))
  );
  const employeeIds = Array.from(
    new Set(raw.map((r) => Number(r.employee_id)).filter((n) => Number.isFinite(n) && n > 0))
  );

  const templateMap = new Map<number, { title: string; category: string }>();
  try {
    // Always load full template list — Mongo adapter is unreliable with `IN (?)` lists.
    const [tRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, title, category FROM hrm_form_templates`
    );
    for (const t of tRows) {
      templateMap.set(Number(t.id), {
        title: String(t.title || ""),
        category: String(t.category || ""),
      });
    }
  } catch {
    /* ignore */
  }

  const employeeMap = new Map<number, string>();
  try {
    const [eRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, first_name, last_name FROM hrm_employees`
    );
    const want = new Set(employeeIds);
    for (const e of eRows) {
      const id = Number(e.id);
      if (!want.has(id)) continue;
      employeeMap.set(
        id,
        `${e.first_name || ""} ${e.last_name || ""}`.trim() || `Employee ${id}`
      );
    }
  } catch {
    /* names optional */
  }

  const out: AssignmentLite[] = [];
  for (const r of raw) {
    const tid = Number(r.template_id);
    const eid = Number(r.employee_id);
    const t = templateMap.get(tid);
    const title = t?.title || "";
    const category = t?.category || "";
    if (
      !isMedicalClaimTemplate(title, category) &&
      !isMedicalSubscriptionTemplate(title, category)
    ) {
      continue;
    }
    const status = String(r.status || "").toLowerCase();
    if (status !== "submitted" && status !== "archived") continue;

    out.push({
      id: Number(r.id),
      employee_id: eid,
      employee_name: employeeMap.get(eid) || `Employee ${eid}`,
      template_title: title,
      template_category: category,
      status: String(r.status || ""),
      submitted_at: r.submitted_at ? String(r.submitted_at) : null,
      form_data: parseJsonField<Record<string, unknown>>(r.form_data),
    });
  }

  out.sort((a, b) => {
    const as = a.submitted_at || "";
    const bs = b.submitted_at || "";
    if (as !== bs) return bs.localeCompare(as);
    return b.id - a.id;
  });
  return out;
}

function inPolicyYear(submittedAt: string | null, start: string, end: string): boolean {
  if (!submittedAt) return false;
  const d = submittedAt.slice(0, 10);
  return d >= start && d <= end;
}

export function buildMedicalBalances(
  assignments: AssignmentLite[],
  now = new Date()
): MedicalBalanceRow[] {
  const { start, end } = policyYearBounds(now);
  const byEmp = new Map<number, MedicalBalanceRow>();

  // Latest subscription per employee
  for (const a of assignments) {
    if (!isMedicalSubscriptionTemplate(a.template_title, a.template_category)) continue;
    if (byEmp.has(a.employee_id)) continue;
    const tier = parseOpdTier(a.form_data?.opd_plan_tier);
    const limit = annualOpdLimitForTier(tier);
    const startDate =
      String(a.form_data?.subscription_start_date || a.form_data?.date_of_confirmation || "").slice(
        0,
        7
      ) || null;
    byEmp.set(a.employee_id, {
      employeeId: a.employee_id,
      employeeName: a.employee_name,
      status: "Active",
      medicalStartMonth: startDate,
      opdTier: tier,
      annualOpdLimit: limit,
      opdApproved: 0,
      opdRemaining: limit,
      ipdApproved: 0,
      ipdRemaining: IPD_ANNUAL_LIMIT,
      budgetExceeded: false,
      subscriptionAssignmentId: a.id,
      subscriptionSubmittedAt: a.submitted_at,
    });
  }

  // Sum claims in policy year
  for (const a of assignments) {
    if (!isMedicalClaimTemplate(a.template_title, a.template_category)) continue;
    if (!inPolicyYear(a.submitted_at, start, end)) continue;
    let row = byEmp.get(a.employee_id);
    if (!row) {
      row = {
        employeeId: a.employee_id,
        employeeName: a.employee_name,
        status: "Active",
        medicalStartMonth: null,
        opdTier: null,
        annualOpdLimit: null,
        opdApproved: 0,
        opdRemaining: null,
        ipdApproved: 0,
        ipdRemaining: IPD_ANNUAL_LIMIT,
        budgetExceeded: false,
        subscriptionAssignmentId: null,
        subscriptionSubmittedAt: null,
      };
      byEmp.set(a.employee_id, row);
    }
    const { claimType, amount } = claimAmountFromFormData(a.form_data);
    if (claimType === "OPD") row.opdApproved += amount;
    if (claimType === "IPD") row.ipdApproved += amount;
    if (a.form_data?.budget_exceeded) row.budgetExceeded = true;
  }

  for (const row of byEmp.values()) {
    if (row.annualOpdLimit != null) {
      row.opdRemaining = row.annualOpdLimit - row.opdApproved;
      if (row.opdRemaining < 0) row.budgetExceeded = true;
    }
    row.ipdRemaining = IPD_ANNUAL_LIMIT - row.ipdApproved;
    if (row.ipdRemaining < 0) row.budgetExceeded = true;
  }

  return Array.from(byEmp.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );
}

export type BudgetCheckResult = {
  exceeded: boolean;
  claimType: "OPD" | "IPD" | null;
  amount: number;
  limit: number | null;
  remainingBefore: number | null;
  remainingAfter: number | null;
  tier: OpdTier | null;
  message: string | null;
};

/** Check one new claim against current balances (before this claim is counted). */
export function evaluateClaimAgainstBalance(
  balances: MedicalBalanceRow[],
  employeeId: number,
  formData: Record<string, unknown>
): BudgetCheckResult {
  const { claimType, amount } = claimAmountFromFormData(formData);
  const bal = balances.find((b) => b.employeeId === employeeId);
  const tier = bal?.opdTier ?? null;

  if (!claimType || amount <= 0) {
    return {
      exceeded: false,
      claimType,
      amount,
      limit: null,
      remainingBefore: null,
      remainingAfter: null,
      tier,
      message: null,
    };
  }

  if (claimType === "OPD") {
    const limit = bal?.annualOpdLimit ?? null;
    const remainingBefore =
      limit != null ? limit - (bal?.opdApproved ?? 0) : null;
    const remainingAfter =
      remainingBefore != null ? remainingBefore - amount : null;
    const exceeded = remainingBefore != null && amount > remainingBefore;
    return {
      exceeded,
      claimType,
      amount,
      limit,
      remainingBefore,
      remainingAfter,
      tier,
      message: exceeded
        ? `OPD claim PKR ${amount.toLocaleString()} exceeds remaining balance PKR ${Math.max(0, remainingBefore ?? 0).toLocaleString()} (limit ${limit?.toLocaleString() ?? "—"}, tier ${tier ?? "unknown"}).`
        : null,
    };
  }

  const remainingBefore = IPD_ANNUAL_LIMIT - (bal?.ipdApproved ?? 0);
  const remainingAfter = remainingBefore - amount;
  const exceeded = amount > remainingBefore;
  return {
    exceeded,
    claimType,
    amount,
    limit: IPD_ANNUAL_LIMIT,
    remainingBefore,
    remainingAfter,
    tier,
    message: exceeded
      ? `IPD claim PKR ${amount.toLocaleString()} exceeds remaining IPD balance PKR ${Math.max(0, remainingBefore).toLocaleString()} (limit ${IPD_ANNUAL_LIMIT.toLocaleString()}).`
      : null,
  };
}

export async function createMedicalBudgetExceedTicket(params: {
  employeeId: number | string;
  employeeName: string;
  check: BudgetCheckResult;
  assignmentId: number;
}): Promise<{ ticketId: number; ticketNumber: string } | null> {
  if (!params.check.exceeded || !params.check.message) return null;

  await ensureEmployeeTicketsTable();
  const subject = `Medical ${params.check.claimType} budget exceeded — ${params.employeeName}`;
  const description = `${params.check.message}\n\nAssignment #${params.assignmentId}. HR: review claim vs subscribed OPD/IPD package.`;

  const [result]: unknown[] = await pool.query(
    `INSERT INTO ${EMPLOYEE_TICKETS_TABLE}
     (ticket_number, employee_id, employee_name, category, ticket_type, is_custom,
      subject, description, form_data, priority, status, requested_at, updated_at)
     VALUES ('PENDING', ?, ?, 'HR', 'benefits_inquiry', 0, ?, ?, ?, 'high', 'pending', NOW(), NOW())`,
    [
      String(params.employeeId),
      params.employeeName || "Employee",
      subject,
      description,
      JSON.stringify({
        source: "medical_budget_exceed",
        assignment_id: params.assignmentId,
        claim_type: params.check.claimType,
        amount: params.check.amount,
        limit: params.check.limit,
        remaining_before: params.check.remainingBefore,
        tier: params.check.tier,
      }),
    ]
  );

  const insertId = Number((result as { insertId?: number })?.insertId);
  if (!insertId) return null;
  const ticketNumber = buildTicketNumber(insertId);
  await pool.query(`UPDATE ${EMPLOYEE_TICKETS_TABLE} SET ticket_number = ? WHERE id = ?`, [
    ticketNumber,
    insertId,
  ]);

  const messages = seedEmployeeMessage("HRM Medical Tracker", description);
  if (messages.length) {
    await pool.query(`UPDATE ${EMPLOYEE_TICKETS_TABLE} SET messages = ? WHERE id = ?`, [
      JSON.stringify(messages),
      insertId,
    ]);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
    [insertId]
  );
  const ticket = rows[0] ? rowToTicket(rows[0] as Record<string, unknown>) : null;
  if (ticket) broadcastTicketUpdate(ticket);

  return { ticketId: insertId, ticketNumber };
}
