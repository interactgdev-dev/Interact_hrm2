import { NextRequest, NextResponse } from "next/server";
import {
  listPresenceAgents,
  queueAgentCommand,
  setAgentAssignedEmployee,
  type AgentCommand,
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

/** Queue restart/exit for one agent or all registered agents. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      machine_id?: string;
      all?: boolean;
      command?: AgentCommand;
    };
    const command = body.command;
    if (command !== "restart" && command !== "exit") {
      return NextResponse.json(
        { success: false, error: "command must be restart or exit" },
        { status: 400 }
      );
    }
    const count = await queueAgentCommand({
      machineId: body.machine_id,
      all: !!body.all,
      command,
    });
    return NextResponse.json({
      success: true,
      queued: count,
      command,
      message:
        command === "exit"
          ? `Exit queued for ${count} agent(s). Takes effect within ~15s.`
          : `Restart queued for ${count} agent(s). Takes effect within ~15s.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Command failed",
      },
      { status: 400 }
    );
  }
}
