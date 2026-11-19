import { NextRequest, NextResponse } from "next/server";
import { findOpenSessionBreak } from "@/lib/open-session-break";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guard agent: is employee on an open break / prayer / refreshment / meeting?
 * Only counts rows that actually started (start IS NOT NULL) and have not ended.
 * GET ?employeeId=
 */
export async function GET(req: NextRequest) {
  try {
    const employeeId = String(
      new URL(req.url).searchParams.get("employeeId") || "",
    ).trim();
    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId required" },
        { status: 400 },
      );
    }

    const { active, kind } = await findOpenSessionBreak(employeeId);
    return NextResponse.json({ success: true, active, kind });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Check failed",
      },
      { status: 500 },
    );
  }
}
