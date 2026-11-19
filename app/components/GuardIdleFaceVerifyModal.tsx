"use client";

import React from "react";
import { FaceVerifyModal } from "@/app/components/FaceVerifyModal";

export type GuardIdleFaceResult = {
  verified: boolean;
  code: string;
  error?: string | null;
  similarity?: number | null;
};

type Props = {
  employeeId: string;
  employeeName: string;
  /** WebView2 embed host: card only, no full-page dim. Browser dashboard uses false (same as Break). */
  clearBackdrop?: boolean;
  onResult: (result: GuardIdleFaceResult) => void;
  onCancelled: () => void;
};

/**
 * Idle Guard seat check — literally the same FaceVerifyModal as Start Break /
 * Clock (scanVideoFrame, probes, multi-face, HUD). Only the API differs:
 * presence-check instead of verify + biometric_token.
 */
export function GuardIdleFaceVerifyModal({
  employeeId,
  employeeName,
  clearBackdrop = false,
  onResult,
  onCancelled,
}: Props) {
  return (
    <FaceVerifyModal
      open
      presenceCheck
      clearBackdrop={clearBackdrop}
      maxIdentityFails={2}
      noFaceTimeoutSec={15}
      action="break_start"
      actionLabel="confirm you are at your seat"
      employeeId={employeeId}
      employeeName={employeeName || "Employee"}
      onVerified={() => {
        /* success via onPresenceResult */
      }}
      onPresenceResult={(r) => {
        onResult({
          verified: r.verified,
          code: r.code,
          error: r.error ?? null,
          similarity: r.similarity ?? null,
        });
      }}
      onClose={onCancelled}
    />
  );
}
