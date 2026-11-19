"use client";

import React from "react";
import { GuardIdleFaceVerifyModal } from "@/app/components/GuardIdleFaceVerifyModal";

type Challenge = {
  checkId: string;
  employeeId: string;
  employeeName: string;
};

/**
 * Optional in-page FaceVerify when a session is NOT agent-hosted.
 * Idle Guard (1.2.41+) uses its own topmost WebView — those sessions are skipped
 * by the API (agentHost) so camera works even if this tab is in the background.
 */
export function GuardPresenceFaceHost({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [challenge, setChallenge] = React.useState<Challenge | null>(null);
  const busyRef = React.useRef(false);
  const handledRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!employeeId || !/^\d+$/.test(employeeId)) return;

    let cancelled = false;
    let intervalId: number | undefined;
    let startId: number | undefined;
    const tick = async () => {
      if (cancelled || busyRef.current) return;
      try {
        const res = await fetch(
          `/api/biometric/presence-session?employeeId=${encodeURIComponent(employeeId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.pending || !data?.check_id || !data?.start) return;
        const cid = String(data.check_id);
        if (handledRef.current === cid) return;
        setChallenge({
          checkId: cid,
          employeeId: String(data.employee_id || employeeId),
          employeeName: employeeName || "Employee",
        });
      } catch {
        /* ignore */
      }
    };

    // Defer Guard polling so clock/menu/attendance APIs win the first paint.
    const start = () => {
      if (cancelled) return;
      void tick();
      intervalId = window.setInterval(tick, 2500);
    };
    const canIdle =
      typeof window !== "undefined" && "requestIdleCallback" in window;
    if (canIdle) {
      startId = window.requestIdleCallback(start, { timeout: 4000 });
    } else {
      startId = window.setTimeout(start, 2500);
    }
    return () => {
      cancelled = true;
      if (canIdle) {
        window.cancelIdleCallback(startId as number);
      } else if (startId !== undefined) {
        window.clearTimeout(startId);
      }
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [employeeId, employeeName]);

  const finish = React.useCallback(
    async (payload: {
      cameraOk: boolean;
      atSeat: boolean;
      code: string;
      error?: string | null;
      similarity?: number | null;
    }) => {
      const ch = challenge;
      if (!ch || busyRef.current) return;
      busyRef.current = true;
      handledRef.current = ch.checkId;
      try {
        await fetch("/api/biometric/presence-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ check_id: ch.checkId, result: payload }),
        });
      } catch {
        /* ignore */
      }
      setChallenge(null);
      busyRef.current = false;
    },
    [challenge],
  );

  if (!challenge) return null;

  return (
    <GuardIdleFaceVerifyModal
      employeeId={challenge.employeeId}
      employeeName={challenge.employeeName || employeeName || "Employee"}
      clearBackdrop={false}
      onResult={(r) => {
        void finish({
          cameraOk: true,
          atSeat: r.verified,
          code: r.code,
          error: r.error ?? null,
          similarity: r.similarity ?? null,
        });
      }}
      onCancelled={() => {
        void finish({
          cameraOk: true,
          atSeat: false,
          code: "cancelled",
          error: "Face verification cancelled",
        });
      }}
    />
  );
}
