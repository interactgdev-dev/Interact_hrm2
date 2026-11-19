"use client";

import { useEffect, useState } from "react";

export type ClientViewerScope = {
  mode: "all" | "department" | "team" | "self";
  orgChip: string | null;
  departmentNames: string[];
  employeeIds: string[];
  orgRole: string | null;
  loaded: boolean;
};

const ALL_SCOPE: ClientViewerScope = {
  mode: "all",
  orgChip: null,
  departmentNames: [],
  employeeIds: [],
  orgRole: null,
  loaded: true,
};

function readEmployeeId(): string {
  try {
    const id = String(localStorage.getItem("employeeId") || "").trim();
    if (/^\d+$/.test(id)) return id;
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * Loads data_scope for the logged-in employee (any page — leave, attendance, dashboard).
 * No employeeId / admin → mode "all".
 */
export function useViewerDataScope(): ClientViewerScope {
  const [scope, setScope] = useState<ClientViewerScope>({
    ...ALL_SCOPE,
    loaded: false,
  });

  useEffect(() => {
    const eid = readEmployeeId();
    if (!eid) {
      setScope(ALL_SCOPE);
      return;
    }
    let cancelled = false;
    fetch(`/api/access-control/me?employeeId=${encodeURIComponent(eid)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.success) {
          if (!cancelled) setScope(ALL_SCOPE);
          return;
        }
        const ds = data.data_scope;
        if (!ds || ds.mode === "all") {
          setScope({
            ...ALL_SCOPE,
            orgRole: ds?.orgRole || null,
            loaded: true,
          });
          return;
        }
        setScope({
          mode: ds.mode,
          orgChip: ds.orgChip || null,
          departmentNames: Array.isArray(ds.departmentNames) ? ds.departmentNames : [],
          employeeIds: Array.isArray(ds.employeeIds)
            ? ds.employeeIds.map(String)
            : [],
          orgRole: ds.orgRole || null,
          loaded: true,
        });
      })
      .catch(() => {
        if (!cancelled) setScope(ALL_SCOPE);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return scope;
}

export function filterDepartmentsByScope<T extends { name?: string | null }>(
  departments: T[],
  scope: ClientViewerScope,
): T[] {
  if (scope.mode === "all" || !scope.loaded) return departments;
  if (!scope.departmentNames.length) {
    // Department/team scoped but no dept names resolved — do not leak all depts
    return [];
  }
  const allow = new Set(scope.departmentNames.map((n) => n.trim().toLowerCase()));
  return departments.filter((d) => allow.has(String(d.name || "").trim().toLowerCase()));
}

export function rowAllowedByScope(
  scope: ClientViewerScope,
  employeeId: string | number | null | undefined,
  departmentName?: string | null,
): boolean {
  if (scope.mode === "all" || !scope.loaded) return true;
  const id = employeeId != null ? String(employeeId).trim() : "";
  if (id && scope.employeeIds.includes(id)) return true;
  const dept = departmentName != null ? String(departmentName).trim() : "";
  if (
    dept &&
    scope.departmentNames.some((d) => d.trim().toLowerCase() === dept.toLowerCase())
  ) {
    return true;
  }
  return false;
}
