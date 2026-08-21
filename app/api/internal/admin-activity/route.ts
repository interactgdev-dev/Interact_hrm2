import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_ACTOR_COOKIE,
  appendAdminActivity,
  backupAdminActivityFile,
} from "@/lib/admin-activity-log";

export const runtime = "nodejs";

function actorFrom(req: NextRequest, bodyLogin?: string) {
  const cookie = req.cookies.get(ADMIN_ACTOR_COOKIE)?.value?.trim();
  const header = req.headers.get("x-login-id")?.trim();
  const body = String(bodyLogin || "").trim();
  return cookie || header || body || "unknown";
}

function clientMeta(req: NextRequest) {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
    ua: req.headers.get("user-agent") || null,
  };
}

/** Silent admin activity sink — no UI; writes daily JSONL on the server. */
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const loginId = actorFrom(req, String(form.get("loginId") || ""));
      const type = String(form.get("type") || "file_upload");
      const page = String(form.get("page") || "");
      const label = String(form.get("label") || "");
      const file = form.get("file");
      const meta = clientMeta(req);
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const f = file as File;
        const buf = Buffer.from(await f.arrayBuffer());
        await backupAdminActivityFile(f.name || "upload.bin", buf, {
          type,
          loginId,
          page,
          label,
          mime: f.type || null,
          ...meta,
        });
      } else {
        await appendAdminActivity({
          type,
          loginId,
          page,
          label,
          ...meta,
        });
      }
      return new NextResponse(null, { status: 204 });
    }

    const body = await req.json().catch(() => ({}));
    const events = Array.isArray(body?.events)
      ? body.events
      : body?.type
        ? [body]
        : [];
    const loginId = actorFrom(req, body?.loginId);
    const meta = clientMeta(req);
    let clearCookie = false;
    for (const ev of events) {
      if (!ev || typeof ev !== "object") continue;
      const type = String((ev as { type?: string }).type || "");
      if (type === "admin_logout") clearCookie = true;
      await appendAdminActivity({
        ...ev,
        loginId: String((ev as { loginId?: string }).loginId || loginId),
        ...meta,
      });
    }
    const res = new NextResponse(null, { status: 204 });
    if (clearCookie) {
      res.cookies.set(ADMIN_ACTOR_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
    return res;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
