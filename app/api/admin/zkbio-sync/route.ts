import { NextRequest, NextResponse } from "next/server";
import { runZkbioSync } from "@/lib/zkbio-sync-runner";

export const runtime = "nodejs";

const MAX_OUT = 24_000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.ZKBIO_SYNC_CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

/**
 * POST /api/admin/zkbio-sync
 * Header: Authorization: Bearer <ZKBIO_SYNC_CRON_SECRET>
 * Body (optional JSON): { "start": "2025-12-02 00:00:00", "end": "2026-03-24 23:59:59" }
 *
 * .env.local:
 *   ZKBIO_SYNC_CRON_SECRET=your-long-random-secret
 * Optional: ZKBIO_PYTHON=C:\\Path\\to\\python.exe
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    if (!process.env.ZKBIO_SYNC_CRON_SECRET?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Set ZKBIO_SYNC_CRON_SECRET in .env.local and send Authorization: Bearer <that value>.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let start: string | undefined;
  let end: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object") {
      if (typeof (body as { start?: unknown }).start === "string") start = (body as { start: string }).start;
      if (typeof (body as { end?: unknown }).end === "string") end = (body as { end: string }).end;
    }
  } catch {
    /* empty body */
  }

  const { code, stdout, stderr } = await runZkbioSync(
    start && end ? { start, end } : undefined,
  );

  const ok = code === 0;
  const clip = (s: string) => (s.length > MAX_OUT ? s.slice(-MAX_OUT) : s);

  return NextResponse.json({
    success: ok,
    exitCode: code,
    stdout: clip(stdout),
    stderr: clip(stderr),
  }, { status: ok ? 200 : 500 });
}
