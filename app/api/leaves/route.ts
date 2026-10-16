import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { broadcastWsEvent } from "@/lib/ws-broadcast";

// POST: Submit a new leave request
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_id, employee_name, leave_category, start_date, end_date, total_days, reason, document_paths } = body;
    if (!employee_id || !leave_category || !start_date || !end_date || !total_days) {
      return NextResponse.json({ success: false, error: "Missing required fields" });
    }
    await query(
      "INSERT INTO employee_leaves (employee_id, employee_name, leave_category, start_date, end_date, total_days, reason, status, document_paths, requested_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())",
      [employee_id, employee_name || '', leave_category, start_date, end_date, total_days, reason || '', JSON.stringify(document_paths || [])]
    );
    broadcastWsEvent({ type: "leave_update" });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

// GET: Fetch leave requests (hierarchy-scoped when viewerId is present)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeesParam = searchParams.get('employees');
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');
    const status = searchParams.get('status');
    const viewerId = String(
      searchParams.get("viewerId") ||
        searchParams.get("viewer_id") ||
        req.headers.get("x-hrm-employee-id") ||
        req.headers.get("x-employee-id") ||
        "",
    ).trim();

    let sql = "SELECT * FROM employee_leaves WHERE 1=1";
    const params: any[] = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    if (employeesParam) {
      const employees = employeesParam.split(',').map(e => e.trim()).filter(Boolean);
      if (employees.length > 0) {
        sql += ` AND employee_id IN (${employees.map(() => '?').join(',')})`;
        params.push(...employees);
      }
    } else if (viewerId) {
      const { loadHrTicketViewer, getEmployeeDeptChipMap } = await import(
        "@/lib/hr-department-tickets"
      );
      const viewer = await loadHrTicketViewer(viewerId);

      // HR staff (e.g. Aqsa HR Manager): see ALL pending/approved leaves company-wide.
      // Non-HR TL / dept head: hierarchy / owned-dept only.
      if (!(viewer?.isHrStaff && viewer.canViewHrInbox)) {
        const { listHierarchyVisibleEmployeeIds } = await import(
          "@/lib/employee-hierarchy-table"
        );
        const teamIds = new Set(await listHierarchyVisibleEmployeeIds(viewerId));
        if (viewer?.deptHead?.headHint) {
          const empChips = await getEmployeeDeptChipMap();
          const owned = new Set(
            (viewer.deptHead.ownedChips || []).map((c) => c.toLowerCase()),
          );
          for (const [empId, chip] of empChips) {
            if (chip && owned.has(chip.toLowerCase())) teamIds.add(empId);
          }
        }
        const scoped = [...teamIds];
        if (scoped.length === 0) {
          return NextResponse.json({ success: true, leaves: [] });
        }
        sql += ` AND employee_id IN (${scoped.map(() => "?").join(",")})`;
        params.push(...scoped);
      }
    }

    if (fromDate && toDate) {
      // leave overlaps with range: (start_date <= toDate AND end_date >= fromDate)
      sql += ' AND start_date <= ? AND end_date >= ?';
      params.push(toDate, fromDate);
    } else if (fromDate) {
      sql += ' AND end_date >= ?';
      params.push(fromDate);
    } else if (toDate) {
      sql += ' AND start_date <= ?';
      params.push(toDate);
    }

    sql += ' ORDER BY requested_at DESC';
    const [rows] = (await query(sql, params)) as any;
    let leaves = Array.isArray(rows) ? rows : [];

    // Per-row approve flag for HR Manager (view all, approve own dept only).
    if (viewerId && leaves.length > 0) {
      const {
        loadHrTicketViewer,
        getEmployeeDeptChipMap,
        canModerateTicketStatusAsync,
        getHrEmployeeIdSet,
      } = await import("@/lib/hr-department-tickets");
      const viewer = await loadHrTicketViewer(viewerId);
      const hrIds = await getHrEmployeeIdSet();
      const empChips = await getEmployeeDeptChipMap();
      const out = [];
      for (const leave of leaves) {
        const canMod = await canModerateTicketStatusAsync({
          ticketEmployeeId: leave.employee_id,
          viewer,
          hrIds,
          ticketType: "leave",
          submitterChip: empChips.get(String(leave.employee_id)) || null,
        });
        out.push({ ...leave, can_moderate: canMod });
      }
      leaves = out;
    }

    return NextResponse.json({ success: true, leaves });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

// PATCH: Update leave status (approve/reject)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, admin_remark } = body;
    if (!id || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ success: false, error: "Invalid data" });
    }

    const viewerId = String(
      body.viewerId ||
        body.viewer_id ||
        req.headers.get("x-hrm-employee-id") ||
        req.headers.get("x-employee-id") ||
        "",
    ).trim();

    const [existingRows]: any = await query(
      "SELECT * FROM employee_leaves WHERE id = ? LIMIT 1",
      [id],
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    if (!existing) {
      return NextResponse.json({ success: false, error: "Leave not found" }, { status: 404 });
    }

    if (viewerId) {
      const {
        loadHrTicketViewer,
        getEmployeeDeptChipMap,
        canModerateTicketStatusAsync,
        getHrEmployeeIdSet,
      } = await import("@/lib/hr-department-tickets");
      const viewer = await loadHrTicketViewer(viewerId);
      const hrIds = await getHrEmployeeIdSet();
      const empChips = await getEmployeeDeptChipMap();
      const allowed = await canModerateTicketStatusAsync({
        ticketEmployeeId: existing.employee_id,
        viewer,
        hrIds,
        ticketType: "leave",
        submitterChip: empChips.get(String(existing.employee_id)) || null,
      });
      if (!allowed) {
        return NextResponse.json(
          {
            success: false,
            error:
              "View only — you can approve leave only within your own department.",
          },
          { status: 403 },
        );
      }
    }

    // Who approved/rejected — shown on Leaves + Ticket Inbox (e.g. "Name (Team Lead)").
    let actorName: string | null = null;
    if (viewerId) {
      try {
        const { orgRoleLabel } = await import("@/lib/org-role");
        const [actorRows]: any = await query(
          "SELECT first_name, last_name, role FROM hrm_employees WHERE id = ? LIMIT 1",
          [viewerId],
        );
        const actor = Array.isArray(actorRows) ? actorRows[0] : null;
        if (actor) {
          const name = [actor.first_name, actor.last_name]
            .filter(Boolean)
            .join(" ")
            .trim();
          const role = orgRoleLabel(actor.role);
          actorName = name ? `${name} (${role})` : role;
        }
      } catch {
        /* optional */
      }
    }

    const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
    if (status === "rejected") {
      try {
        await query(
          `UPDATE employee_leaves
           SET status = ?, admin_remark = ?, step1_status = ?, step2_status = ?,
               step1_by = ?, step2_by = ?, updated_at = ?
           WHERE id = ?`,
          [
            status,
            admin_remark || "",
            "rejected",
            "rejected",
            actorName,
            actorName,
            nowIso,
            id,
          ],
        );
      } catch {
        await query(
          "UPDATE employee_leaves SET status = ?, admin_remark = ?, updated_at = ? WHERE id = ?",
          [status, admin_remark || "", nowIso, id],
        );
      }
    } else {
      // On approve: force half-day rows to deduct 0.5 from balance (DECIMAL-safe).
      const part = String(existing?.half_day_part || "").trim().toLowerCase();
      const isHalf =
        part === "first" ||
        part === "second" ||
        part === "first_half" ||
        part === "second_half" ||
        (Number(existing?.total_days) > 0 && Number(existing?.total_days) < 1);
      const totalDays = isHalf ? 0.5 : existing?.total_days;
      try {
        await query(
          `UPDATE employee_leaves
           SET status = ?, total_days = ?, step1_status = ?, step2_status = ?,
               step1_by = ?, step2_by = ?, step1_at = ?, step2_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            status,
            totalDays,
            "approved",
            "approved",
            actorName,
            actorName,
            nowIso,
            nowIso,
            nowIso,
            id,
          ],
        );
      } catch {
        try {
          if (isHalf) {
            await query(
              "UPDATE employee_leaves SET status = ?, total_days = 0.5, updated_at = ? WHERE id = ?",
              [status, nowIso, id],
            );
          } else {
            await query(
              "UPDATE employee_leaves SET status = ?, updated_at = ? WHERE id = ?",
              [status, nowIso, id],
            );
          }
        } catch {
          await query(
            "UPDATE employee_leaves SET status = ?, updated_at = NOW() WHERE id = ?",
            [status, id],
          );
        }
      }
    }

    // Mirror onto linked leave ticket so HR Ticket Inbox leaves Pending → Approved by TL/Manager/CEO.
    try {
      const { syncTicketFromLeaveDecision } = await import(
        "@/lib/leave-ticket-sync"
      );
      await syncTicketFromLeaveDecision({
        leaveReason: existing.reason,
        status: status as "approved" | "rejected",
        actorId: viewerId || null,
        actorName,
        employeeId: existing.employee_id,
        startDate: existing.start_date,
        endDate: existing.end_date,
      });
    } catch {
      /* ticket mirror optional */
    }

    // WebSocket broadcast (if available)
    try {
      const { broadcastWsEvent } = await import("@/lib/ws-broadcast");
      broadcastWsEvent({ type: "leave_update" });
      broadcastWsEvent({ type: "ticket_update" });
    } catch {
      try {
        const wsApi = globalThis as any;
        if (wsApi?.wss) {
          wsApi.wss.clients.forEach((client: any) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: "leave_update" }));
              client.send(JSON.stringify({ type: "ticket_update" }));
            }
          });
        }
      } catch {}
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
}
