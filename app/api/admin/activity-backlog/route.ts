import { NextRequest, NextResponse } from "next/server";
import { isGalleryUnlocked } from "@/lib/guard-screenshots";
import { listActivityBacklog } from "@/lib/admin-activity-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Backlog Tracker list — same unlock cookie/password as Screenshots gallery. */
export async function GET(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 },
      );
    }
    const sp = req.nextUrl.searchParams;
    const result = await listActivityBacklog({
      search: sp.get("search") || undefined,
      eventType: sp.get("type") || undefined,
      employeeId: sp.get("employeeId") || undefined,
      dateFrom: sp.get("dateFrom") || undefined,
      dateTo: sp.get("dateTo") || undefined,
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
      { status: 500 },
    );
  }
}
