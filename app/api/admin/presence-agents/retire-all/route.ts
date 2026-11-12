import { NextResponse } from "next/server";
import { retireAllPresenceAgents } from "@/lib/presence-agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Permanently shut down all desktop presence agents company-wide. */
export async function POST() {
  try {
    const { queued } = await retireAllPresenceAgents();
    return NextResponse.json({
      success: true,
      queued,
      message:
        queued > 0
          ? `Permanent shutdown enabled. Exit queued for ${queued} agent(s); others exit on next heartbeat or login. Publish agent 0.5.2+ for auto-start removal.`
          : "Permanent shutdown enabled. Agents will exit on next heartbeat or login (publish agent 0.5.2+).",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Retire failed",
      },
      { status: 500 }
    );
  }
}
