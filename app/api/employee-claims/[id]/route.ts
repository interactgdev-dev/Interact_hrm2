import { NextRequest, NextResponse } from "next/server";
import {
  resolveViewerDataScope,
  rowInViewerScope,
} from "@/lib/access-control/data-scope";
import { viewerHasFinancePayrollPowers } from "@/lib/access-control/hr-access";
import { getEmployeeAccessPayload } from "@/lib/access-control/store";
import {
  getClaimById,
  normalizeClaimStatus,
  updateClaimStatus,
} from "@/lib/employee-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function viewerCanMarkPaid(viewerId: string): Promise<boolean> {
  if (!viewerId || !/^\d+$/.test(viewerId)) return false;
  try {
    const access = await getEmployeeAccessPayload(viewerId);
    return viewerHasFinancePayrollPowers({
      departmentName: access.departmentName,
      roleSlugs: access.role?.slugs || [access.role?.slug].filter(Boolean),
      permissions: access.permissions,
    });
  } catch {
    return false;
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idRaw } = await ctx.params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid claim id" },
        { status: 400 },
      );
    }
    const body = (await req.json()) as Record<string, unknown>;
    if (!body.status) {
      return NextResponse.json(
        { success: false, error: "status required" },
        { status: 400 },
      );
    }
    const viewerRaw = String(
      body.viewerId ??
        body.viewer_id ??
        req.headers.get("x-employee-id") ??
        req.headers.get("x-hrm-employee-id") ??
        "",
    ).trim();

    const existing = await getClaimById(id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }

    if (viewerRaw && /^\d+$/.test(viewerRaw)) {
      if (String(existing.employee_id) !== viewerRaw) {
        const scope = await resolveViewerDataScope(viewerRaw);
        if (
          !rowInViewerScope(scope, {
            employeeId: existing.employee_id,
            departmentName: existing.department_name,
          })
        ) {
          return NextResponse.json(
            { success: false, error: "Out of scope" },
            { status: 403 },
          );
        }
      }
    }

    const nextStatus = normalizeClaimStatus(body.status);
    if (nextStatus === "paid") {
      const ok = await viewerCanMarkPaid(viewerRaw);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Only Finance can mark claims as paid" },
          { status: 403 },
        );
      }
    }

    const claim = await updateClaimStatus({
      id,
      status: nextStatus,
      notes: body.notes != null ? String(body.notes) : null,
      approvedByEmployeeId: /^\d+$/.test(viewerRaw) ? Number(viewerRaw) : null,
    });

    return NextResponse.json({ success: true, claim });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    const notFound = /not found/i.test(msg);
    return NextResponse.json(
      { success: false, error: msg },
      { status: notFound ? 404 : 400 },
    );
  }
}
