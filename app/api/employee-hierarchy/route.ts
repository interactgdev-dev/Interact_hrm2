import { NextRequest, NextResponse } from "next/server";
import {
  getEmployeeHierarchy,
  setEmployeeReportsTo,
} from "@/lib/employee-hierarchy-table";

export async function GET(req: NextRequest) {
  try {
    const employeeId = new URL(req.url).searchParams.get("employeeId");
    if (!employeeId?.trim()) {
      return NextResponse.json(
        { success: false, error: "employeeId required" },
        { status: 400 },
      );
    }

    const hierarchy = await getEmployeeHierarchy(employeeId.trim());
    if (!hierarchy) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, ...hierarchy });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** Set Reporting Manager (Manager / Team Lead → CEO). */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const employeeId = String(body?.employeeId || body?.employee_id || "").trim();
    const reportsToRaw =
      body?.reportsToEmployeeId ??
      body?.reports_to_employee_id ??
      body?.reportsTo ??
      null;
    if (!employeeId || !/^\d+$/.test(employeeId)) {
      return NextResponse.json(
        { success: false, error: "employeeId required" },
        { status: 400 },
      );
    }
    const reportsTo =
      reportsToRaw == null || String(reportsToRaw).trim() === ""
        ? null
        : String(reportsToRaw).trim();
    if (reportsTo != null && !/^\d+$/.test(reportsTo)) {
      return NextResponse.json(
        { success: false, error: "Invalid reporting manager id" },
        { status: 400 },
      );
    }
    const result = await setEmployeeReportsTo(employeeId, reportsTo);
    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
