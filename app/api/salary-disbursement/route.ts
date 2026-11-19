import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { viewerHasFinancePayrollPowers } from "@/lib/access-control/hr-access";
import { getEmployeeAccessPayload } from "@/lib/access-control/store";
import {
  bankGroupFromName,
  normalizeDisbursementStatus,
  type SalaryBankGroup,
} from "@/lib/salary-disbursement";
import { computeMonthlyFinalSalaries } from "@/lib/monthly-payroll-final-salary";

function asRows<T>(result: any): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

function viewerIdFrom(req: NextRequest, body?: any): string {
  const raw =
    body?.viewer_id ??
    req.headers.get("x-hrm-employee-id") ??
    req.headers.get("x-employee-id") ??
    req.nextUrl.searchParams.get("viewerId") ??
    "";
  const id = String(raw || "").trim();
  return /^\d+$/.test(id) ? id : "";
}

async function assertFinanceViewer(viewerId: string): Promise<boolean> {
  if (!viewerId) return false;
  try {
    const access = await getEmployeeAccessPayload(viewerId);
    return viewerHasFinancePayrollPowers({
      departmentName: access.departmentName,
      roleSlugs: access.role?.slugs || [],
      permissions: access.permissions || [],
    });
  } catch {
    return false;
  }
}

type EmpRow = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  pseudonym?: string | null;
  employee_code?: string | null;
  status?: string | null;
  department_name?: string | null;
};

type SalaryRow = {
  employee_id: number | string;
  amount?: number | string | null;
  account_number?: string | null;
  routing_number?: string | null;
};

type DisbursementRow = {
  employee_id: number;
  amount?: number | string | null;
  bank_name?: string | null;
  account_number?: string | null;
  bank_group?: string | null;
  status?: string | null;
  marked_at?: string | Date | null;
};

function isInactiveStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim().toLowerCase();
  return ["terminated", "resign", "resigned", "left", "inactive"].includes(s);
}

async function loadEmployeeSalarySnapshots() {
  const [empResult]: any = await query(
    `SELECT e.id, e.first_name, e.last_name, e.pseudonym, e.employee_code, e.status,
            d.name AS department_name
     FROM hrm_employees e
     LEFT JOIN employee_jobs j ON j.employee_id = e.id
     LEFT JOIN departments d ON d.id = j.department_id
     ORDER BY e.first_name ASC, e.last_name ASC`,
  );
  const employees = asRows<EmpRow>(empResult).filter((e) => !isInactiveStatus(e.status));

  let salaryRows: SalaryRow[] = [];
  try {
    const [sResult]: any = await query(
      `SELECT employee_id, amount, account_number, routing_number
       FROM employee_salaries
       ORDER BY id ASC`,
    );
    salaryRows = asRows<SalaryRow>(sResult);
  } catch {
    salaryRows = [];
  }

  const salaryByEmp = new Map<
    number,
    { amount: number; account_number: string; bank_name: string }
  >();
  for (const row of salaryRows) {
    const id = Number(row.employee_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const prev = salaryByEmp.get(id) || {
      amount: 0,
      account_number: "",
      bank_name: "",
    };
    const amt = Number(row.amount);
    if (Number.isFinite(amt) && amt > 0) prev.amount += amt;
    const account = String(row.account_number || "").trim();
    if (account) prev.account_number = account;
    const bank = String(row.routing_number || "").trim();
    if (bank) prev.bank_name = bank;
    salaryByEmp.set(id, prev);
  }

  return employees.map((emp) => {
    const employeeId = Number(emp.id);
    const sal = salaryByEmp.get(employeeId) || {
      amount: 0,
      account_number: "",
      bank_name: "",
    };
    return {
      employee_id: employeeId,
      first_name: emp.first_name || "",
      last_name: emp.last_name || "",
      employee_name: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
      pseudonym: emp.pseudonym || "",
      employee_code: emp.employee_code || "",
      department_name: emp.department_name || "",
      amount: sal.amount,
      account_number: sal.account_number,
      bank_name: sal.bank_name,
      bank_group: bankGroupFromName(sal.bank_name),
    };
  });
}

/**
 * GET ?month=YYYY-MM&bank=askari|other|all&viewerId=
 * Finance-only list for salary bank transfer (Askari vs Other).
 */
export async function GET(req: NextRequest) {
  try {
    const month = String(req.nextUrl.searchParams.get("month") || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, message: "month (YYYY-MM) required" },
        { status: 400 },
      );
    }

    const viewerId = viewerIdFrom(req);
    if (!(await assertFinanceViewer(viewerId))) {
      return NextResponse.json(
        { success: false, message: "Finance access required." },
        { status: 403 },
      );
    }

    const bankParam = String(req.nextUrl.searchParams.get("bank") || "all")
      .trim()
      .toLowerCase();
    const bankFilter: "all" | SalaryBankGroup =
      bankParam === "askari" || bankParam === "other" ? bankParam : "all";

    const snapshots = await loadEmployeeSalarySnapshots();
    const finalSalaryMap = await computeMonthlyFinalSalaries(month);

    let existing: DisbursementRow[] = [];
    try {
      const [dRows]: any = await query(
        `SELECT employee_id, amount, bank_name, account_number, bank_group, status, marked_at
         FROM salary_disbursements
         WHERE month = ?`,
        [month],
      );
      existing = asRows<DisbursementRow>(dRows);
    } catch {
      existing = [];
    }

    const byEmp = new Map<number, DisbursementRow>();
    for (const row of existing) {
      const id = Number(row.employee_id);
      if (Number.isFinite(id)) byEmp.set(id, row);
    }

    const lookupFinal = (employeeId: number): number => {
      const keys = [String(employeeId), String(Number(employeeId))];
      for (const k of keys) {
        const n = Number(finalSalaryMap[k]);
        if (Number.isFinite(n) && n >= 0 && Object.prototype.hasOwnProperty.call(finalSalaryMap, k)) {
          return n;
        }
      }
      return 0;
    };

    const records = snapshots
      .map((emp) => {
        const saved = byEmp.get(emp.employee_id);
        const bankName = String(saved?.bank_name || emp.bank_name || "").trim();
        const accountNumber = String(
          saved?.account_number || emp.account_number || "",
        ).trim();
        const group = bankGroupFromName(bankName);
        const status = normalizeDisbursementStatus(saved?.status);
        const liveFinal = lookupFinal(emp.employee_id);
        // Paid rows keep frozen marked amount; unpaid/live rows use Monthly Payroll Final Salary
        const amount =
          status === "paid" && saved?.amount != null && Number(saved.amount) >= 0
            ? Number(saved.amount)
            : liveFinal > 0
              ? liveFinal
              : Number(emp.amount) || 0;
        return {
          employee_id: emp.employee_id,
          first_name: emp.first_name,
          last_name: emp.last_name,
          employee_name: emp.employee_name,
          pseudonym: emp.pseudonym,
          employee_code: emp.employee_code,
          department_name: emp.department_name,
          bank_name: bankName,
          account_number: accountNumber,
          bank_group: group,
          amount,
          status,
          marked_at: saved?.marked_at || null,
        };
      })
      .filter((r) => r.amount > 0 || r.account_number || r.bank_name)
      .filter((r) => (bankFilter === "all" ? true : r.bank_group === bankFilter));

    const summary = {
      total_employees: records.length,
      paid_count: records.filter((r) => r.status === "paid").length,
      unpaid_count: records.filter((r) => r.status === "unpaid").length,
      paid_amount: records
        .filter((r) => r.status === "paid")
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
      unpaid_amount: records
        .filter((r) => r.status === "unpaid")
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
      total_amount: records.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    };

    return NextResponse.json({
      success: true,
      month,
      bank: bankFilter,
      records,
      summary,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST { month, bank_group: askari|other, selected_ids: number[], viewer_id }
 * Selected → Salary Paid; remaining in that bank group for the month → Salary Unpaid.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const month = String(body.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, message: "month (YYYY-MM) required" },
        { status: 400 },
      );
    }

    const bankGroup = String(body.bank_group || "").trim().toLowerCase();
    if (bankGroup !== "askari" && bankGroup !== "other") {
      return NextResponse.json(
        { success: false, message: "bank_group must be askari or other" },
        { status: 400 },
      );
    }

    const viewerId = viewerIdFrom(req, body);
    if (!(await assertFinanceViewer(viewerId))) {
      return NextResponse.json(
        { success: false, message: "Finance access required." },
        { status: 403 },
      );
    }

    const selectedIds = Array.isArray(body.selected_ids)
      ? body.selected_ids
          .map((x: unknown) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    const selectedSet = new Set(selectedIds);

    const amountMap = new Map<number, number>();
    if (body.amounts && typeof body.amounts === "object") {
      for (const [k, v] of Object.entries(body.amounts as Record<string, unknown>)) {
        const id = Number(k);
        const amt = Number(v);
        if (Number.isFinite(id) && id > 0 && Number.isFinite(amt) && amt >= 0) {
          amountMap.set(id, amt);
        }
      }
    }

    const finalSalaryMap = await computeMonthlyFinalSalaries(month);
    const snapshots = (await loadEmployeeSalarySnapshots())
      .filter((r) => r.bank_group === bankGroup)
      .filter((r) => r.amount > 0 || r.account_number || r.bank_name);

    let paidCount = 0;
    let unpaidCount = 0;
    let paidAmount = 0;
    const now = new Date();

    for (const row of snapshots) {
      const status = selectedSet.has(row.employee_id) ? "paid" : "unpaid";
      const liveFinal =
        Number(finalSalaryMap[String(row.employee_id)]) ||
        Number(finalSalaryMap[String(Number(row.employee_id))]) ||
        0;
      const amount = amountMap.has(row.employee_id)
        ? Number(amountMap.get(row.employee_id))
        : liveFinal > 0
          ? liveFinal
          : row.amount;
      try {
        await query(
          `INSERT INTO salary_disbursements
             (employee_id, month, amount, bank_name, account_number, bank_group, status, marked_by, marked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             amount = VALUES(amount),
             bank_name = VALUES(bank_name),
             account_number = VALUES(account_number),
             bank_group = VALUES(bank_group),
             status = VALUES(status),
             marked_by = VALUES(marked_by),
             marked_at = VALUES(marked_at)`,
          [
            row.employee_id,
            month,
            amount,
            row.bank_name || null,
            row.account_number || null,
            bankGroup,
            status,
            Number(viewerId),
            status === "paid" ? now : null,
          ],
        );
      } catch (err: any) {
        if (String(err?.message || "").toLowerCase().includes("salary_disbursements")) {
          return NextResponse.json(
            {
              success: false,
              message:
                "salary_disbursements table missing — wait for migration deploy, then retry.",
            },
            { status: 503 },
          );
        }
        throw err;
      }
      if (status === "paid") {
        paidCount += 1;
        paidAmount += amount;
      } else {
        unpaidCount += 1;
      }
    }

    return NextResponse.json({
      success: true,
      month,
      bank_group: bankGroup,
      paid_count: paidCount,
      unpaid_count: unpaidCount,
      paid_amount: paidAmount,
      message: `${bankGroup === "askari" ? "Askari" : "Other banks"}: ${paidCount} Salary Paid, ${unpaidCount} Salary Unpaid.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
