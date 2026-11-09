import { NextRequest, NextResponse } from "next/server";
import {
  findForbiddenKeyboardFields,
  ingestKeyboardActivity,
  parseSimulationEvents,
  type KeyboardActivitySegment,
} from "@/lib/guard-keyboard-activity";

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

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Guard agent posts aggregated keyboard metrics (counts + durations).
 * Optional TEST/SIMULATION: is_simulation=true + simulation_events (synthetic tokens only).
 * Rejects real typed-text / key-code capture fields.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const forbidden = findForbiddenKeyboardFields(body);
    if (forbidden.length) {
      return NextResponse.json(
        {
          success: false,
          error: `Forbidden fields (metrics only): ${forbidden.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const isSimulation =
      body.is_simulation === true ||
      body.isSimulation === true ||
      String(body.mode ?? "").toUpperCase() === "TEST_SIMULATION";

    const employeeId =
      String(body.employee_id ?? body.employeeId ?? "").trim() ||
      dec(req.headers.get("x-employee-id"));
    const batchId = String(body.batch_id ?? body.batchId ?? "").trim();
    if (!employeeId || !batchId) {
      return NextResponse.json(
        { success: false, error: "employee_id and batch_id required" },
        { status: 400 }
      );
    }

    const periodStart =
      parseDate(body.period_start ?? body.periodStart) ||
      parseDate(dec(req.headers.get("x-period-start")));
    const periodEnd =
      parseDate(body.period_end ?? body.periodEnd) ||
      parseDate(dec(req.headers.get("x-period-end")));
    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { success: false, error: "period_start and period_end required" },
        { status: 400 }
      );
    }

    const rawSegs = Array.isArray(body.segments) ? body.segments : [];
    if (!rawSegs.length) {
      return NextResponse.json(
        { success: false, error: "segments required" },
        { status: 400 }
      );
    }

    const segments: KeyboardActivitySegment[] = [];
    for (const raw of rawSegs) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const appName = String(s.app_name ?? s.appName ?? "").trim();
      if (!appName) continue;

      const hasSimPayload =
        s.simulation_events != null ||
        s.simulationEvents != null ||
        s.simulation_sequence != null ||
        s.simulationSequence != null;
      if (hasSimPayload && !isSimulation) {
        return NextResponse.json(
          {
            success: false,
            error: "simulation_events require is_simulation=true",
          },
          { status: 400 }
        );
      }

      const simEvents = isSimulation
        ? parseSimulationEvents(
            s.simulation_events ?? s.simulationEvents,
            appName
          )
        : null;

      segments.push({
        appName,
        appPath: String(s.app_path ?? s.appPath ?? "").trim() || null,
        keyDownCount: Number(s.key_down_count ?? s.keyDownCount ?? 0) || 0,
        typingActiveMs: Number(s.typing_active_ms ?? s.typingActiveMs ?? 0) || 0,
        keyboardIdleMs: Number(s.keyboard_idle_ms ?? s.keyboardIdleMs ?? 0) || 0,
        simulationEvents: simEvents,
        simulationSequence: isSimulation
          ? String(s.simulation_sequence ?? s.simulationSequence ?? "").trim() ||
            null
          : null,
      });
    }
    if (!segments.length) {
      return NextResponse.json(
        { success: false, error: "no valid segments" },
        { status: 400 }
      );
    }

    const result = await ingestKeyboardActivity({
      batchId,
      employeeId,
      isSimulation,
      employeeName:
        String(body.employee_name ?? body.employeeName ?? "").trim() ||
        dec(req.headers.get("x-employee-name")) ||
        null,
      pseudonym:
        String(body.pseudonym ?? "").trim() ||
        dec(req.headers.get("x-pseudonym")) ||
        null,
      machineId:
        String(body.machine_id ?? body.machineId ?? "").trim() ||
        dec(req.headers.get("x-machine-id")) ||
        null,
      hostname: String(body.hostname ?? "").trim() || null,
      windowsUser:
        String(body.windows_user ?? body.windowsUser ?? "").trim() || null,
      periodStart,
      periodEnd,
      segments,
    });

    return NextResponse.json({
      success: true,
      is_simulation: isSimulation,
      ...result,
    });
  } catch (err) {
    console.error("[guard/keyboard-activity] ingest failed", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Ingest failed",
      },
      { status: 500 }
    );
  }
}
