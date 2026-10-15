"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SystemControlPage from "../../admin/system-control/page";

/** Managers only — HR juniors are redirected away. */
export default function EmployeeSystemControlPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const eid =
      (typeof window !== "undefined" &&
        (localStorage.getItem("employeeId") || localStorage.getItem("loginId"))) ||
      "";
    if (!eid || !/^\d+$/.test(eid)) {
      setAllowed(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/access-control/me?employeeId=${encodeURIComponent(eid)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const ok = Boolean(data?.capabilities?.systemControlOpen);
        setAllowed(ok);
        if (!ok) router.replace("/employee-dashboard");
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false);
          router.replace("/employee-dashboard");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (allowed !== true) {
    return (
      <div style={{ padding: 24, color: "#64748b", fontSize: 14 }}>
        Checking System Control access…
      </div>
    );
  }

  return <SystemControlPage />;
}
