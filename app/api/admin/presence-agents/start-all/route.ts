import { NextResponse } from "next/server";
import { activateAllPresenceAgents } from "@/lib/presence-agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-enable presence agents company-wide and restart running installs. */
export async function POST() {
  try {
    const { queued } = await activateAllPresenceAgents();
    return NextResponse.json({
      success: true,
      queued,
      message:
        queued > 0
          ? `Agents re-activated. Restart queued for ${queued} PC(s) within ~15s. Stopped PCs: run InteractPresence once or log in (auto-start re-enabled on next launch).`
          : "Agents re-activated. Running installs pick this up on next heartbeat; stopped PCs need one manual launch or login.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Start all failed",
      },
      { status: 500 }
    );
  }
}
