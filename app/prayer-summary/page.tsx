"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old URL → unified Summaries hub (prayer tab). */
export default function PrayerSummaryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/summaries?view=prayer");
  }, [router]);
  return null;
}
