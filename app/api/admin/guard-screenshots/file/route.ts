import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import {
  isGalleryUnlocked,
  resolveScreenshotFile,
} from "@/lib/guard-screenshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }

    const rel = String(req.nextUrl.searchParams.get("path") || "").trim();
    const download =
      req.nextUrl.searchParams.get("download") === "1" ||
      req.nextUrl.searchParams.get("download") === "true";

    if (!rel) {
      return NextResponse.json(
        { success: false, error: "path required" },
        { status: 400 }
      );
    }

    const abs = await resolveScreenshotFile(rel);
    const buf = await fs.readFile(abs);
    const fileName = path.basename(abs);
    const lower = fileName.toLowerCase();
    const contentType =
      lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : "image/png";

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Short private cache so flipping pages feels snappy; files stay on disk.
        "Cache-Control": download
          ? "private, no-store"
          : "private, max-age=120",
        "Content-Disposition": download
          ? `attachment; filename="${fileName}"`
          : `inline; filename="${fileName}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Not found";
    const status = msg === "Not found" || msg === "Invalid path" ? 404 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
