"use client";

import React from "react";

const EmployeeShellContext = React.createContext(false);

const ADMIN_LOGIN_IDS = new Set(["admin@interact.com", "interactadmin", "admin"]);

export function clearPortalSessionKeys() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("employeeId");
    localStorage.removeItem("employeeName");
    localStorage.removeItem("userRole");
    localStorage.removeItem("accessPermissions");
    localStorage.removeItem("accessRoleSlug");
    localStorage.removeItem("employeeAccessMenuCache");
    localStorage.removeItem("hrmPortal");
    sessionStorage.removeItem("hrmPortal");
  } catch {
    /* ignore */
  }
}

export function markAdminPortal() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("hrmPortal", "admin");
    sessionStorage.setItem("hrmPortal", "admin");
    localStorage.removeItem("employeeId");
    localStorage.removeItem("employeeName");
    localStorage.removeItem("accessPermissions");
    localStorage.removeItem("accessRoleSlug");
    localStorage.removeItem("employeeAccessMenuCache");
  } catch {
    /* ignore */
  }
}

export function markEmployeePortal(employeeId?: string, employeeName?: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("hrmPortal", "employee");
    sessionStorage.setItem("hrmPortal", "employee");
    if (employeeId && /^\d+$/.test(employeeId)) {
      localStorage.setItem("employeeId", employeeId);
    }
    if (employeeName) {
      const cleaned = String(employeeName).trim();
      // Never persist email / numeric login id as the profile display name
      if (cleaned && !cleaned.includes("@") && !/^\d+$/.test(cleaned)) {
        localStorage.setItem("employeeName", cleaned);
      }
    }
  } catch {
    /* ignore */
  }
}

function readLoginId(): string {
  try {
    return String(localStorage.getItem("loginId") || "")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

/** True when rendered under `/employee-dashboard` layout. */
export function EmployeeShellProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    markEmployeePortal();
  }, []);
  return (
    <EmployeeShellContext.Provider value={true}>{children}</EmployeeShellContext.Provider>
  );
}

export function useEmployeeShell(): boolean {
  return React.useContext(EmployeeShellContext);
}

/** Admin login id always wins over a leftover employee portal flag. */
export function isAdminBrowserSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (ADMIN_LOGIN_IDS.has(readLoginId())) return true;
    const portal =
      localStorage.getItem("hrmPortal") || sessionStorage.getItem("hrmPortal") || "";
    return portal === "admin";
  } catch {
    return false;
  }
}

/** Active employee portal — never true while an admin account is logged in. */
export function isEmployeeBrowserSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (isAdminBrowserSession()) return false;
    const portal =
      localStorage.getItem("hrmPortal") || sessionStorage.getItem("hrmPortal") || "";
    if (portal === "employee") return true;
    return /^\d+$/.test(localStorage.getItem("employeeId") || "");
  } catch {
    return false;
  }
}
