import { NextRequest, NextResponse } from "next/server";
import { readLiveSession, saveLiveFrame } from "@/lib/guard-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function dec(raw: string | null) {
  const v = String(raw || "").trim();
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await readLiveSession();
    if (!session.active) {
      return NextResponse.json(
        { success: false, error: "Live session inactive", inactive: true },
        { status: 409 }
      );
    }

    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (
      !ct.includes("image/jpeg") &&
      !ct.includes("image/jpg") &&
      !ct.includes("application/octet-stream")
    ) {
      return NextResponse.json(
        { success: false, error: "image/jpeg required" },
        { status: 400 }
      );
    }

    const ab = await req.arrayBuffer();
    const bytes = Buffer.from(ab);
    if (bytes.length <= 0 || bytes.length > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "frame size invalid" },
        { status: 400 }
      );
    }
    if (!isJpeg(bytes)) {
      return NextResponse.json(
        { success: false, error: "JPEG required" },
        { status: 400 }
      );
    }

    const employeeId = dec(req.headers.get("x-employee-id"));
    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employee_id required" },
        { status: 400 }
      );
    }

    const meta = await saveLiveFrame({
      employeeId,
      bytes,
      name: dec(req.headers.get("x-employee-name")),
      pseudonym: dec(req.headers.get("x-pseudonym")),
    });

    return NextResponse.json({ success: true, meta });
  } catch (err) {
    console.error("[guard/live-frame] failed", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Upload failed",
      },
      { status: 500 }
    );
  }
}
