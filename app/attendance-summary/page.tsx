"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old URL → unified Summaries hub (attendance tab). */
export default function AttendanceSummaryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/summaries?view=attendance");
  }, [router]);
  return null;
}
