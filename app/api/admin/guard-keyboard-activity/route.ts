import { NextRequest, NextResponse } from "next/server";
import { isGalleryUnlocked } from "@/lib/guard-screenshots";
import { listKeyboardActivity } from "@/lib/guard-keyboard-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin gallery (password cookie) — keyboard metrics report. */
export async function GET(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }
    const sp = req.nextUrl.searchParams;
    const result = await listKeyboardActivity({
      employeeId: sp.get("employeeId") || undefined,
      appQuery: sp.get("app") || undefined,
      search: sp.get("search") || undefined,
      dateFrom: sp.get("dateFrom") || undefined,
      dateTo: sp.get("dateTo") || undefined,
      simulationOnly:
        sp.get("simulationOnly") === "1" || sp.get("simulationOnly") === "true",
      page: parseInt(sp.get("page") || "1", 10),
      pageSize: parseInt(sp.get("pageSize") || "50", 10),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "List failed",
      },
      { status: 500 }
    );
  }
}
