import { NextRequest, NextResponse } from "next/server";
import {
  listLiveFrames,
  readLiveSession,
  requireGallery,
  startLiveSession,
  stopLiveSession,
  touchLiveSession,
} from "@/lib/guard-live";

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
    let current = await readLiveSession();
    if (current.active) {
      const focusParam = req.nextUrl.searchParams.get("focus");
      current = await touchLiveSession({
        focusEmployeeId:
          focusParam === null
            ? undefined
            : focusParam.trim()
              ? focusParam.trim()
              : null,
      });
    }
    const frames = current.active ? await listLiveFrames() : [];
    return NextResponse.json({
      success: true,
      session: current,
      frames,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed",
      },
      { status: 500 }
    );
  }
}

/** Start live session (all agents begin streaming). */
export async function POST(req: NextRequest) {
  try {
    if (!requireGallery(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }
    const session = await startLiveSession();
    return NextResponse.json({ success: true, session });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed",
      },
      { status: 500 }
    );
  }
}

/** Stop live session. */
export async function DELETE(req: NextRequest) {
  try {
    if (!requireGallery(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }
    const session = await stopLiveSession();
    return NextResponse.json({ success: true, session });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed",
      },
      { status: 500 }
    );
  }
}
