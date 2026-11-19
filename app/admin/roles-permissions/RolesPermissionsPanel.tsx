"use client";

import React, { useMemo, useState } from "react";
import styles from "./system-control-demo.module.css";
import SearchableSelect, { type SelectGroup, type SelectOption } from "./SearchableSelect";
import type { DemoEmployee, FeatureModule, RoleDef } from "./system-control-data";
import { groupRolesByOrgSection, roleMeta } from "./system-control-data";
import { effectiveAccessSlugs } from "@/lib/access-control/effective-slugs";
import {
  catalogKeysFromStored,
  labelForPermissionScope,
  moduleNameForPermissionScope,
  permissionSetHas,
  permissionSetHasScoped,
  toScopedPermissionKey,
  type PermissionScopeColumn,
} from "@/lib/access-control/permission-scope";

export type SystemControlCaps = {
  systemPermissionsEdit: boolean;
  systemUsersAssign: boolean;
  systemOrgChartEdit: boolean;
  systemFeaturesEdit: boolean;
  systemControlOpen: boolean;
};

type Props = {
  allRoles: RoleDef[];
  employees: DemoEmployee[];
  initialRoleId?: string;
  permissions: Record<string, Set<string>>;
  /** employeeId → custom keys; missing key = using role defaults */
  employeePermissions: Record<string, string[]>;
  modules: FeatureModule[];
  expandedModules: Record<string, boolean>;
  onToggleModuleExpand: (id: string) => void;
  onTogglePermission: (roleId: string, key: string) => void;
  onToggleModuleForRole: (roleId: string, module: FeatureModule, checked: boolean) => void;
  onToggleEmployeePermission: (
    employeeId: string,
    key: string,
    baseRoleId: string,
  ) => void;
  onToggleModuleForEmployee: (
    employeeId: string,
    module: FeatureModule,
    checked: boolean,
    baseRoleId: string,
  ) => void;
  onResetRole: (roleId: string) => void;
  onSaveRole: (roleId: string) => void;
  onSaveEmployee: (employeeId: string, baseRoleId: string) => void;
  onClearEmployeeOverrides: (employeeId: string) => void;
  onAssignEmployees: (employeeIds: string[], roleId: string) => void;
  onUnassignEmployees: (employeeIds: string[], roleId: string) => void;
  /** Open create-role wizard from the Select role dropdown. */
  onCreateRole?: () => void;
  isRoleLocked: (roleId: string) => boolean;
  isCustomRole: (id: string) => boolean;
  employeeCountByRole: (roleId: string) => number;
  caps: SystemControlCaps;
};

/** Catalog modules shown in both scope columns (Data scope is the column itself). */
const HIDDEN_SCOPE_MODULE_IDS = new Set(["data_scope"]);

function accentOf(role: RoleDef | undefined) {
  return role?.accent || "#0e7490";
}

function roleFilter(opt: SelectOption, query: string) {
  return opt.label.toLowerCase().includes(query);
}

function employeeFilter(opt: SelectOption, query: string) {
  const hay = `${opt.label} ${opt.meta ?? ""}`.toLowerCase();
  return hay.includes(query);
}

function explicitSlugs(emp: DemoEmployee): string[] {
  return effectiveAccessSlugs(emp);
}

function employeeHasRole(emp: DemoEmployee, roleId: string) {
  return explicitSlugs(emp).includes(roleId);
}

function labelsForKeys(modules: FeatureModule[], keys: Iterable<string>): string[] {
  const catalog = new Set(catalogKeysFromStored(keys));
  const labels: string[] = [];
  for (const mod of modules) {
    if (HIDDEN_SCOPE_MODULE_IDS.has(mod.id)) continue;
    for (const p of mod.permissions) {
      if (catalog.has(p.key) || permissionSetHas(keys, p.key)) labels.push(p.label);
    }
  }
  return labels;
}

function filterModulesForSearch(
  modules: FeatureModule[],
  search: string,
): FeatureModule[] {
  const q = search.trim().toLowerCase();
  return modules
    .filter((m) => !HIDDEN_SCOPE_MODULE_IDS.has(m.id))
    .map((m) => ({
      ...m,
      permissions: q
        ? m.permissions.filter(
            (p) =>
              p.label.toLowerCase().includes(q) ||
              p.key.toLowerCase().includes(q) ||
              p.desc.toLowerCase().includes(q) ||
              m.name.toLowerCase().includes(q),
          )
        : m.permissions,
    }))
    .filter((m) => m.permissions.length > 0);
}

export default function RolesPermissionsPanel({
  allRoles,
  employees,
  initialRoleId,
  permissions,
  employeePermissions,
  modules,
  onTogglePermission,
  onToggleModuleForRole,
  onToggleEmployeePermission,
  onToggleModuleForEmployee,
  onResetRole,
  onSaveRole,
  onSaveEmployee,
  onClearEmployeeOverrides,
  onAssignEmployees,
  onUnassignEmployees,
  onCreateRole,
  isRoleLocked,
  isCustomRole,
  employeeCountByRole,
  caps,
}: Props) {
  const [permSearch, setPermSearch] = useState("");
  const [pickEmployeeId, setPickEmployeeId] = useState("");
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [selectedAssignedIds, setSelectedAssignedIds] = useState<string[]>([]);
  /** When set, matrix edits that employee's custom permissions. */
  const [focusEmployeeId, setFocusEmployeeId] = useState<string | null>(null);
  const [hoverEmployeeId, setHoverEmployeeId] = useState<string | null>(null);
  /** Delay close so cursor can cross chip→card gap without the popup vanishing. */
  const hoverCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const openHoverCard = React.useCallback((empId: string) => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setHoverEmployeeId(empId);
  }, []);

  const scheduleCloseHoverCard = React.useCallback((empId: string) => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoverEmployeeId((prev) => (prev === empId ? null : prev));
      hoverCloseTimerRef.current = null;
    }, 220);
  }, []);

  React.useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    };
  }, []);

  const canEditPerms = caps.systemPermissionsEdit;
  const canAssign = caps.systemUsersAssign;

  React.useEffect(() => {
    if (!employees.length) return;
    setPickEmployeeId((prev) => {
      if (prev && employees.some((e) => e.id === prev)) return prev;
      return employees[0]?.id ?? "";
    });
  }, [employees]);

  const matrixRoles = useMemo(
    () => allRoles.filter((r) => !isRoleLocked(r.id)),
    [allRoles, isRoleLocked],
  );

  const roleSections = useMemo(
    () => groupRolesByOrgSection(matrixRoles),
    [matrixRoles],
  );

  const roleSelectGroups: SelectGroup[] = useMemo(
    () =>
      roleSections.map((section) => ({
        id: section.id,
        label: section.title,
        options: section.roles.map((role) => {
          const count = employeeCountByRole(role.id);
          const custom = isCustomRole(role.id);
          return {
            value: role.id,
            label: role.name,
            accent: accentOf(role),
            meta: `${count} assigned${custom ? " · custom" : ""} · ${role.scopeLabel || role.scope}`,
          };
        }),
      })),
    [roleSections, employeeCountByRole, isCustomRole],
  );

  const [selectedRoleId, setSelectedRoleId] = useState<string>(() => {
    if (initialRoleId && matrixRoles.some((r) => r.id === initialRoleId)) {
      return initialRoleId;
    }
    return matrixRoles[0]?.id ?? "";
  });

  React.useEffect(() => {
    if (initialRoleId && matrixRoles.some((r) => r.id === initialRoleId)) {
      setSelectedRoleId(initialRoleId);
    }
  }, [initialRoleId, matrixRoles]);

  React.useEffect(() => {
    setPendingIds([]);
    setSelectedAssignedIds([]);
    setFocusEmployeeId(null);
    setHoverEmployeeId(null);
  }, [selectedRoleId]);

  const activeRole =
    matrixRoles.find((r) => r.id === selectedRoleId) ?? matrixRoles[0];
  const activeRoleId = activeRole?.id ?? "";
  const locked = activeRoleId ? isRoleLocked(activeRoleId) : false;

  const focusEmployee = focusEmployeeId
    ? employees.find((e) => e.id === focusEmployeeId) || null
    : null;
  const editingUser = Boolean(focusEmployee);
  const userHasCustom =
    editingUser &&
    focusEmployeeId != null &&
    Object.prototype.hasOwnProperty.call(employeePermissions, focusEmployeeId);

  const roleSet = (activeRoleId && permissions[activeRoleId]) || new Set<string>();
  const activeSet: Set<string> = editingUser
    ? new Set(
        userHasCustom
          ? employeePermissions[focusEmployeeId!] || []
          : [...roleSet],
      )
    : roleSet;

  const assignedUsers = useMemo(
    () =>
      employees
        .filter((e) => employeeHasRole(e, activeRoleId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees, activeRoleId],
  );

  const employeePickerOptions: SelectOption[] = useMemo(
    () =>
      [...employees]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((emp) => {
          const assigned = explicitSlugs(emp);
          return {
            value: emp.id,
            label: emp.name,
            meta: [
              `ID ${emp.id}`,
              emp.pseudonym ? `P.Name: ${emp.pseudonym}` : null,
              emp.departmentName || null,
              assigned.length
                ? assigned.map((s) => roleMeta(s, allRoles).name).join(", ")
                : emp.legacyRole
                  ? `HR: ${emp.legacyRole}`
                  : "No role yet",
            ]
              .filter(Boolean)
              .join(" · "),
          };
        }),
    [employees, allRoles],
  );

  /** Picker only jumps role — does not auto-open user edit (was confusing). */
  React.useEffect(() => {
    if (!pickEmployeeId) return;
    const emp = employees.find((e) => e.id === pickEmployeeId);
    if (!emp) return;
    const primary = explicitSlugs(emp)[0];
    if (primary && matrixRoles.some((r) => r.id === primary)) {
      setSelectedRoleId(primary);
    }
  }, [pickEmployeeId, employees, matrixRoles]);

  const pickEmp = pickEmployeeId
    ? employees.find((e) => e.id === pickEmployeeId)
    : undefined;
  const pickAlreadyOnRole = !!(pickEmp && employeeHasRole(pickEmp, activeRoleId));

  const totalPerms = useMemo(
    () =>
      modules
        .filter((m) => !HIDDEN_SCOPE_MODULE_IDS.has(m.id))
        .reduce((sum, m) => sum + m.permissions.length, 0),
    [modules],
  );

  const matrixLocked = locked || !canEditPerms;

  const grantedCount = locked
    ? totalPerms
    : modules
        .filter((m) => !HIDDEN_SCOPE_MODULE_IDS.has(m.id))
        .reduce(
          (sum, m) =>
            sum + m.permissions.filter((p) => permissionSetHas(activeSet, p.key)).length,
          0,
        );

  const sharedModules = useMemo(
    () => filterModulesForSearch(modules, permSearch),
    [modules, permSearch],
  );

  function effectiveKeysForEmployee(emp: DemoEmployee): string[] {
    if (Object.prototype.hasOwnProperty.call(employeePermissions, emp.id)) {
      return employeePermissions[emp.id] || [];
    }
    return [...roleSet];
  }

  function roleHasAll(module: FeatureModule, scope: PermissionScopeColumn) {
    if (locked) return true;
    return module.permissions.every((p) =>
      permissionSetHasScoped(activeSet, p.key, scope),
    );
  }

  function addPendingFromPicker() {
    if (!pickEmployeeId || !canAssign) return;
    setPendingIds((prev) =>
      prev.includes(pickEmployeeId) ? prev : [...prev, pickEmployeeId],
    );
  }

  function removePending(id: string) {
    setPendingIds((prev) => prev.filter((x) => x !== id));
  }

  function handleAssign() {
    if (!activeRoleId || !canAssign) return;
    const ids = pendingIds.length
      ? pendingIds
      : pickEmployeeId
        ? [pickEmployeeId]
        : [];
    if (!ids.length) return;
    onAssignEmployees(ids, activeRoleId);
    setPendingIds([]);
  }

  function toggleAssignedSelect(id: string) {
    setSelectedAssignedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleUnassignSelected() {
    if (!selectedAssignedIds.length || !canAssign || !activeRoleId) return;
    onUnassignEmployees(selectedAssignedIds, activeRoleId);
    setSelectedAssignedIds([]);
    if (focusEmployeeId && selectedAssignedIds.includes(focusEmployeeId)) {
      setFocusEmployeeId(null);
    }
  }

  function handleUnassignOne(id: string) {
    if (!canAssign || !activeRoleId) return;
    onUnassignEmployees([id], activeRoleId);
    setSelectedAssignedIds((prev) => prev.filter((x) => x !== id));
    if (focusEmployeeId === id) setFocusEmployeeId(null);
  }

  function onToggleKey(catalogKey: string, scope: PermissionScopeColumn) {
    if (matrixLocked) return;
    const key = toScopedPermissionKey(catalogKey, scope);
    if (editingUser && focusEmployeeId) {
      onToggleEmployeePermission(focusEmployeeId, key, activeRoleId);
    } else {
      onTogglePermission(activeRoleId, key);
    }
  }

  function onToggleModule(
    module: FeatureModule,
    checked: boolean,
    scope: PermissionScopeColumn,
  ) {
    if (matrixLocked) return;
    const scopedModule = {
      ...module,
      permissions: module.permissions.map((p) => ({
        ...p,
        key: toScopedPermissionKey(p.key, scope),
      })),
    };
    if (editingUser && focusEmployeeId) {
      onToggleModuleForEmployee(focusEmployeeId, scopedModule, checked, activeRoleId);
    } else {
      onToggleModuleForRole(activeRoleId, scopedModule, checked);
    }
  }

  const pendingPeople = pendingIds
    .map((id) => employees.find((e) => e.id === id))
    .filter(Boolean) as DemoEmployee[];

  const hoverEmp = hoverEmployeeId
    ? employees.find((e) => e.id === hoverEmployeeId) || null
    : null;
  const hoverLabels = hoverEmp
    ? labelsForKeys(modules, effectiveKeysForEmployee(hoverEmp))
    : [];
  const hoverCustom =
    hoverEmp != null &&
    Object.prototype.hasOwnProperty.call(employeePermissions, hoverEmp.id);

  function renderModuleColumn(list: FeatureModule[], scope: PermissionScopeColumn) {
    return list.map((module) => {
      const all = roleHasAll(module, scope);
      const moduleTitle = moduleNameForPermissionScope(module.id, module.name, scope);
      return (
        <section key={`${scope}-${module.id}`} className={styles.permModule}>
          <header className={styles.permModuleHead}>
            <span className={styles.permModuleTitle}>
              <span className={styles.matrixCatIcon}>{module.icon}</span>
              {moduleTitle}
              <span className={styles.permModuleCount}>{module.permissions.length}</span>
            </span>
            {!matrixLocked && (
              <button
                type="button"
                className={`${styles.permAllBtn} ${all ? styles.permAllBtnOn : ""}`}
                onClick={() => onToggleModule(module, !all, scope)}
              >
                {all ? "Clear all" : "Select all"}
              </button>
            )}
          </header>
          <div className={styles.permGrid}>
            {module.permissions.map((perm) => {
              const checked =
                locked || permissionSetHasScoped(activeSet, perm.key, scope);
              const label = labelForPermissionScope(perm.key, perm.label, scope);
              return (
                <label
                  key={`${scope}-${perm.key}`}
                  className={`${styles.permItem} ${checked ? styles.permItemOn : ""} ${matrixLocked ? styles.permItemLocked : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={matrixLocked}
                    onChange={() => onToggleKey(perm.key, scope)}
                  />
                  <span className={styles.permItemBox} />
                  <span className={styles.permItemLabel}>{label}</span>
                  <span className={styles.infoWrap}>
                    <button
                      type="button"
                      className={styles.infoBtnMatrix}
                      aria-label={`About ${label}`}
                      onClick={(e) => e.preventDefault()}
                    >
                      i
                    </button>
                    <span className={styles.infoTooltip} role="tooltip">
                      {perm.desc}
                      {scope === "own"
                        ? " · Scope: own department"
                        : " · Scope: all departments"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      );
    });
  }

  return (
    <div className={styles.permWrap}>
      <div className={styles.permHeader}>
        <div>
          <h2 className={styles.matrixTitle}>Roles &amp; Permissions</h2>
          <p className={styles.matrixSubtitle}>
            Set role defaults below. Hover an assigned user to preview their permissions —{" "}
            <strong>Edit</strong> to change only that person.
          </p>
        </div>
        <div className={styles.matrixSearchWrap}>
          <span className={styles.matrixSearchIcon}>⌕</span>
          <input
            className={styles.matrixSearch}
            placeholder="Search permission…"
            value={permSearch}
            onChange={(e) => setPermSearch(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.permPickerBar}>
        <SearchableSelect
          id="perm-role"
          label="Select role"
          value={selectedRoleId}
          onChange={setSelectedRoleId}
          groups={roleSelectGroups}
          searchPlaceholder="Search by role name…"
          emptyText="No roles match your search"
          filterOption={roleFilter}
          footerAction={
            onCreateRole && caps.systemOrgChartEdit
              ? { label: "+ Add new role", onClick: onCreateRole }
              : undefined
          }
        />
        <SearchableSelect
          id="perm-employee"
          label="Select employee"
          value={pickEmployeeId}
          onChange={setPickEmployeeId}
          options={employeePickerOptions}
          searchPlaceholder="Search by name or P.Name…"
          emptyText="No employees found"
          filterOption={employeeFilter}
          disabled={employees.length === 0}
        />
        <div className={styles.permAssignBtnCol}>
          <span className={styles.permSelectLabel} aria-hidden="true">
            &nbsp;
          </span>
          <div className={styles.permAssignBtnRow}>
            <button
              type="button"
              className={styles.btnOutlinePurple}
              disabled={
                !canAssign ||
                !pickEmployeeId ||
                !activeRoleId ||
                pickAlreadyOnRole
              }
              onClick={addPendingFromPicker}
              title={pickAlreadyOnRole ? "Already on this role" : "Queue for assign"}
            >
              Add to list
            </button>
            <button
              type="button"
              className={styles.permAssignBtn}
              disabled={
                !canAssign ||
                (!pendingIds.length && (!pickEmployeeId || pickAlreadyOnRole)) ||
                !activeRoleId ||
                locked
              }
              onClick={handleAssign}
            >
              Assign{pendingIds.length > 1 ? ` (${pendingIds.length})` : ""}
            </button>
          </div>
        </div>
      </div>

      {pendingPeople.length > 0 && (
        <div className={styles.permAssignedBar}>
          <div className={styles.permAssignedHead}>
            <strong>Ready to assign</strong>
            <span className={styles.permAssignedCount}>{pendingPeople.length}</span>
          </div>
          <div className={styles.permAssignedChips}>
            {pendingPeople.map((emp) => (
              <span key={emp.id} className={styles.permUserChip}>
                {emp.name}
                <button
                  type="button"
                  className={styles.permUserChipX}
                  aria-label={`Remove ${emp.name} from list`}
                  onClick={() => removePending(emp.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.permAssignedBar}>
        <div className={styles.permAssignedHead}>
          <strong>
            Assigned users
            {activeRole ? ` — ${activeRole.name}` : ""}
          </strong>
          <span className={styles.permAssignedCount}>{assignedUsers.length}</span>
          {assignedUsers.length > 0 && canAssign && (
            <button
              type="button"
              className={styles.permUnassignBtn}
              disabled={!selectedAssignedIds.length}
              onClick={handleUnassignSelected}
            >
              Unassign selected
              {selectedAssignedIds.length ? ` (${selectedAssignedIds.length})` : ""}
            </button>
          )}
        </div>
        {assignedUsers.length === 0 ? (
          <p className={styles.permAssignedEmpty}>
            No users assigned to this role yet. Add one or more users above.
          </p>
        ) : (
          <div className={styles.permAssignedChips}>
            {assignedUsers.map((emp) => {
              const selected = selectedAssignedIds.includes(emp.id);
              const focused = focusEmployeeId === emp.id;
              const custom = Object.prototype.hasOwnProperty.call(
                employeePermissions,
                emp.id,
              );
              return (
                <div
                  key={emp.id}
                  className={styles.permUserChipWrap}
                  onMouseEnter={() => openHoverCard(emp.id)}
                  onMouseLeave={() => scheduleCloseHoverCard(emp.id)}
                >
                  <label
                    className={`${styles.permUserChip} ${selected ? styles.permUserChipOn : ""} ${focused ? styles.permUserChipFocus : ""}`}
                  >
                    {canAssign && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAssignedSelect(emp.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <span className={styles.permUserChipName}>
                      {emp.name}
                      <span className={styles.permUserChipMeta}>
                        #{emp.id}
                        {custom ? " · custom" : ""}
                      </span>
                    </span>
                    {canAssign && (
                      <button
                        type="button"
                        className={styles.permUserChipX}
                        aria-label={`Unassign ${emp.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleUnassignOne(emp.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </label>

                  {hoverEmployeeId === emp.id && (
                    <div className={styles.permHoverCard} role="dialog">
                      <div className={styles.permHoverCardTop}>
                        <div>
                          <strong>{emp.name}</strong>
                          <span className={styles.permHoverMeta}>
                            {emp.departmentName ? `${emp.departmentName} · ` : ""}
                            {custom ? "Custom permissions" : "From role defaults"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={styles.permHoverEdit}
                          disabled={!canEditPerms}
                          onClick={() => {
                            setFocusEmployeeId(emp.id);
                            setHoverEmployeeId(null);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                      {hoverEmp?.id === emp.id && hoverLabels.length > 0 ? (
                        <div className={styles.permHoverChips}>
                          {hoverLabels.slice(0, 18).map((label) => (
                            <span key={label} className={styles.permAccessChip}>
                              {label}
                            </span>
                          ))}
                          {hoverLabels.length > 18 ? (
                            <span className={styles.permAccessChip}>
                              +{hoverLabels.length - 18} more
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <p className={styles.permAssignedEmpty}>No permissions granted.</p>
                      )}
                      {hoverCustom ? (
                        <p className={styles.permHoverNote}>
                          Saved for this user — survives refresh.
                        </p>
                      ) : (
                        <p className={styles.permHoverNote}>
                          Using role defaults until you Edit &amp; Save.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className={styles.permAssignedHint}>
          Hover a name to preview permissions. Click Edit to change that user only.
        </p>
      </div>

      <div className={styles.permBody}>
        <div className={styles.permBodyHead}>
          <div className={styles.permBodyTitle}>
            <span
              className={styles.permRoleChipDot}
              style={{ background: accentOf(activeRole) }}
            />
            {editingUser ? (
              <>
                Editing <strong>{focusEmployee?.name}</strong>
                <span className={styles.permLockBadge}>
                  {userHasCustom ? "Custom" : "From role"}
                </span>
                <button
                  type="button"
                  className={styles.btnOutlinePurple}
                  style={{ marginLeft: 8, minHeight: 28, padding: "0 10px", fontSize: 12 }}
                  onClick={() => setFocusEmployeeId(null)}
                >
                  Done
                </button>
                {userHasCustom && canEditPerms && (
                  <button
                    type="button"
                    className={styles.permLinkBtn}
                    style={{ marginLeft: 8 }}
                    onClick={() => onClearEmployeeOverrides(focusEmployeeId!)}
                  >
                    Reset to role defaults
                  </button>
                )}
              </>
            ) : (
              <>
                Role defaults — <strong>{activeRole?.name ?? "—"}</strong>
                {locked && <span className={styles.permLockBadge}>Locked</span>}
              </>
            )}
          </div>
          <div className={styles.permProgress}>
            <span className={styles.permProgressText}>
              {grantedCount}/{totalPerms} permissions
            </span>
            <span className={styles.permProgressBar}>
              <span
                className={styles.permProgressFill}
                style={{
                  width: totalPerms
                    ? `${Math.round((grantedCount / totalPerms) * 100)}%`
                    : "0%",
                  background: accentOf(activeRole),
                }}
              />
            </span>
          </div>
        </div>

        {locked && !editingUser && (
          <div className={styles.permLockNote}>
            This role has full system access by design and cannot be edited.
          </div>
        )}

        <div className={styles.permScopeColumns}>
          <div className={styles.permScopeCol}>
            <div className={styles.permScopeColHead}>
              <h3 className={styles.permScopeColTitle}>Own department</h3>
              <p className={styles.permScopeColHint}>
                Same tabs &amp; permissions — data stays limited to the employee&apos;s own
                department / team.
              </p>
            </div>
            <div className={styles.permModules}>
              {renderModuleColumn(sharedModules, "own")}
              {sharedModules.length === 0 && (
                <div className={styles.matrixEmpty}>No matches in this column.</div>
              )}
            </div>
          </div>

          <div className={`${styles.permScopeCol} ${styles.permScopeColAll}`}>
            <div className={styles.permScopeColHead}>
              <h3 className={styles.permScopeColTitle}>All departments</h3>
              <p className={styles.permScopeColHint}>
                Same tabs &amp; permissions — data is company-wide across every department.
              </p>
            </div>
            <div className={styles.permModules}>
              {renderModuleColumn(sharedModules, "all")}
              {sharedModules.length === 0 && (
                <div className={styles.matrixEmpty}>No matches in this column.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.matrixFooter}>
        <div className={styles.permFooterActions}>
          {!editingUser && (
            <button
              type="button"
              className={styles.btnOutlinePurple}
              onClick={() => {
                if (!activeRoleId) return;
                onResetRole(activeRoleId);
              }}
              disabled={!canEditPerms || !activeRoleId || locked}
              title="Officer dashboard only: Employee Dashboard, My Info, Generate Ticket — unchecks all extra permissions and saves"
            >
              Reset role to Default
            </button>
          )}
          <button
            type="button"
            className={styles.btnSolidPurple}
            disabled={
              !canEditPerms ||
              (!editingUser && !activeRoleId) ||
              (editingUser && !focusEmployeeId)
            }
            onClick={() => {
              if (editingUser && focusEmployeeId) {
                onSaveEmployee(focusEmployeeId, activeRoleId);
              } else {
                onSaveRole(activeRoleId);
              }
            }}
          >
            {editingUser ? "Save user permissions" : "Save role permissions"}
          </button>
        </div>
      </div>
    </div>
  );
}
