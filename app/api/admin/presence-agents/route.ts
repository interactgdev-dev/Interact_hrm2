import { NextRequest, NextResponse } from "next/server";
import {
  listPresenceAgents,
  setAgentAssignedEmployee,
} from "@/lib/presence-agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agents = await listPresenceAgents();
    const summary = {
      total: agents.length,
      healthy: agents.filter((a) => a.health === "healthy").length,
      stale: agents.filter((a) => a.health === "stale").length,
      offline: agents.filter((a) => a.health === "offline").length,
      withAssignedId: agents.filter((a) => a.assignedEmployeeId).length,
      withLocalId: agents.filter((a) => a.localEmployeeId).length,
    };
    return NextResponse.json({ success: true, agents, summary });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load agents",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      machine_id?: string;
      assigned_employee_id?: string | null;
    };
    const machineId = String(body.machine_id ?? "").trim();
    if (!machineId) {
      return NextResponse.json(
        { success: false, error: "machine_id required" },
        { status: 400 }
      );
    }

    const assignedRaw = body.assigned_employee_id;
    const assigned =
      assignedRaw === null || assignedRaw === undefined || assignedRaw === ""
        ? null
        : String(assignedRaw).trim();

    const agent = await setAgentAssignedEmployee(machineId, assigned);
    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, agent });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Update failed",
      },
      { status: 400 }
    );
  }
}
