"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy admin page removed — agent install/manage lives on Presence / Idle.
 * Keep route so old bookmarks redirect cleanly.
 */
export default function InteractGuardRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/presence-idle");
  }, [router]);
  return null;
}
