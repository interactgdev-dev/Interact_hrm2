import { NextResponse } from "next/server";
import { backfillLeavesFromTickets } from "@/lib/leave-ticket-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Force sync leave tickets → employee_leaves (approved Leave status for attendance). */
export async function POST() {
  try {
    const synced = await backfillLeavesFromTickets({ force: true });
    return NextResponse.json({ success: true, synced });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Sync failed",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
