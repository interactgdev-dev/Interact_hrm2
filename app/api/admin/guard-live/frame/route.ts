import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { requireGallery, resolveLiveFramePath, touchLiveSession } from "@/lib/guard-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!requireGallery(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }
    const employeeId = String(req.nextUrl.searchParams.get("employeeId") || "").trim();
    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId required" },
        { status: 400 }
      );
    }
    await touchLiveSession();
    const abs = await resolveLiveFramePath(employeeId);
    const buf = await fs.readFile(abs);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // Short cache keyed by ?v=updatedAt — stops mid-load blank blinks.
        "Cache-Control": "private, max-age=2",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Not found";
    const status = msg === "Not found" || msg === "Invalid path" ? 404 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
