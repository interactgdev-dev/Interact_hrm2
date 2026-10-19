import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import {
  getActivityBacklogById,
  resolveActivitySavedFile,
} from "@/lib/admin-activity-log";
import { isGalleryUnlocked } from "@/lib/guard-screenshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download a file copy saved with a Backlog Tracker upload/download event. */
export async function GET(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return NextResponse.json(
        { success: false, error: "Locked", locked: true },
        { status: 401 },
      );
    }
    const id = parseInt(req.nextUrl.searchParams.get("id") || "", 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid id" },
        { status: 400 },
      );
    }
    const row = await getActivityBacklogById(id);
    if (!row?.saved_path) {
      return NextResponse.json(
        { success: false, error: "No saved file for this event" },
        { status: 404 },
      );
    }
    const resolved = resolveActivitySavedFile(String(row.saved_path));
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "Invalid saved path" },
        { status: 400 },
      );
    }
    const buf = await fs.readFile(resolved.abs);
    const name = String(row.file_name || resolved.fileName || "file.bin");
    const safe = name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180) || "file.bin";
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safe}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Download failed",
      },
      { status: 500 },
    );
  }
}
