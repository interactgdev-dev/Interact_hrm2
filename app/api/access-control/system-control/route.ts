import { NextRequest, NextResponse } from "next/server";
import {
  assignEmployeeRole,
  assignEmployeesToRole,
  deleteHrmEmployeeCascade,
  ensureAccessControlStore,
  getEmployeeAccessPayload,
  loadAccessEmployees,
  loadAllEmployeePermissionOverrides,
  loadGlobalFeatures,
  loadOrgRoles,
  loadPermissionMap,
  saveEmployeePermissions,
  saveGlobalFeatures,
  saveOrgRoles,
  saveRolePermissions,
  setEmployeeOrgRole,
  syncAccessControlCatalog,
  backfillMissingOrgAccessRoles,
  unassignEmployeeRole,
  unassignEmployees,
  unassignEmployeesFromRole,
} from "@/lib/access-control/store";
import {
  FEATURE_MODULES,
  GLOBAL_FEATURES,
  type RoleDef,
} from "@/app/admin/roles-permissions/system-control-data";

export const runtime = "nodejs";

type Caps = {
  systemPermissionsEdit: boolean;
  systemUsersAssign: boolean;
  systemOrgChartEdit: boolean;
  systemFeaturesEdit: boolean;
  systemControlOpen: boolean;
};

async function resolveCallerCaps(req: NextRequest): Promise<{
  employeeId: string | null;
  isAdmin: boolean;
  caps: Caps;
}> {
  const employeeId =
    req.headers.get("x-employee-id") ||
    req.nextUrl.searchParams.get("actorEmployeeId") ||
    "";
  const isAdminHeader = req.headers.get("x-hrm-portal") === "admin";

  if (isAdminHeader) {
    return {
      employeeId: employeeId.trim() || null,
      isAdmin: true,
      caps: {
        systemControlOpen: true,
        systemPermissionsEdit: true,
        systemUsersAssign: true,
        systemOrgChartEdit: true,
        systemFeaturesEdit: true,
      },
    };
  }

  if (!employeeId.trim()) {
    // No actor identity: treat as admin UI fallback for GET; PUTs still check caps.
    return {
      employeeId: null,
      isAdmin: true,
      caps: {
        systemControlOpen: true,
        systemPermissionsEdit: true,
        systemUsersAssign: true,
        systemOrgChartEdit: true,
        systemFeaturesEdit: true,
      },
    };
  }

  try {
    const payload = await getEmployeeAccessPayload(employeeId.trim());
    const caps = payload.capabilities || {
      systemControlOpen: false,
      systemPermissionsEdit: false,
      systemUsersAssign: false,
      systemOrgChartEdit: false,
      systemFeaturesEdit: false,
    };
    return { employeeId: employeeId.trim(), isAdmin: false, caps };
  } catch {
    return {
      employeeId: employeeId.trim(),
      isAdmin: false,
      caps: {
        systemControlOpen: false,
        systemPermissionsEdit: false,
        systemUsersAssign: false,
        systemOrgChartEdit: false,
        systemFeaturesEdit: false,
      },
    };
  }
}

/** Full state for System Control Org Chart + Permissions + Features tabs. */
export async function GET(req: NextRequest) {
  try {
    await ensureAccessControlStore();
    await syncAccessControlCatalog();
    await backfillMissingOrgAccessRoles();
    const caller = await resolveCallerCaps(req);
    const [permissions, features, employees, roles, employeePermissions] =
      await Promise.all([
        loadPermissionMap(),
        loadGlobalFeatures(),
        loadAccessEmployees(),
        loadOrgRoles(),
        loadAllEmployeePermissionOverrides(),
      ]);
    return NextResponse.json({
      success: true,
      permissions,
      features,
      employees,
      roles,
      employeePermissions,
      modules: FEATURE_MODULES,
      catalogFeatures: GLOBAL_FEATURES,
      viewer: {
        employeeId: caller.employeeId,
        isAdmin: caller.isAdmin,
        capabilities: caller.caps,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Body types: permissions | features | assign | assign-many | unassign |
 * unassign-many | org-roles | employee-permissions | employee-org-role | delete-employee
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const type = String(body?.type || "").trim();
    const caller = await resolveCallerCaps(req);

    const deny = (msg: string) =>
      NextResponse.json({ success: false, error: msg }, { status: 403 });

    if (type === "permissions") {
      if (!caller.caps.systemPermissionsEdit) {
        return deny("Missing permission: system.permissions.edit");
      }
      const roleId = String(body.roleId || "").trim();
      const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
      if (!roleId) {
        return NextResponse.json({ success: false, error: "roleId required" }, { status: 400 });
      }
      await saveRolePermissions(roleId, keys);
      return NextResponse.json({ success: true });
    }

    if (type === "employee-permissions") {
      if (!caller.caps.systemPermissionsEdit) {
        return deny("Missing permission: system.permissions.edit");
      }
      const employeeId = String(body.employeeId || "").trim();
      if (!employeeId) {
        return NextResponse.json(
          { success: false, error: "employeeId required" },
          { status: 400 },
        );
      }
      if (body.clear === true) {
        await saveEmployeePermissions(employeeId, null, { clear: true });
      } else {
        const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
        await saveEmployeePermissions(employeeId, keys);
      }
      return NextResponse.json({ success: true });
    }

    if (type === "features") {
      if (!caller.caps.systemFeaturesEdit) {
        return deny("Missing permission: system.features.edit");
      }
      const features = Array.isArray(body.features) ? body.features : [];
      await saveGlobalFeatures(
        features.map((f: any) => ({
          key: String(f.key || ""),
          on: Boolean(f.on),
          name: f.name ? String(f.name) : undefined,
          desc: f.desc ? String(f.desc) : undefined,
        })),
      );
      return NextResponse.json({ success: true });
    }

    if (type === "assign") {
      if (!caller.caps.systemUsersAssign) {
        return deny("Missing permission: system.users.assign");
      }
      const employeeId = String(body.employeeId || "").trim();
      const roleId = String(body.roleId || "").trim();
      if (!employeeId || !roleId) {
        return NextResponse.json(
          { success: false, error: "employeeId and roleId required" },
          { status: 400 },
        );
      }
      await assignEmployeeRole(employeeId, roleId);
      return NextResponse.json({ success: true });
    }

    if (type === "assign-many") {
      if (!caller.caps.systemUsersAssign) {
        return deny("Missing permission: system.users.assign");
      }
      const roleId = String(body.roleId || "").trim();
      const employeeIds = Array.isArray(body.employeeIds)
        ? body.employeeIds.map(String)
        : [];
      if (!roleId || !employeeIds.length) {
        return NextResponse.json(
          { success: false, error: "roleId and employeeIds required" },
          { status: 400 },
        );
      }
      const count = await assignEmployeesToRole(employeeIds, roleId);
      return NextResponse.json({ success: true, count });
    }

    if (type === "unassign") {
      if (!caller.caps.systemUsersAssign) {
        return deny("Missing permission: system.users.assign");
      }
      const employeeId = String(body.employeeId || "").trim();
      if (!employeeId) {
        return NextResponse.json(
          { success: false, error: "employeeId required" },
          { status: 400 },
        );
      }
      await unassignEmployeeRole(employeeId);
      return NextResponse.json({ success: true });
    }

    if (type === "unassign-many") {
      if (!caller.caps.systemUsersAssign) {
        return deny("Missing permission: system.users.assign");
      }
      const employeeIds = Array.isArray(body.employeeIds)
        ? body.employeeIds.map(String)
        : [];
      if (!employeeIds.length) {
        return NextResponse.json(
          { success: false, error: "employeeIds required" },
          { status: 400 },
        );
      }
      const roleId = String(body.roleId || "").trim();
      const count = roleId
        ? await unassignEmployeesFromRole(employeeIds, roleId)
        : await unassignEmployees(employeeIds);
      return NextResponse.json({ success: true, count });
    }

    if (type === "org-roles") {
      if (!caller.caps.systemOrgChartEdit) {
        return deny("Missing permission: system.org_chart.edit");
      }
      const roles = Array.isArray(body.roles) ? (body.roles as RoleDef[]) : [];
      if (!roles.length) {
        return NextResponse.json(
          { success: false, error: "roles array required" },
          { status: 400 },
        );
      }
      await saveOrgRoles(roles);
      const saved = await loadOrgRoles();
      return NextResponse.json({ success: true, roles: saved });
    }

    if (type === "employee-org-role") {
      if (!caller.caps.systemUsersAssign && !caller.caps.systemOrgChartEdit) {
        return deny("Missing permission: system.users.assign");
      }
      const employeeId = String(body.employeeId || "").trim();
      const orgRole = body.orgRole ?? body.role;
      if (!employeeId || orgRole == null || String(orgRole).trim() === "") {
        return NextResponse.json(
          { success: false, error: "employeeId and orgRole required" },
          { status: 400 },
        );
      }
      const slug = await setEmployeeOrgRole(employeeId, orgRole);
      return NextResponse.json({ success: true, accessRoleSlug: slug });
    }

    if (type === "delete-employee") {
      if (!caller.caps.systemUsersAssign && !caller.caps.systemOrgChartEdit) {
        return deny("Missing permission: system.users.assign");
      }
      const employeeId = String(body.employeeId || "").trim();
      if (!employeeId) {
        return NextResponse.json(
          { success: false, error: "employeeId required" },
          { status: 400 },
        );
      }
      await deleteHrmEmployeeCascade(employeeId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown type" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
