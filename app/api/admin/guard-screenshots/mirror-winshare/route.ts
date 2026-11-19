import { NextRequest, NextResponse } from "next/server";
import {
  isGalleryUnlocked,
} from "@/lib/guard-screenshots";
import {
  backfillScreenshotsToWinshare,
  isWinshareMirrorEnabled,
  winshareMirrorRoot,
} from "@/lib/guard-screenshot-winshare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — slowly copy existing local screenshots onto winshare (ops/test).
 * Requires gallery unlock cookie. Does not block ordinary uploads.
 */
export async function POST(req: NextRequest) {
  if (!isGalleryUnlocked(req)) {
    return NextResponse.json(
      { success: false, error: "gallery locked" },
      { status: 401 },
    );
  }
  if (!isWinshareMirrorEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GUARD_SCREENSHOT_WINSHARE_DIR not set (e.g. /root/winshare/guard-screenshots)",
      },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const limit = Number((body as { limit?: number })?.limit) || 5000;

  // Run backfill without blocking the HTTP worker forever — still sync but paced.
  const result = await backfillScreenshotsToWinshare({ limit });
  return NextResponse.json({
    success: true,
    root: winshareMirrorRoot(),
    ...result,
  });
}

export async function GET(req: NextRequest) {
  if (!isGalleryUnlocked(req)) {
    return NextResponse.json(
      { success: false, error: "gallery locked" },
      { status: 401 },
    );
  }
  return NextResponse.json({
    success: true,
    enabled: isWinshareMirrorEnabled(),
    root: winshareMirrorRoot() || null,
  });
}
