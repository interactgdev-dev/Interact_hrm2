"use client";

import React from "react";
import { AUTO_PRESENCE_POPUP_MS } from "@/lib/shift-timing";
import { ModalPortal } from "./ModalPortal";
import styles from "./AutoPresencePrompt.module.css";
import { toastError } from "@/lib/app-toast";

const deadlineStorageKey = (employeeId: string, attendanceId: number) =>
  `auto_presence_deadline_${employeeId}_${attendanceId}`;

type Props = {
  employeeId: string;
  employeeName: string;
  isClockedIn: boolean;
  onClockedOut: () => void;
  /** True after shift/session 3h grace — clock-out must not require face verify. */
  onGraceExpiredChange?: (graceExpired: boolean) => void;
};

export function AutoPresencePrompt({
  employeeId,
  employeeName,
  isClockedIn,
  onClockedOut,
  onGraceExpiredChange,
}: Props) {
  const [visible, setVisible] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(300);
  const [busy, setBusy] = React.useState(false);

  const deadlineRef = React.useRef<number | null>(null);
  const attendanceIdRef = React.useRef<number | null>(null);
  const firedRef = React.useRef(false);
  const ackSnoozeUntilRef = React.useRef(0);
  const busyRef = React.useRef(false);
  const onClockedOutRef = React.useRef(onClockedOut);
  const onGraceExpiredChangeRef = React.useRef(onGraceExpiredChange);

  busyRef.current = busy;
  onClockedOutRef.current = onClockedOut;
  onGraceExpiredChangeRef.current = onGraceExpiredChange;

  const clearPopupState = React.useCallback((attendanceId?: number | null) => {
    deadlineRef.current = null;
    firedRef.current = false;
    setVisible(false);
    if (employeeId && attendanceId != null) {
      sessionStorage.removeItem(deadlineStorageKey(employeeId, attendanceId));
    }
  }, [employeeId]);

  const runAutoClockOut = React.useCallback(async () => {
    if (firedRef.current || busyRef.current) return;
    firedRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/auto-presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          action: "auto_clock_out",
        }),
      });
      const data = await res.json();
      if (data.success) {
        clearPopupState(attendanceIdRef.current);
        onClockedOutRef.current();
      } else {
        firedRef.current = false;
        toastError(data.error || "Auto clock out failed");
      }
    } catch {
      firedRef.current = false;
      toastError("Auto clock out failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [employeeId, employeeName, clearPopupState]);

  const resolveDeadline = React.useCallback((promptAtMs: unknown, now: number) => {
    const promptAt = Number(promptAtMs);
    if (Number.isFinite(promptAt) && promptAt > 0) {
      return promptAt + AUTO_PRESENCE_POPUP_MS;
    }
    return now + AUTO_PRESENCE_POPUP_MS;
  }, []);

  const pollPresence = React.useCallback(async () => {
    if (!employeeId || !isClockedIn) return;

    if (Date.now() < ackSnoozeUntilRef.current) {
      setVisible(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/attendance/auto-presence-check?employeeId=${encodeURIComponent(employeeId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!data.success || !data.clockedIn) {
        onGraceExpiredChangeRef.current?.(false);
        clearPopupState(attendanceIdRef.current);
        attendanceIdRef.current = null;
        return;
      }

      onGraceExpiredChangeRef.current?.(Boolean(data.shouldPrompt));

      const attendanceId = Number(data.attendanceId);
      if (!Number.isFinite(attendanceId)) return;

      if (attendanceIdRef.current != null && attendanceIdRef.current !== attendanceId) {
        clearPopupState(attendanceIdRef.current);
      }
      attendanceIdRef.current = attendanceId;

      const now = Date.now();
      const storageKey = deadlineStorageKey(employeeId, attendanceId);

      if (!data.shouldPrompt) {
        sessionStorage.removeItem(storageKey);
        deadlineRef.current = null;
        firedRef.current = false;
        setVisible(false);
        return;
      }

      const serverDeadline = resolveDeadline(data.promptAtMs, now);
      let deadline = Number(sessionStorage.getItem(storageKey));
      if (!Number.isFinite(deadline)) {
        deadline = serverDeadline;
        sessionStorage.setItem(storageKey, String(deadline));
      } else if (Math.abs(deadline - serverDeadline) > 2000) {
        deadline = serverDeadline;
        sessionStorage.setItem(storageKey, String(deadline));
      }

      if (now >= deadline) {
        await runAutoClockOut();
        return;
      }

      deadlineRef.current = deadline;
      setVisible(true);
      setSecondsLeft(Math.max(0, Math.ceil((deadline - now) / 1000)));
    } catch {
      // ignore poll errors
    }
  }, [employeeId, isClockedIn, clearPopupState, runAutoClockOut, resolveDeadline]);

  const handleAck = React.useCallback(async () => {
    if (busyRef.current) return;
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/auto-presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: employeeId, action: "ack" }),
      });
      const data = await res.json();
      if (data.success) {
        ackSnoozeUntilRef.current = Date.now() + 5000;
        clearPopupState(attendanceIdRef.current);
        await pollPresence();
      } else {
        toastError(data.error || "Could not save response");
      }
    } catch {
      toastError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [employeeId, clearPopupState, pollPresence]);

  React.useEffect(() => {
    if (!employeeId || !isClockedIn) {
      clearPopupState(attendanceIdRef.current);
      attendanceIdRef.current = null;
      return;
    }

    pollPresence();
    const pollId = setInterval(pollPresence, 30000);
    return () => clearInterval(pollId);
  }, [employeeId, isClockedIn, pollPresence, clearPopupState]);

  React.useEffect(() => {
    const tickId = setInterval(() => {
      const deadline = deadlineRef.current;
      if (!deadline) return;
      const now = Date.now();
      const left = Math.max(0, Math.ceil((deadline - now) / 1000));
      setSecondsLeft(left);
      if (now >= deadline) {
        runAutoClockOut();
      }
    }, 1000);

    return () => clearInterval(tickId);
  }, [runAutoClockOut]);

  if (!visible) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const totalSec = Math.max(1, Math.round(AUTO_PRESENCE_POPUP_MS / 1000));
  const ringR = 58;
  const ringC = 2 * Math.PI * ringR;
  const ringFrac = Math.min(1, Math.max(0, secondsLeft / totalSec));
  const urgent = secondsLeft <= 60;

  return (
    <ModalPortal>
      <div className={styles.overlay} data-hrm-modal-overlay>
        <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="auto-presence-title">
          <div id="auto-presence-title" className={styles.title}>
            Still working?
          </div>
          <p className={styles.message}>
            Your assigned shift ended and the <strong>3-hour grace period</strong> is over.
            You are still clocked in. Tap <strong>I am here</strong> if you are available.
          </p>
          <div className={styles.ringWrap} aria-hidden="true">
            <svg className={styles.ringSvg} viewBox="0 0 132 132">
              <circle className={styles.ringTrack} cx="66" cy="66" r={ringR} />
              <circle
                className={`${styles.ringProgress}${urgent ? ` ${styles.ringProgressUrgent}` : ""}`}
                cx="66"
                cy="66"
                r={ringR}
                strokeDasharray={ringC}
                strokeDashoffset={ringC * (1 - ringFrac)}
              />
            </svg>
            <div className={`${styles.ringTime}${urgent ? ` ${styles.ringTimeUrgent}` : ""}`}>
              {mins}:{String(secs).padStart(2, "0")}
            </div>
          </div>
          <div className={styles.timerLabel}>Auto clock-out in</div>
          <button type="button" className={styles.ackButton} disabled={busy} onClick={handleAck}>
            I am here
          </button>
          <p className={styles.hint}>Session closes automatically if no response.</p>
        </div>
      </div>
    </ModalPortal>
  );
}
