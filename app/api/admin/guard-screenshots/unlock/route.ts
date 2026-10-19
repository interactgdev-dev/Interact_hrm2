import { NextRequest, NextResponse } from "next/server";
import {
  GALLERY_COOKIE,
  GALLERY_COOKIE_MAX_AGE,
  galleryPassword,
} from "@/lib/guard-screenshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const password = String(
      (body as { password?: string }).password || ""
    );
    if (password !== galleryPassword()) {
      return NextResponse.json(
        { success: false, error: "Invalid password" },
        { status: 401 }
      );
    }
    const res = NextResponse.json({ success: true, unlocked: true });
    res.cookies.set(GALLERY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: GALLERY_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unlock failed",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { isGalleryUnlocked } = await import("@/lib/guard-screenshots");
  return NextResponse.json({
    success: true,
    unlocked: isGalleryUnlocked(req),
  });
}

export async function DELETE() {
  const res = NextResponse.json({ success: true, unlocked: false });
  res.cookies.set(GALLERY_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
