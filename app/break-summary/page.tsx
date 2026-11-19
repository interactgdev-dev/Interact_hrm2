"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old URL → unified Summaries hub (break tab). */
export default function BreakSummaryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/summaries?view=break");
  }, [router]);
  return null;
}
