import { NextResponse } from "next/server";
import { listOrgCeoEmployees } from "@/lib/dept-heads";

/** Joe / Max / Mubeen — Reporting Manager options for Manager / Team Lead. */
export async function GET() {
  try {
    const ceos = await listOrgCeoEmployees();
    return NextResponse.json({ success: true, ceos });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
