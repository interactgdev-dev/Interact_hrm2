"use client";

import React from "react";
import { useRouter } from "next/navigation";
import SecretPasswordModal from "@/app/components/SecretPasswordModal";
import { toastError } from "@/lib/app-toast";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Secret unlock modal — same password UI as System Control Backlog Tracker. */
export default function GuardScreenshotsGallery({ open, onClose }: Props) {
  const router = useRouter();
  const [unlocking, setUnlocking] = React.useState(false);

  async function unlock(password: string) {
    if (!password || unlocking) return;
    setUnlocking(true);
    try {
      const res = await fetch("/api/admin/guard-screenshots/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Invalid password");
        return;
      }
      onClose();
      router.push("/admin/guard-screenshots");
    } catch {
      toastError("Network error");
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <SecretPasswordModal
      open={open}
      unlocking={unlocking}
      onClose={onClose}
      onSubmit={unlock}
    />
  );
}
