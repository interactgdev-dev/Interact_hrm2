"use client";

import React from "react";
import { usePathname } from "next/navigation";
import LayoutDashboard from "../layout-dashboard";
import {
  isEmployeeBrowserSession,
  useEmployeeShell,
} from "@/lib/access-control/employee-shell";
import { ADMIN_PATH_TO_EMPLOYEE } from "@/lib/access-control/menu-registry";

/**
 * Full admin sidebar chrome on admin routes.
 * Under `/employee-dashboard` only renders page content (employee shell owns nav).
 */
export default function OptionalAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inEmployeeLayout = useEmployeeShell();
  const underEmployeeRoute = Boolean(pathname?.startsWith("/employee-dashboard"));

  React.useLayoutEffect(() => {
    if (underEmployeeRoute || inEmployeeLayout) return;
    if (!isEmployeeBrowserSession()) return;

    const path = pathname || "";
    const mapped =
      ADMIN_PATH_TO_EMPLOYEE[path] ||
      Object.entries(ADMIN_PATH_TO_EMPLOYEE).find(
        ([adminPath]) => path === adminPath || path.startsWith(`${adminPath}/`),
      )?.[1];

    if (mapped) {
      window.location.replace(mapped);
      return;
    }
    if (
      path.startsWith("/admin") ||
      path.startsWith("/summaries") ||
      path === "/leave" ||
      path.startsWith("/attendance")
    ) {
      window.location.replace("/employee-dashboard");
    }
  }, [pathname, underEmployeeRoute, inEmployeeLayout]);

  // Never strip admin chrome on admin URLs — only when nested in employee dashboard.
  if (inEmployeeLayout || underEmployeeRoute) {
    return <>{children}</>;
  }

  return <LayoutDashboard>{children}</LayoutDashboard>;
}
