import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../../lib/db';
import {
  filterSalariesForViewer,
  viewerIdFromRequest,
} from '@/lib/access-control/salary-visibility';
import { normalizeMedicalPackage } from '@/lib/medical-package';

function asEmployeeId(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** Mongo SQL adapter does not support SUM/GROUP BY — aggregate in JS. */
function mergeSalaryAmounts(
  employees: Array<Record<string, unknown>>,
  salaryRows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byEmp = new Map<
    string,
    {
      amount: number;
      fuel_allowance: number | null;
      company_transport_deduction: number | null;
      medical_package: string | null;
    }
  >();
  for (const s of salaryRows) {
    const eid = asEmployeeId(s.employee_id);
    if (!eid) continue;
    const prev = byEmp.get(eid) || {
      amount: 0,
      fuel_allowance: null,
      company_transport_deduction: null,
      medical_package: null,
    };
    const amt = Number(s.amount);
    if (Number.isFinite(amt) && amt > 0) prev.amount += amt;
    const fuel = Number(s.fuel_allowance);
    if (Number.isFinite(fuel) && fuel > 0) {
      prev.fuel_allowance =
        prev.fuel_allowance == null ? fuel : Math.max(prev.fuel_allowance, fuel);
    }
    const ctd = Number(s.company_transport_deduction);
    if (Number.isFinite(ctd) && ctd > 0) {
      prev.company_transport_deduction =
        prev.company_transport_deduction == null
          ? ctd
          : Math.max(prev.company_transport_deduction, ctd);
    }
    const pkg = normalizeMedicalPackage(s.medical_package);
    if (pkg) prev.medical_package = pkg;
    byEmp.set(eid, prev);
    // Also index numeric alias so "097" / 97 join cleanly
    if (/^\d+$/.test(eid)) byEmp.set(String(Number(eid)), prev);
  }

  return employees.map((e) => {
    const eid = asEmployeeId(e.employee_id ?? e.id);
    const sal =
      byEmp.get(eid) ||
      (/^\d+$/.test(eid) ? byEmp.get(String(Number(eid))) : undefined);
    return {
      employee_id: /^\d+$/.test(eid) ? Number(eid) : eid,
      first_name: e.first_name ?? null,
      last_name: e.last_name ?? null,
      pseudonym: e.pseudonym ?? null,
      department_name: e.department_name ?? null,
      amount: sal?.amount ?? 0,
      fuel_allowance: sal?.fuel_allowance ?? null,
      company_transport_deduction: sal?.company_transport_deduction ?? null,
      medical_package: sal?.medical_package ?? null,
    };
  });
}

/** Only real employee ids — emails/login names must not trigger redact-all. */
function normalizeViewerEmployeeId(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^\d+$/.test(v)) return String(Number(v));
  return "";
}

// GET /api/employee_salaries/all - return all employees with their basic salary
// Pass ?viewerId= or header x-hrm-employee-id to apply HR salary privacy.
export async function GET(req: NextRequest) {
  try {
    // Keep queries Mongo-adapter friendly (no SUM / GROUP BY / MAX).
    const [employees]: any = await pool.execute(`
      SELECT e.id as employee_id, e.first_name, e.last_name, e.pseudonym, d.name AS department_name
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      ORDER BY e.id DESC
    `);
    const [salaryRows]: any = await pool.execute(`
      SELECT employee_id, amount, fuel_allowance, company_transport_deduction, medical_package
      FROM employee_salaries
    `);
    const rows = mergeSalaryAmounts(
      (employees || []) as Record<string, unknown>[],
      (salaryRows || []) as Record<string, unknown>[],
    );

    const viewerId = normalizeViewerEmployeeId(viewerIdFromRequest(req));
    const salaries = viewerId
      ? await filterSalariesForViewer(viewerId, rows as Record<string, unknown>[])
      : rows;
    return NextResponse.json({ success: true, salaries });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
