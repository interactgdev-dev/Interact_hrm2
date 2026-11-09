import { NextRequest, NextResponse } from "next/server";
import { ingestAppActivity } from "@/lib/guard-app-activity";
import { scanAppActivityForPolicyAlerts } from "@/lib/guard-keyword-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dec(raw: string | null) {
  const v = String(raw || "").trim();
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Public: Guard agent posts foreground app + window title (no keystrokes). */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const employeeId =
      String(body.employee_id ?? "").trim() ||
      dec(req.headers.get("x-employee-id"));
    const appName = String(body.app_name ?? body.appName ?? "").trim();
    if (!employeeId || !appName) {
      return NextResponse.json(
        { success: false, error: "employee_id and app_name required" },
        { status: 400 }
      );
    }

    let at: Date | undefined;
    const captured =
      String(body.captured_at ?? "").trim() ||
      dec(req.headers.get("x-captured-at"));
    if (captured) {
      const d = new Date(captured);
      if (!Number.isNaN(d.getTime())) at = d;
    }

    const employeeName =
      String(body.employee_name ?? "").trim() ||
      dec(req.headers.get("x-employee-name")) ||
      null;
    const pseudonym =
      String(body.pseudonym ?? "").trim() ||
      dec(req.headers.get("x-pseudonym")) ||
      null;
    const appPath = String(body.app_path ?? "").trim() || null;
    const caption =
      String(body.caption ?? body.window_title ?? "").trim() || null;

    const row = await ingestAppActivity({
      employeeId,
      employeeName,
      pseudonym,
      machineId:
        String(body.machine_id ?? "").trim() ||
        dec(req.headers.get("x-machine-id")) ||
        null,
      hostname: String(body.hostname ?? "").trim() || null,
      windowsUser: String(body.windows_user ?? "").trim() || null,
      appName,
      appPath,
      caption,
      at,
    });

    void scanAppActivityForPolicyAlerts({
      employeeId,
      employeeName,
      pseudonym,
      appName,
      appPath,
      caption,
    }).then((result) => {
      if (!result.ok) {
        console.warn("[guard/app-activity] policy watch failed:", result.error);
        return;
      }
      if (!result.skipped) {
        console.log(
          "[guard/app-activity] policy ticket",
          result.ticketNumber,
          result.kind,
          result.matched
        );
      }
    });

    return NextResponse.json({ success: true, row });
  } catch (err) {
    console.error("[guard/app-activity] ingest failed", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Ingest failed",
      },
      { status: 500 }
    );
  }
}
