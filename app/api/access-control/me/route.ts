import { NextRequest, NextResponse } from "next/server";
import { getEmployeeAccessPayload } from "@/lib/access-control/store";
import { resolveViewerDataScope } from "@/lib/access-control/data-scope";

export const runtime = "nodejs";

/**
 * Runtime access for the logged-in employee.
 * Query: ?employeeId=96
 */
export async function GET(req: NextRequest) {
  try {
    const employeeId =
      req.nextUrl.searchParams.get("employeeId") ||
      req.nextUrl.searchParams.get("id") ||
      "";
    if (!employeeId.trim()) {
      return NextResponse.json(
        { success: false, error: "employeeId required" },
        { status: 400 },
      );
    }
    const id = employeeId.trim();
    const [payload, dataScope] = await Promise.all([
      getEmployeeAccessPayload(id),
      resolveViewerDataScope(id),
    ]);
    return NextResponse.json({
      success: true,
      ...payload,
      data_scope: dataScope,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
