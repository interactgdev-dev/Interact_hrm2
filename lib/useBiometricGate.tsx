"use client";

import React from "react";
import type { BiometricAction } from "@/lib/face-types";
import { FaceVerifyModal } from "@/app/components/FaceVerifyModal";
import { ensureFaceModelsLoaded } from "@/lib/face-client-engine";
import { toastInfo } from "@/lib/app-toast";

type PendingAction = {
  action: BiometricAction;
  callback: (biometricToken: string | null) => void | Promise<void>;
};

type BioStatus = {
  enforcementRequired: boolean;
  connected: boolean;
  enrolled: boolean;
  enrollmentCount: number;
  descriptorCount: number;
  needsDescriptorRefresh: boolean;
  loading: boolean;
};

const ACTION_LABELS: Record<BiometricAction, string> = {
  clock_in: "Clock In",
  clock_out: "Clock Out",
  break_start: "Start Break",
  break_end: "End Break",
  prayer_start: "Start Prayer",
  prayer_end: "End Prayer",
  refreshment_start: "Start Refreshment",
  refreshment_end: "End Refreshment",
  meeting_start: "Start Meeting",
  meeting_end: "End Meeting",
};

export type VerifyModalCloseReason = "cancel" | "success";

type BiometricGateOptions = {
  onVerifyOpen?: (action: BiometricAction) => void;
  onVerifyClose?: (action: BiometricAction | null, reason: VerifyModalCloseReason) => void;
};

export function useBiometricGate(
  employeeId: string,
  employeeName: string,
  options: BiometricGateOptions = {}
) {
  const [bioStatus, setBioStatus] = React.useState<BioStatus>({
    enforcementRequired: false,
    connected: false,
    enrolled: false,
    enrollmentCount: 0,
    descriptorCount: 0,
    needsDescriptorRefresh: false,
    loading: true,
  });
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [faceEngineReady, setFaceEngineReady] = React.useState(false);
  const pendingRef = React.useRef<PendingAction | null>(null);

  const refreshStatus = React.useCallback(async () => {
    if (!employeeId) {
      setBioStatus({
        enforcementRequired: false,
        connected: false,
        enrolled: false,
        enrollmentCount: 0,
        descriptorCount: 0,
        needsDescriptorRefresh: false,
        loading: false,
      });
      return;
    }
    try {
      const params = new URLSearchParams({
        employeeId,
        employeeName: employeeName || "",
      });
      const res = await fetch(`/api/biometric/status?${params}`, { cache: "no-store" });
      const data = await res.json();
      setBioStatus({
        enforcementRequired: Boolean(data.enforcementRequired ?? data.enabled),
        connected: Boolean(data.connected ?? true),
        enrolled: Boolean(data.enrolled),
        enrollmentCount: Number(data.enrollmentCount ?? 0),
        descriptorCount: Number(data.descriptorCount ?? 0),
        needsDescriptorRefresh: Boolean(data.needsDescriptorRefresh),
        loading: false,
      });
    } catch {
      setBioStatus((prev) => ({ ...prev, loading: false }));
    }
  }, [employeeId, employeeName]);

  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Do not preload face-api/TFJS on mount — it steals the main thread and
  // makes sidebar navigation feel stuck. Models load when verify opens.
  React.useEffect(() => {
    if (!employeeId) setFaceEngineReady(false);
  }, [employeeId]);

  const onVerifyOpenRef = React.useRef(options.onVerifyOpen);
  const onVerifyCloseRef = React.useRef(options.onVerifyClose);
  onVerifyOpenRef.current = options.onVerifyOpen;
  onVerifyCloseRef.current = options.onVerifyClose;

  const openVerifyModal = React.useCallback(
    (action: BiometricAction, callback: (biometricToken: string | null) => void | Promise<void>) => {
      const item = { action, callback };
      pendingRef.current = item;
      setPending(item);
      setModalOpen(true);
      onVerifyOpenRef.current?.(action);
    },
    []
  );

  const runWithVerify = React.useCallback(
    (action: BiometricAction, callback: (biometricToken: string | null) => void | Promise<void>) => {
      if (bioStatus.loading) {
        toastInfo("Face verification is loading. Please wait a moment.");
        return;
      }

      // If enforcement is on but models are still downloading, do NOT block the
      // click — the verify modal starts the camera and loads the engine in
      // parallel, showing its own "Loading face engine…" state. Kick off the
      // load (idempotent) and open the modal so the user is never stuck waiting.
      if (bioStatus.enforcementRequired && !faceEngineReady) {
        void ensureFaceModelsLoaded().then(() => setFaceEngineReady(true));
      }

      if (!bioStatus.enforcementRequired) {
        void callback(null);
        return;
      }

      if (!bioStatus.enrolled) {
        if (bioStatus.needsDescriptorRefresh || bioStatus.enrollmentCount >= 3) {
          toastInfo(
            "Your photos are saved but face profiles need a one-time refresh. Ask HR to open Admin → Face Enrollment, select your name — it will auto-update in a few seconds."
          );
        } else {
          toastInfo(
            `Your face is not enrolled (${bioStatus.descriptorCount}/3 profiles). Ask HR at Admin → Face Enrollment to add 3+ clear front-face photos.`
          );
        }
        return;
      }

      openVerifyModal(action, callback);
    },
    [bioStatus, faceEngineReady, openVerifyModal]
  );

  const handleVerified = React.useCallback(async (token: string) => {
    const current = pendingRef.current;
    const action = current?.action ?? null;
    setModalOpen(false);
    setPending(null);
    pendingRef.current = null;
    onVerifyCloseRef.current?.(action, "success");
    if (current) await current.callback(token);
  }, []);

  const handleClose = React.useCallback(() => {
    const action = pendingRef.current?.action ?? null;
    setModalOpen(false);
    setPending(null);
    pendingRef.current = null;
    onVerifyCloseRef.current?.(action, "cancel");
  }, []);

  const gateModal =
    modalOpen && pending ? (
      <FaceVerifyModal
        open
        action={pending.action}
        actionLabel={ACTION_LABELS[pending.action]}
        employeeId={employeeId}
        employeeName={employeeName}
        onVerified={handleVerified}
        onClose={handleClose}
      />
    ) : null;

  return {
    runWithVerify,
    gateModal,
    modalOpen,
    bioStatusLoading: bioStatus.loading,
    bioEnforcementRequired: bioStatus.enforcementRequired,
    faceEngineReady,
    refreshBioStatus: refreshStatus,
  };
}
