import { NextRequest, NextResponse } from "next/server";
import { isAdminLoginId, verifyAdminPassword } from "@/lib/admin-settings";
import {
  ADMIN_ACTOR_COOKIE,
  appendAdminActivity,
} from "@/lib/admin-activity-log";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const loginId = String(body.loginId || "").trim();
    const password = String(body.password || "");
    if (!isAdminLoginId(loginId)) {
      return NextResponse.json({ success: false, error: "Not an admin account." }, { status: 401 });
    }
    const ok = await verifyAdminPassword(password);
    if (!ok) {
      return NextResponse.json({ success: false, error: "Invalid credentials." }, { status: 401 });
    }
    const res = NextResponse.json({ success: true });
    res.cookies.set(ADMIN_ACTOR_COOKIE, loginId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    void appendAdminActivity({
      type: "admin_login",
      loginId,
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null,
      ua: req.headers.get("user-agent") || null,
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Login failed" },
      { status: 500 }
    );
  }
}
