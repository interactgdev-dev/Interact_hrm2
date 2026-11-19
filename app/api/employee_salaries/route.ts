import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";
import { normalizeMedicalPackage } from "@/lib/medical-package";

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function salaryFields(body: any) {
  const fuelRaw = body.fuel_allowance ?? body.fuelAllowance;
  const ctdRaw =
    body.company_transport_deduction ??
    body.companyTransportDeduction ??
    body.ctd;
  const hasMedicalPackage = Object.prototype.hasOwnProperty.call(
    body,
    "medical_package",
  ) || Object.prototype.hasOwnProperty.call(body, "medicalPackage");
  const medicalRaw = body.medical_package ?? body.medicalPackage;
  return {
    employee_id: body.employee_id ?? body.employeeId,
    component: body.component ?? null,
    payGrade: body.payGrade ?? body.pay_grade ?? null,
    payFrequency: body.payFrequency ?? body.pay_frequency ?? null,
    currency: body.currency ?? null,
    amount: parseAmount(body.amount),
    comments: body.comments ?? null,
    directDeposit: (body.directDeposit ?? body.direct_deposit) ? 1 : 0,
    accountNumber: body.accountNumber ?? body.account_number ?? null,
    accountType: body.accountType ?? body.account_type ?? null,
    routingNumber: body.routingNumber ?? body.routing_number ?? null,
    depositAmount: parseAmount(body.depositAmount ?? body.deposit_amount),
    fuelAllowance: fuelRaw === undefined ? undefined : parseAmount(fuelRaw),
    companyTransportDeduction: ctdRaw === undefined ? undefined : parseAmount(ctdRaw),
    hasMedicalPackage,
    medicalPackage: hasMedicalPackage
      ? medicalRaw === null || medicalRaw === ""
        ? null
        : normalizeMedicalPackage(medicalRaw)
      : undefined,
    allowancesOnly: Boolean(
      body.allowancesOnly ?? body.allowances_only ?? body.fuelOnly ?? body.fuel_only
    ),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    if (!employeeId) {
      return NextResponse.json({ success: false, error: "employeeId is required" }, { status: 400 });
    }
    const [rows]: any = await pool.execute(
      "SELECT * FROM employee_salaries WHERE employee_id = ? ORDER BY id DESC LIMIT 1",
      [employeeId]
    );
    if (rows && rows.length > 0) {
      const {
        resolveSalaryVisibility,
        viewerIdFromRequest,
      } = await import("@/lib/access-control/salary-visibility");
      const { redactSalaryRow } = await import("@/lib/access-control/hr-access");
      const viewerId = viewerIdFromRequest(req) || searchParams.get("viewerId") || "";
      if (viewerId) {
        const ok = await resolveSalaryVisibility(viewerId, employeeId);
        if (!ok) {
          return NextResponse.json({
            success: true,
            salary: redactSalaryRow(rows[0] as Record<string, unknown>),
            salary_hidden: true,
          });
        }
      }
      return NextResponse.json({ success: true, salary: rows[0] });
    }
    return NextResponse.json({ success: false, error: "Salary not found" });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

/** Update existing salary row, or insert if employee has none yet. */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const nested = body?.details?.salary
      ? { employee_id: body.details.employeeId ?? body.details.employee_id, ...body.details.salary }
      : body;
    const f = salaryFields(nested);
    if (!f.employee_id) {
      return NextResponse.json({ success: false, error: "employee_id is required" }, { status: 400 });
    }

    const [existing]: any = await pool.execute(
      "SELECT id, fuel_allowance, company_transport_deduction, medical_package FROM employee_salaries WHERE employee_id = ? ORDER BY id DESC LIMIT 1",
      [f.employee_id]
    );

    if (existing && existing.length > 0) {
      if (f.allowancesOnly) {
        // Preserve existing fuel/CTD/medical when field omitted (e.g. only package changed).
        const fuel =
          f.fuelAllowance !== undefined
            ? f.fuelAllowance
            : existing[0].fuel_allowance ?? null;
        const ctd =
          f.companyTransportDeduction !== undefined
            ? f.companyTransportDeduction
            : existing[0].company_transport_deduction ?? null;
        const medical =
          f.medicalPackage !== undefined
            ? f.medicalPackage
            : existing[0].medical_package ?? null;
        await pool.execute(
          `UPDATE employee_salaries SET fuel_allowance = ?, company_transport_deduction = ?, medical_package = ? WHERE id = ?`,
          [fuel, ctd, medical, existing[0].id]
        );
      } else {
        const fuel =
          f.fuelAllowance !== undefined
            ? f.fuelAllowance
            : existing[0].fuel_allowance ?? null;
        const ctd =
          f.companyTransportDeduction !== undefined
            ? f.companyTransportDeduction
            : existing[0].company_transport_deduction ?? null;
        const medical =
          f.medicalPackage !== undefined
            ? f.medicalPackage
            : existing[0].medical_package ?? null;
        await pool.execute(
          `UPDATE employee_salaries SET
             component = ?, pay_grade = ?, pay_frequency = ?, currency = ?, amount = ?, comments = ?,
             direct_deposit = ?, account_number = ?, account_type = ?, routing_number = ?, deposit_amount = ?,
             fuel_allowance = ?, company_transport_deduction = ?, medical_package = ?
           WHERE id = ?`,
          [
            f.component,
            f.payGrade,
            f.payFrequency,
            f.currency,
            f.amount,
            f.comments,
            f.directDeposit,
            f.accountNumber,
            f.accountType,
            f.routingNumber,
            f.depositAmount,
            fuel,
            ctd,
            medical,
            existing[0].id,
          ]
        );
      }
    } else {
      await pool.execute(
        `INSERT INTO employee_salaries
           (employee_id, component, pay_grade, pay_frequency, currency, amount, comments,
            direct_deposit, account_number, account_type, routing_number, deposit_amount,
            fuel_allowance, company_transport_deduction, medical_package)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          f.employee_id,
          f.allowancesOnly ? null : f.component,
          f.allowancesOnly ? null : f.payGrade,
          f.allowancesOnly ? null : f.payFrequency,
          f.allowancesOnly ? null : f.currency,
          f.allowancesOnly ? null : f.amount,
          f.allowancesOnly ? null : f.comments,
          f.allowancesOnly ? 0 : f.directDeposit,
          f.allowancesOnly ? null : f.accountNumber,
          f.allowancesOnly ? null : f.accountType,
          f.allowancesOnly ? null : f.routingNumber,
          f.allowancesOnly ? null : f.depositAmount,
          f.fuelAllowance ?? null,
          f.companyTransportDeduction ?? null,
          f.medicalPackage ?? null,
        ]
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Same upsert behavior as PUT
  return PUT(req);
}
