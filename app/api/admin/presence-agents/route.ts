import { NextRequest, NextResponse } from "next/server";
import {
  deleteAllPresenceAgents,
  deletePresenceAgent,
  listPresenceAgents,
  queueAgentCommand,
  setAgentAdminEnabled,
  setAgentAssignedEmployee,
  setAgentIdleSeconds,
  unlockAgentAssignment,
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
      adminOn: agents.filter((a) => a.adminEnabled).length,
      guardAgents: agents.filter(
        (a) => (a.agentProduct || "").toLowerCase().includes("guard"),
      ).length,
    };
    return NextResponse.json({ success: true, agents, summary });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load agents",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      machine_id?: string;
      assigned_employee_id?: string | null;
      hrm_base_url?: string | null;
      admin_enabled?: boolean;
      idle_seconds?: number;
      unlock?: boolean;
    };
    const machineId = String(body.machine_id ?? "").trim();
    if (!machineId) {
      return NextResponse.json(
        { success: false, error: "machine_id required" },
        { status: 400 },
      );
    }

    let agent = null;

    if (body.unlock === true) {
      agent = await unlockAgentAssignment(machineId);
    }

    if (body.assigned_employee_id !== undefined) {
      const assignedRaw = body.assigned_employee_id;
      const assigned =
        assignedRaw === null || assignedRaw === ""
          ? null
          : String(assignedRaw).trim();
      agent = await setAgentAssignedEmployee(machineId, assigned, {
        hrmBaseUrl:
          body.hrm_base_url !== undefined ? body.hrm_base_url : undefined,
      });
    } else if (body.hrm_base_url !== undefined) {
      // URL-only save still goes through assign helper when unlocked
      const current = await listPresenceAgents();
      const row = current.find((a) => a.machineId === machineId);
      agent = await setAgentAssignedEmployee(
        machineId,
        row?.assignedEmployeeId ?? null,
        { hrmBaseUrl: body.hrm_base_url },
      );
    }

    if (typeof body.admin_enabled === "boolean") {
      agent = await setAgentAdminEnabled(machineId, body.admin_enabled);
    }

    if (body.idle_seconds != null && Number.isFinite(Number(body.idle_seconds))) {
      agent = await setAgentIdleSeconds(machineId, Number(body.idle_seconds));
    }

    if (!agent) {
      return NextResponse.json(
        { success: false, error: "No update fields or agent not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, agent });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Update failed",
      },
      { status: 400 },
    );
  }
}

/** Delete one agent (machine_id) or all registered agent rows. */
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";
    let machineId = url.searchParams.get("machine_id")?.trim() || "";
    if (!machineId && !all) {
      try {
        const body = (await req.json()) as {
          machine_id?: string;
          all?: boolean;
        };
        if (body.all) {
          const n = await deleteAllPresenceAgents();
          return NextResponse.json({
            success: true,
            deleted: n,
            message: `Deleted ${n} agent registration(s).`,
          });
        }
        machineId = String(body.machine_id ?? "").trim();
      } catch {
        /* no body */
      }
    }
    if (all) {
      const n = await deleteAllPresenceAgents();
      return NextResponse.json({
        success: true,
        deleted: n,
        message: `Deleted ${n} agent registration(s).`,
      });
    }
    if (!machineId) {
      return NextResponse.json(
        { success: false, error: "machine_id or all=1 required" },
        { status: 400 },
      );
    }
    const ok = await deletePresenceAgent(machineId);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, deleted: 1 });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Delete failed",
      },
      { status: 400 },
    );
  }
}

/** Queue restart/exit/pause/on for one agent or all registered agents. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      machine_id?: string;
      all?: boolean;
      command?: AgentCommand;
    };
    const command = body.command;
    const allowed: AgentCommand[] = [
      "restart",
      "exit",
      "start",
      "pause",
      "resume",
      "on",
    ];
    if (!command || !allowed.includes(command)) {
      return NextResponse.json(
        { success: false, error: "invalid command" },
        { status: 400 },
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
      message: `Command "${command}" queued for ${count} agent(s). Takes effect within ~20s.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Command failed",
      },
      { status: 400 },
    );
  }
}
