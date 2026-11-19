import { NextRequest, NextResponse } from "next/server";
import {
  computeMonthlyFinalSalaries,
  upsertMonthlyFinalSalaries,
} from "@/lib/monthly-payroll-final-salary";

/**
 * GET ?month=YYYY-MM
 * Returns Final Salary map for the month (synced snapshot preferred, else computed).
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
    const map = await computeMonthlyFinalSalaries(month);
    return NextResponse.json({ success: true, month, final_salaries: map });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST { month, rows: [{ employee_id, final_salary }], viewer_id? }
 * Snapshot exact Monthly Payroll Final Salary values (incl. OT / on-screen overrides).
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
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const viewerRaw =
      body.viewer_id ??
      req.headers.get("x-hrm-employee-id") ??
      req.headers.get("x-employee-id") ??
      "";
    const viewerId = /^\d+$/.test(String(viewerRaw).trim())
      ? Number(viewerRaw)
      : null;

    const normalized = rows
      .map((r: any) => ({
        employee_id: Number(r.employee_id),
        final_salary: Number(r.final_salary),
      }))
      .filter(
        (r: { employee_id: number; final_salary: number }) =>
          Number.isFinite(r.employee_id) &&
          r.employee_id > 0 &&
          Number.isFinite(r.final_salary) &&
          r.final_salary >= 0,
      );

    const saved = await upsertMonthlyFinalSalaries(
      month,
      normalized,
      viewerId,
      "monthly_payroll",
    );

    return NextResponse.json({
      success: true,
      month,
      saved,
      message: `Saved ${saved} final salary row(s) for ${month}.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
