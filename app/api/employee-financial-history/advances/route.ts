import { NextRequest, NextResponse } from "next/server";
import { fetchAdvances } from "@/lib/employee-financial-history";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeIdRaw = searchParams.get("employee_id");
    const year = searchParams.get("year") || undefined;
    const monthFrom = searchParams.get("month_from") || undefined;
    const monthTo = searchParams.get("month_to") || undefined;
    const employeeId =
      employeeIdRaw && /^\d+$/.test(employeeIdRaw) ? Number(employeeIdRaw) : undefined;

    const advances = await fetchAdvances({
      employeeId,
      year,
      monthFrom,
      monthTo,
    });

    return NextResponse.json({
      success: true,
      records: advances.map((a) => ({ ...a, amount: Number(a.amount) || 0 })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
