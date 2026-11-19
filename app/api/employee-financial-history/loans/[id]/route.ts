import { NextRequest, NextResponse } from "next/server";
import { fetchLoansWithInstallments } from "@/lib/employee-financial-history";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const params = await Promise.resolve(context.params);
    const loanId = Number(params.id);
    if (!Number.isFinite(loanId) || loanId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid loan id" }, { status: 400 });
    }

    const loans = await fetchLoansWithInstallments({ loanId });
    if (loans.length === 0) {
      return NextResponse.json({ success: false, message: "Loan not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, loan: loans[0] });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
