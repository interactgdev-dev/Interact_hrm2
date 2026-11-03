import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

function parseMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseUnpaidDays(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** GET ?month=YYYY-MM — load payroll adjustments for month */
export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get("month");
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ success: false, error: "month (YYYY-MM) is required" }, { status: 400 });
    }

    const connection = await pool.getConnection();
    try {
      const [rows]: any = await connection.query(
        `SELECT employee_id, month, ctd, fuel_allowance, unpaid_days, medical_claims
         FROM monthly_payroll_adjustments
         WHERE month = ?
         ORDER BY employee_id ASC`,
        [month]
      );
      return NextResponse.json({ success: true, adjustments: rows || [] });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("monthly-payroll-adjustments GET:", error);
    return NextResponse.json({ success: false, error: "Failed to load adjustments" }, { status: 500 });
  }
}

/**
 * POST { month, clear_unpaid_days: true }
 * Clears saved unpaid_days overrides for the month (T.Unpaid falls back to attendance).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const month = String(body.month ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(month) || body.clear_unpaid_days !== true) {
      return NextResponse.json(
        { success: false, error: "month and clear_unpaid_days: true required" },
        { status: 400 },
      );
    }
    const connection = await pool.getConnection();
    try {
      const [result]: any = await connection.query(
        `UPDATE monthly_payroll_adjustments SET unpaid_days = NULL WHERE month = ?`,
        [month],
      );
      return NextResponse.json({
        success: true,
        month,
        cleared: result?.affectedRows ?? 0,
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("monthly-payroll-adjustments POST clear:", error);
    return NextResponse.json({ success: false, error: "Failed to clear unpaid days" }, { status: 500 });
  }
}

/**
 * PUT { employee_id, month, ctd?, fuel_allowance?, unpaid_days?, medical_claims? }
 * Upserts; only provided fields are overwritten (others kept).
 * NULL ctd / fuel_allowance / unpaid_days / medical_claims in DB = not set (UI uses defaults).
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const employeeId = String(body.employee_id ?? "").trim();
    const month = String(body.month ?? "").trim();
    const hasCtd = Object.prototype.hasOwnProperty.call(body, "ctd");
    const hasFuel = Object.prototype.hasOwnProperty.call(body, "fuel_allowance");
    const hasUnpaid = Object.prototype.hasOwnProperty.call(body, "unpaid_days");
    const hasClaims = Object.prototype.hasOwnProperty.call(body, "medical_claims");

    if (!employeeId || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: "employee_id and month (YYYY-MM) are required" },
        { status: 400 }
      );
    }
    if (!hasCtd && !hasFuel && !hasUnpaid && !hasClaims) {
      return NextResponse.json(
        {
          success: false,
          error: "Provide ctd, fuel_allowance, unpaid_days, and/or medical_claims",
        },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();
    try {
      const [existingRows]: any = await connection.query(
        `SELECT ctd, fuel_allowance, unpaid_days, medical_claims FROM monthly_payroll_adjustments
         WHERE employee_id = ? AND month = ? LIMIT 1`,
        [employeeId, month]
      );
      const existing = existingRows?.[0];
      const ctd = hasCtd
        ? parseMoney(body.ctd)
        : existing
          ? existing.ctd
          : null;
      const fuelAllowance = hasFuel
        ? parseMoney(body.fuel_allowance)
        : existing
          ? existing.fuel_allowance
          : null;
      // null / "" clears override so Monthly Payroll uses attendance-based T.Unpaid Days.
      const unpaidDays = hasUnpaid
        ? body.unpaid_days === null || body.unpaid_days === ""
          ? null
          : parseUnpaidDays(body.unpaid_days)
        : existing
          ? existing.unpaid_days
          : null;
      const medicalClaims = hasClaims
        ? parseMoney(body.medical_claims)
        : existing
          ? existing.medical_claims
          : null;

      await connection.query(
        `INSERT INTO monthly_payroll_adjustments
           (employee_id, month, ctd, fuel_allowance, unpaid_days, medical_claims)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           ctd = VALUES(ctd),
           fuel_allowance = VALUES(fuel_allowance),
           unpaid_days = VALUES(unpaid_days),
           medical_claims = VALUES(medical_claims)`,
        [employeeId, month, ctd, fuelAllowance, unpaidDays, medicalClaims]
      );
      return NextResponse.json({
        success: true,
        employee_id: employeeId,
        month,
        ctd,
        fuel_allowance: fuelAllowance,
        unpaid_days: unpaidDays,
        medical_claims: medicalClaims,
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("monthly-payroll-adjustments PUT:", error);
    return NextResponse.json({ success: false, error: "Failed to save adjustment" }, { status: 500 });
  }
}
