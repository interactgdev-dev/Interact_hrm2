import { NextRequest, NextResponse } from "next/server";
import {
  resolveViewerDataScope,
  rowInViewerScope,
} from "@/lib/access-control/data-scope";
import { viewerHasFinancePayrollPowers } from "@/lib/access-control/hr-access";
import { getEmployeeAccessPayload } from "@/lib/access-control/store";
import {
  bulkUpdateClaimStatus,
  createClaim,
  getClaimById,
  listClaims,
  normalizeClaimStatus,
  normalizeClaimType,
  resolveClaimBalance,
  resolveMedicalClaimBalances,
  type EmployeeClaim,
} from "@/lib/employee-claims";

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

function summaryFromClaims(year: string, claims: EmployeeClaim[]) {
  const emp = new Set<number>();
  let total_approved_amount = 0;
  let total_pending_amount = 0;
  for (const c of claims) {
    if (c.status === "cancelled") continue;
    emp.add(c.employee_id);
    if (c.status === "approved" || c.status === "unpaid" || c.status === "paid") {
      total_approved_amount += c.amount;
    } else if (c.status === "pending") {
      total_pending_amount += c.amount;
    }
  }
  return {
    year,
    total_claims: claims.filter((c) => c.status !== "cancelled").length,
    total_approved_amount: Math.round(total_approved_amount * 100) / 100,
    total_pending_amount: Math.round(total_pending_amount * 100) / 100,
    employees_with_claims: emp.size,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function viewerIdFrom(req: NextRequest, body?: any): string {
  return String(
    body?.viewerId ??
      body?.viewer_id ??
      req.nextUrl.searchParams.get("viewerId") ??
      req.headers.get("x-employee-id") ??
      req.headers.get("x-hrm-employee-id") ??
      "",
  ).trim();
}

async function assertEmployeeInScope(
  viewerId: string,
  employeeId: number,
  departmentName?: string | null,
  opts?: { requireViewer?: boolean },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const requireViewer = opts?.requireViewer !== false;
  if (!viewerId || !/^\d+$/.test(viewerId)) {
    // Balance lookup is read-only; allow without viewer so HR form can show
    // package OPD/IPD pools. Mutations still require a viewer.
    if (!requireViewer) return { ok: true };
    return { ok: false, status: 401, error: "viewerId required" };
  }
  // Always allow viewing/acting on own row.
  if (String(employeeId) === viewerId) return { ok: true };
  const scope = await resolveViewerDataScope(viewerId);
  if (
    !rowInViewerScope(scope, {
      employeeId,
      departmentName: departmentName ?? null,
    })
  ) {
    return { ok: false, status: 403, error: "Out of scope" };
  }
  return { ok: true };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = searchParams.get("year") || undefined;
    const employeeIdRaw = searchParams.get("employee_id");
    const employeeId =
      employeeIdRaw && /^\d+$/.test(employeeIdRaw)
        ? Number(employeeIdRaw)
        : null;
    const status = searchParams.get("status");
    const claimType = searchParams.get("claim_type");
    const balanceOnly = searchParams.get("balance") === "1";
    const viewerId = viewerIdFrom(req);

    if (balanceOnly) {
      if (employeeId == null) {
        return NextResponse.json(
          { success: false, error: "employee_id required for balance" },
          { status: 400 },
        );
      }
      const scoped = await assertEmployeeInScope(viewerId, employeeId, null, {
        requireViewer: false,
      });
      if (!scoped.ok) {
        return NextResponse.json(
          { success: false, error: scoped.error },
          { status: scoped.status },
        );
      }
      const selectedType = normalizeClaimType(claimType || "opd");
      try {
        const [balance, medical] = await Promise.all([
          resolveClaimBalance({
            employeeId,
            year,
            claimType: selectedType,
          }),
          resolveMedicalClaimBalances({ employeeId, year }),
        ]);
        return NextResponse.json({
          success: true,
          balance,
          medical_package: medical.medical_package,
          balances: { opd: medical.opd, ipd: medical.ipd },
        });
      } catch (err) {
        return NextResponse.json(
          {
            success: false,
            error:
              err instanceof Error ? err.message : "Failed to resolve balance",
          },
          { status: 500 },
        );
      }
    }

    let claims = await listClaims({
      year,
      employeeId,
      status,
      claimType,
    });

    // With viewerId: apply department/team scope. Without (admin portal /
    // missing localStorage): return full list — page is already menu-gated.
    if (viewerId && /^\d+$/.test(viewerId)) {
      const scope = await resolveViewerDataScope(viewerId);
      claims = claims.filter((c) =>
        rowInViewerScope(scope, {
          employeeId: c.employee_id,
          departmentName: c.department_name,
        }),
      );
    }

    const summary = summaryFromClaims(
      year || String(new Date().getFullYear()),
      claims,
    );

    return NextResponse.json({ success: true, claims, summary });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load claims",
      },
      { status: 500 },
    );
  }
}

/** Bulk status update — finance Mark selected as Paid. */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const viewerId = viewerIdFrom(req, body);
    const rawIds = Array.isArray(body.ids)
      ? body.ids
      : Array.isArray(body.claim_ids)
        ? body.claim_ids
        : [];
    const ids = rawIds
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!ids.length) {
      return NextResponse.json(
        { success: false, error: "ids required" },
        { status: 400 },
      );
    }
    if (body.status == null || String(body.status).trim() === "") {
      return NextResponse.json(
        { success: false, error: "status required" },
        { status: 400 },
      );
    }
    const status = normalizeClaimStatus(body.status);
    if (ids.length > 100) {
      return NextResponse.json(
        { success: false, error: "Max 100 claims per bulk update" },
        { status: 400 },
      );
    }

    if (status === "paid") {
      const ok = await viewerCanMarkPaid(viewerId);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Only Finance can mark claims as paid" },
          { status: 403 },
        );
      }
    }

    const allowed: number[] = [];
    const denied: { id: number; error: string }[] = [];

    for (const id of ids) {
      const existing = await getClaimById(id);
      if (!existing) {
        denied.push({ id, error: "Claim not found" });
        continue;
      }
      if (viewerId && /^\d+$/.test(viewerId)) {
        const scoped = await assertEmployeeInScope(
          viewerId,
          existing.employee_id,
          existing.department_name,
        );
        if (!scoped.ok) {
          denied.push({ id, error: scoped.error });
          continue;
        }
      }
      allowed.push(id);
    }

    const result = await bulkUpdateClaimStatus({
      ids: allowed,
      status,
      notes: body.notes != null ? String(body.notes) : null,
      approvedByEmployeeId: /^\d+$/.test(viewerId) ? Number(viewerId) : null,
    });

    return NextResponse.json({
      success: true,
      updated: result.updated,
      failed: [...denied, ...result.failed],
      updated_count: result.updated.length,
      failed_count: denied.length + result.failed.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Bulk update failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const employeeId = Number(body.employee_id ?? body.employeeId);
    const amount = Number(body.amount);
    const viewerId = viewerIdFrom(req, body);

    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return NextResponse.json(
        { success: false, error: "employee_id required" },
        { status: 400 },
      );
    }

    // Soft scope: if viewer present, enforce it; admin/HR without employeeId
    // can still add claims (menu-gated page).
    if (viewerId && /^\d+$/.test(viewerId)) {
      const scoped = await assertEmployeeInScope(viewerId, employeeId);
      if (!scoped.ok) {
        return NextResponse.json(
          { success: false, error: scoped.error },
          { status: scoped.status },
        );
      }
    }

    const createStatus = normalizeClaimStatus(
      body.status != null && String(body.status).trim() !== ""
        ? body.status
        : "pending",
    );
    if (createStatus === "paid") {
      const ok = await viewerCanMarkPaid(viewerId);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Only Finance can mark claims as paid" },
          { status: 403 },
        );
      }
    }

    const result = await createClaim({
      employeeId,
      amount,
      claimDate: body.claim_date ? String(body.claim_date) : undefined,
      claimType: normalizeClaimType(body.claim_type ?? body.claimType),
      title: body.title != null ? String(body.title) : null,
      notes: body.notes != null ? String(body.notes) : null,
      status: createStatus,
      createdBy:
        body.created_by != null
          ? String(body.created_by)
          : viewerId
            ? `employee:${viewerId}`
            : "hr",
      createdByEmployeeId: /^\d+$/.test(viewerId) ? Number(viewerId) : null,
      allowOverBalance: body.allow_over_balance === true,
    });

    const medical = await resolveMedicalClaimBalances({
      employeeId,
      year: result.claim.claim_year,
    });

    return NextResponse.json({
      success: true,
      claim: result.claim,
      balance: result.balance,
      medical_package: medical.medical_package,
      balances: { opd: medical.opd, ipd: medical.ipd },
      message: "Claim added.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create claim";
    const over = /exceeds remaining/i.test(msg);
    return NextResponse.json(
      { success: false, error: msg },
      { status: over ? 400 : 500 },
    );
  }
}
