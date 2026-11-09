import { NextRequest, NextResponse } from "next/server";
import { viewerHasFinancePayrollPowers } from "@/lib/access-control/hr-access";
import { getEmployeeAccessPayload } from "@/lib/access-control/store";
import {
  markMonthDeductionsPaid,
  markMonthDeductionsPaidForAll,
  reconcileLegacyFinancialHistory,
} from "@/lib/employee-financial-history";

/**
 * POST { month: "YYYY-MM", employee_id?: number, viewer_id?: number }
 * Finance department / Finance Manager / finance payroll pack — marks advance + loan Paid.
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

    const viewerRaw =
      body.viewer_id ??
      req.headers.get("x-hrm-employee-id") ??
      req.headers.get("x-employee-id") ??
      "";
    const viewerId = String(viewerRaw || "").trim();
    if (!/^\d+$/.test(viewerId)) {
      return NextResponse.json(
        {
          success: false,
          message: "Finance employee login required to mark Loan/Advance Paid.",
        },
        { status: 403 },
      );
    }

    let allowed = false;
    try {
      const access = await getEmployeeAccessPayload(viewerId);
      allowed = viewerHasFinancePayrollPowers({
        departmentName: access.departmentName,
        roleSlugs: access.role?.slugs || [],
        permissions: access.permissions || [],
      });
    } catch {
      allowed = false;
    }

    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Only Finance department / Finance Manager can mark Loan/Advance as Paid.",
        },
        { status: 403 },
      );
    }

    await reconcileLegacyFinancialHistory();

    const employeeIdRaw = body.employee_id;
    if (employeeIdRaw != null && String(employeeIdRaw).trim() !== "") {
      const employeeId = Number(employeeIdRaw);
      if (!Number.isFinite(employeeId) || employeeId <= 0) {
        return NextResponse.json(
          { success: false, message: "Invalid employee_id" },
          { status: 400 },
        );
      }
      const result = await markMonthDeductionsPaid(employeeId, month);
      return NextResponse.json({
        success: true,
        month,
        employee_id: employeeId,
        marked_by: Number(viewerId),
        ...result,
        message: `Advance + loan installment for ${month} marked Paid on Loan page, Advance page, and Financial History.`,
      });
    }

    const result = await markMonthDeductionsPaidForAll(month);
    return NextResponse.json({
      success: true,
      month,
      marked_by: Number(viewerId),
      ...result,
      message: `${month}: ${result.advances_marked} advance(s) + ${result.loans_marked} loan installment(s) marked Paid (Loan page, Advance page, Financial History).`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
