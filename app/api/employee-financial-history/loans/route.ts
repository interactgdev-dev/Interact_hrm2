import { NextRequest, NextResponse } from "next/server";
import { fetchLoansWithInstallments } from "@/lib/employee-financial-history";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeIdRaw = searchParams.get("employee_id");
    const year = searchParams.get("year") || undefined;
    const employeeId =
      employeeIdRaw && /^\d+$/.test(employeeIdRaw) ? Number(employeeIdRaw) : undefined;

    const loans = await fetchLoansWithInstallments({ employeeId, year });
    return NextResponse.json({ success: true, records: loans });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
