import { NextRequest, NextResponse } from "next/server";
import { getEmployeeLeaveBalance } from "@/lib/leave-balance";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employee_id = searchParams.get("employee_id");
    if (!employee_id) {
      return NextResponse.json({
        success: false,
        error: "employee_id is required",
      });
    }

    const result = await getEmployeeLeaveBalance(employee_id);
    if (!result.success) {
      return NextResponse.json(result);
    }

    return NextResponse.json({
      success: true,
      employee_id: result.employee_id,
      employment_status: result.employment_status,
      gender: result.gender,
      probationEndsOn: null,
      leaveCycleStart: result.leaveCycleStart,
      usedLeave: result.usedLeave,
      totalUsedDays: result.totalUsedDays,
      annualBalance: result.annualBalance,
      annualAllowance: result.annualAllowance,
      bereavementBalance: result.bereavementBalance,
      bereavementAllowance: 3,
      maternityBalance: result.maternityBalance,
      maternityAllowance: result.maternityAllowance,
      paternityBalance: result.paternityBalance,
      paternityAllowance: result.paternityAllowance,
      annualBalanceAdjustment: result.annualBalanceAdjustment,
      bereavementBalanceAdjustment: result.bereavementBalanceAdjustment,
      maternityBalanceAdjustment: result.maternityBalanceAdjustment,
      paternityBalanceAdjustment: result.paternityBalanceAdjustment,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
