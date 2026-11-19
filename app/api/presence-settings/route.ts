import { NextResponse } from "next/server";
import { getPresenceSettings } from "@/lib/presence-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public read for desktop presence agent (no secrets beyond exit PIN).
 * Agent polls this to apply admin-configured idle / camera settings.
 */
export async function GET() {
  try {
    const settings = await getPresenceSettings();
    return NextResponse.json(
      {
        success: true,
        settings: {
          agentsRetired: settings.agentsRetired,
          presenceEnabled: settings.presenceEnabled,
          idleWarningSeconds: settings.idleWarningSeconds,
          popupCountdownSeconds: settings.popupCountdownSeconds,
          cameraVerificationEnabled: settings.cameraVerificationEnabled,
          recheckWhileIdleSeconds: settings.recheckWhileIdleSeconds,
          agentExitPassword: settings.agentExitPassword,
          enabledEmployeeIds: settings.enabledEmployeeIds,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load settings",
      },
      { status: 500 }
    );
  }
}
