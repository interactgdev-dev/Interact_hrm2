"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Policy UI is a secret panel inside Guard Screenshots — not a public menu page. */
export default function GuardPolicyRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/guard-screenshots");
  }, [router]);
  return null;
}
