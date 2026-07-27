"use client";

import React from "react";
import { createPortal } from "react-dom";
import './ClockBreakPrayerFade.css';
import slackStyles from './clock-widgets-slack.module.css';
import modalStyles from './clock-break-prayer-modals.module.css';
import { PrayerButton } from "./PrayerButton";
import {
  clearClockSyncInterval,
  forceSyncClockState,
} from "../../lib/ui-sync/forceSyncClockState";
import { getParts } from "../../lib/timezone";
import {
  forceSyncBreakState,
  clearBreakSyncInterval,
} from "../../lib/ui-sync/forceSyncBreakState";
import {
  forceSyncPrayerBreakState,
  clearPrayerBreakSyncInterval,
} from "../../lib/ui-sync/forceSyncPrayerBreakState";
import { getDateStringInTimeZone } from "../../lib/timezone";
import { AutoPresencePrompt } from "./AutoPresencePrompt";
import {
  ATTENDANCE_DATA_CHANGED,
  BREAK_DATA_CHANGED,
  notifyAttendanceDataChanged,
  notifyBreakDataChanged,
  notifyPrayerDataChanged,
} from "../../lib/ui-sync/breakPrayerDataRefresh";
import { useBiometricGate, type VerifyModalCloseReason } from "../../lib/useBiometricGate";
import type { BiometricAction } from "@/lib/face-types";
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";

/** When clocked in across midnight, breaks span multiple calendar days; use session range, not date=today only. */
function buildBreaksListUrl(employeeId: string, attendanceRows: any[]): string {
  const today = getDateStringInTimeZone(new Date());
  const sorted = attendanceRows
    .filter((a: any) => a.clock_in)
    .sort(
      (a: any, b: any) =>
        (toKarachiEpochMs(b.clock_in) || 0) - (toKarachiEpochMs(a.clock_in) || 0)
    );
  const activeOpen = sorted.find((a: any) => a.clock_in && !a.clock_out) || null;
  let url = `/api/breaks?employeeId=${encodeURIComponent(employeeId)}`;
  if (activeOpen?.clock_in) {
    const from = getDateStringInTimeZone(activeOpen.clock_in);
    url += `&fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(today)}`;
  } else {
    url += `&date=${encodeURIComponent(today)}`;
  }
  return url;
}

function toKarachiEpochMs(value: string | Date | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parts = getParts(value, "Asia/Karachi");
  if (!parts) return null;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

// Compact widget combining Clock In/Out, Break, and Prayer controls
export const ClockBreakPrayerWidget = React.memo(function ClockBreakPrayerWidget({
  employeeId,
  employeeName,
  variant = "default",
}: {
  employeeId: string;
  employeeName: string;
  variant?: "default" | "slack";
}) {
  const isSlack = variant === "slack";
  const [isPrayerOn, setIsPrayerOn] = React.useState(false);
  const [prayerStart, setPrayerStart] = React.useState<Date | null>(null);
  const [isOnBreak, setIsOnBreak] = React.useState(false);
  const [isClockedIn, setIsClockedIn] = React.useState(false);
  const [timer, setTimer] = React.useState(0);
  // getParts is now exported and can be imported if needed
  const [loadingAttendance, setLoadingAttendance] = React.useState(true);
  const [clockActionPending, setClockActionPending] = React.useState(false);
  const [intervalId, setIntervalId] = React.useState<NodeJS.Timeout | null>(null);
  
  // Break sync states
  const [breakIntervalId, setBreakIntervalId] = React.useState<NodeJS.Timeout | null>(null);
  const [breakTimer, setBreakTimer] = React.useState(0);
  const [loadingBreak, setLoadingBreak] = React.useState(true);
  const [breakActionPending, setBreakActionPending] = React.useState(false);
  
  // Prayer break sync states
  const [prayerBreakIntervalId, setPrayerBreakIntervalId] = React.useState<NodeJS.Timeout | null>(null);
  const [prayerBreakTimer, setPrayerBreakTimer] = React.useState(0);
  const [loadingPrayerBreak, setLoadingPrayerBreak] = React.useState(true);
  
  // Error and confirmation states
  const [fadeIn, setFadeIn] = React.useState(false);
  const [showClockOutConfirm, setShowClockOutConfirm] = React.useState(false);
  const [showActiveBreakModal, setShowActiveBreakModal] = React.useState(false);
  const [activeBreakTitle, setActiveBreakTitle] = React.useState("Active Break");
  const [activeBreakErrorMsg, setActiveBreakErrorMsg] = React.useState<string | null>(null);
  const [breakTimerPaused, setBreakTimerPaused] = React.useState(false);
  const breakTimerPausedRef = React.useRef(false);
  const prayerTimerPausedRef = React.useRef(false);

  const breakEndAtRef = React.useRef<Date | null>(null);
  const breakStartMsRef = React.useRef<number | null>(null);
  const breakPausedMsRef = React.useRef(0);
  const breakPauseStartedAtRef = React.useRef<number | null>(null);
  const breakPauseTickRef = React.useRef<NodeJS.Timeout | null>(null);

  const [prayerTimerPaused, setPrayerTimerPaused] = React.useState(false);
  const prayerEndAtRef = React.useRef<Date | null>(null);
  const prayerStartMsRef = React.useRef<number | null>(null);
  const prayerPausedMsRef = React.useRef(0);
  const prayerPauseStartedAtRef = React.useRef<number | null>(null);
  const prayerPauseTickRef = React.useRef<NodeJS.Timeout | null>(null);
  const graceExpiredForClockOutRef = React.useRef(false);

  const clearBreakPauseTick = React.useCallback(() => {
    if (breakPauseTickRef.current) {
      clearInterval(breakPauseTickRef.current);
      breakPauseTickRef.current = null;
    }
  }, []);

  const syncBreakStartAnchor = React.useCallback((elapsedSeconds: number) => {
    if (!isOnBreak) {
      breakStartMsRef.current = null;
      return;
    }
    if (breakStartMsRef.current === null && elapsedSeconds >= 0) {
      breakStartMsRef.current = Date.now() - elapsedSeconds * 1000;
    }
  }, [isOnBreak]);

  const pauseBreakTimerForVerify = React.useCallback(() => {
    syncBreakStartAnchor(breakTimer);
    clearBreakSyncInterval(employeeId);
    if (breakIntervalId) clearInterval(breakIntervalId);
    clearBreakPauseTick();

    if (breakTimerPausedRef.current && breakPauseStartedAtRef.current) {
      breakPausedMsRef.current += Date.now() - breakPauseStartedAtRef.current;
    }
    breakPauseStartedAtRef.current = Date.now();
    breakTimerPausedRef.current = true;
    setBreakTimerPaused(true);

    breakPauseTickRef.current = setInterval(() => {
      if (!breakStartMsRef.current) return;
      let pausedTotal = breakPausedMsRef.current;
      if (breakPauseStartedAtRef.current) {
        pausedTotal += Date.now() - breakPauseStartedAtRef.current;
      }
      const elapsed = Math.floor((Date.now() - breakStartMsRef.current - pausedTotal) / 1000);
      setBreakTimer(Math.max(0, elapsed));
    }, 1000);
  }, [
    breakIntervalId,
    breakTimer,
    clearBreakPauseTick,
    employeeId,
    syncBreakStartAnchor,
  ]);

  const resumeBreakTimerAfterVerify = React.useCallback(() => {
    if (breakPauseStartedAtRef.current) {
      breakPausedMsRef.current += Date.now() - breakPauseStartedAtRef.current;
      breakPauseStartedAtRef.current = null;
    }
    breakTimerPausedRef.current = false;
    setBreakTimerPaused(false);
    clearBreakPauseTick();
    clearBreakSyncInterval(employeeId);

    breakPauseTickRef.current = setInterval(() => {
      if (!breakStartMsRef.current) return;
      const elapsed = Math.floor(
        (Date.now() - breakStartMsRef.current - breakPausedMsRef.current) / 1000
      );
      setBreakTimer(Math.max(0, elapsed));
    }, 1000);
  }, [clearBreakPauseTick, employeeId]);

  const resetBreakPauseState = React.useCallback(() => {
    breakEndAtRef.current = null;
    breakStartMsRef.current = null;
    breakPausedMsRef.current = 0;
    breakPauseStartedAtRef.current = null;
    breakTimerPausedRef.current = false;
    setBreakTimerPaused(false);
    clearBreakPauseTick();
  }, [clearBreakPauseTick]);

  const clearPrayerPauseTick = React.useCallback(() => {
    if (prayerPauseTickRef.current) {
      clearInterval(prayerPauseTickRef.current);
      prayerPauseTickRef.current = null;
    }
  }, []);

  const syncPrayerStartAnchor = React.useCallback((elapsedSeconds: number) => {
    if (!isPrayerOn) {
      prayerStartMsRef.current = null;
      return;
    }
    if (prayerStartMsRef.current === null && elapsedSeconds >= 0) {
      prayerStartMsRef.current = Date.now() - elapsedSeconds * 1000;
    }
  }, [isPrayerOn]);

  const pausePrayerTimerForVerify = React.useCallback(() => {
    syncPrayerStartAnchor(prayerBreakTimer);
    clearPrayerBreakSyncInterval(employeeId);
    if (prayerBreakIntervalId) clearInterval(prayerBreakIntervalId);
    clearPrayerPauseTick();

    if (prayerTimerPausedRef.current && prayerPauseStartedAtRef.current) {
      prayerPausedMsRef.current += Date.now() - prayerPauseStartedAtRef.current;
    }
    prayerPauseStartedAtRef.current = Date.now();
    prayerTimerPausedRef.current = true;
    setPrayerTimerPaused(true);

    prayerPauseTickRef.current = setInterval(() => {
      if (!prayerStartMsRef.current) return;
      let pausedTotal = prayerPausedMsRef.current;
      if (prayerPauseStartedAtRef.current) {
        pausedTotal += Date.now() - prayerPauseStartedAtRef.current;
      }
      const elapsed = Math.floor(
        (Date.now() - prayerStartMsRef.current - pausedTotal) / 1000
      );
      setPrayerBreakTimer(Math.max(0, elapsed));
    }, 1000);
  }, [
    clearPrayerPauseTick,
    employeeId,
    prayerBreakIntervalId,
    prayerBreakTimer,
    syncPrayerStartAnchor,
  ]);

  const resumePrayerTimerAfterVerify = React.useCallback(() => {
    if (prayerPauseStartedAtRef.current) {
      prayerPausedMsRef.current += Date.now() - prayerPauseStartedAtRef.current;
      prayerPauseStartedAtRef.current = null;
    }
    prayerTimerPausedRef.current = false;
    setPrayerTimerPaused(false);
    clearPrayerPauseTick();
    clearPrayerBreakSyncInterval(employeeId);

    prayerPauseTickRef.current = setInterval(() => {
      if (!prayerStartMsRef.current) return;
      const elapsed = Math.floor(
        (Date.now() - prayerStartMsRef.current - prayerPausedMsRef.current) / 1000
      );
      setPrayerBreakTimer(Math.max(0, elapsed));
    }, 1000);
  }, [clearPrayerPauseTick, employeeId]);

  const resetPrayerPauseState = React.useCallback(() => {
    prayerEndAtRef.current = null;
    prayerStartMsRef.current = null;
    prayerPausedMsRef.current = 0;
    prayerPauseStartedAtRef.current = null;
    prayerTimerPausedRef.current = false;
    setPrayerTimerPaused(false);
    clearPrayerPauseTick();
  }, [clearPrayerPauseTick]);

  React.useEffect(() => {
    breakTimerPausedRef.current = breakTimerPaused;
  }, [breakTimerPaused]);

  React.useEffect(() => {
    prayerTimerPausedRef.current = prayerTimerPaused;
  }, [prayerTimerPaused]);

  const syncPrayerBreakFromServer = React.useCallback(() => {
    if (prayerTimerPaused) return;
    void forceSyncPrayerBreakState(
      employeeId,
      setIsPrayerOn,
      setPrayerBreakTimer,
      setLoadingPrayerBreak,
      setPrayerBreakIntervalId,
      setPrayerStart
    );
  }, [employeeId, prayerTimerPaused]);

  const handleVerifyOpen = React.useCallback(
    (action: BiometricAction) => {
      if (action === "break_end") {
        if (!breakEndAtRef.current) breakEndAtRef.current = new Date();
        pauseBreakTimerForVerify();
        return;
      }
      if (action === "prayer_end") {
        if (!prayerEndAtRef.current) prayerEndAtRef.current = new Date();
        pausePrayerTimerForVerify();
      }
    },
    [pauseBreakTimerForVerify, pausePrayerTimerForVerify]
  );

  const handleVerifyClose = React.useCallback(
    (action: BiometricAction | null, reason: VerifyModalCloseReason) => {
      if (action === "break_end") {
        if (reason === "cancel") {
          breakEndAtRef.current = null;
          resumeBreakTimerAfterVerify();
          return;
        }
        // Face verified — stay paused until break end API succeeds or user cancels.
        return;
      }
      if (action === "prayer_end") {
        if (reason === "cancel") {
          prayerEndAtRef.current = null;
          resumePrayerTimerAfterVerify();
          return;
        }
        // Stay paused until prayer end API succeeds or user cancels.
        return;
      }
    },
    [resumeBreakTimerAfterVerify, resumePrayerTimerAfterVerify]
  );

  const biometricGateOptions = React.useMemo(
    () => ({
      onVerifyOpen: handleVerifyOpen,
      onVerifyClose: handleVerifyClose,
    }),
    [handleVerifyOpen, handleVerifyClose]
  );

  const { runWithVerify, gateModal, bioStatusLoading } = useBiometricGate(
    employeeId,
    employeeName,
    biometricGateOptions
  );

  // Buttons are only disabled during the quick bio-status fetch. We deliberately
  // do NOT block on full face-model load: on a remote server the weights take a
  // few seconds to download, and the verify modal already loads them in parallel
  // with the camera. Blocking here left buttons stuck on "Preparing…" for too
  // long.
  const verifyPreparing = bioStatusLoading;

  const isBiometricGateError = (error: unknown) =>
    String(error || "").toLowerCase().includes("face verification");

  // Fade-in on mount and force backend-only sync for clock state
  React.useEffect(() => {
    setFadeIn(true);
    if (!employeeId) {
      setLoadingAttendance(false);
      return;
    }
    
    // Clear old intervals before starting new syncs
    if (intervalId) clearInterval(intervalId);
    if (breakIntervalId) clearInterval(breakIntervalId);
    if (prayerBreakIntervalId) clearInterval(prayerBreakIntervalId);
    
    // Sync clock state from backend
    // Custom sync to always use server timezone for timer
    forceSyncClockState(
      employeeId,
      setIsClockedIn,
      (elapsedSecondsOrClockIn: number | string) => {
        // If value is a number, use as is (legacy)
        if (typeof elapsedSecondsOrClockIn === "number") {
          setTimer(elapsedSecondsOrClockIn);
        } else if (typeof elapsedSecondsOrClockIn === "string") {
          // Parse clock-in as server time zone
          const clockInParts = getParts(elapsedSecondsOrClockIn, "Asia/Karachi");
          if (clockInParts) {
            const clockInDate = new Date(Date.UTC(clockInParts.year, clockInParts.month - 1, clockInParts.day, clockInParts.hour, clockInParts.minute, clockInParts.second));
            const nowParts = getParts(new Date(), "Asia/Karachi");
            if (nowParts) {
              const nowDate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second));
              const elapsed = Math.floor((nowDate.getTime() - clockInDate.getTime()) / 1000);
              setTimer(elapsed);
            } else {
              setTimer(0);
            }
          } else {
            setTimer(0);
          }
        }
      },
      setLoadingAttendance,
      setIntervalId
    );
    
    // Sync break state from backend
    forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);

    // Sync prayer break state from backend
    forceSyncPrayerBreakState(
      employeeId,
      setIsPrayerOn,
      setPrayerBreakTimer,
      setLoadingPrayerBreak,
      setPrayerBreakIntervalId,
      setPrayerStart
    );
    
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        forceSyncClockState(employeeId, setIsClockedIn, setTimer, setLoadingAttendance, setIntervalId);
        if (!breakTimerPausedRef.current) {
          forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
        }
        if (!prayerTimerPausedRef.current) {
          forceSyncPrayerBreakState(
            employeeId,
            setIsPrayerOn,
            setPrayerBreakTimer,
            setLoadingPrayerBreak,
            setPrayerBreakIntervalId,
            setPrayerStart
          );
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearClockSyncInterval(employeeId);
      if (breakIntervalId) clearInterval(breakIntervalId);
      if (prayerBreakIntervalId) clearInterval(prayerBreakIntervalId);
      clearBreakSyncInterval(employeeId);
      clearPrayerBreakSyncInterval(employeeId);
      if (breakPauseTickRef.current) clearInterval(breakPauseTickRef.current);
      if (prayerPauseTickRef.current) clearInterval(prayerPauseTickRef.current);
    };
  }, [employeeId]);

  const handleClockIn = async (biometricToken: string | null = null) => {
    const id = String(employeeId || "").trim();
    if (!id || clockActionPending) {
      toastInfo(
        id
          ? "Please wait, clock action is in progress."
          : "Employee ID not loaded. Please refresh the page or log in again.",
        "Please wait"
      );
      return;
    }
    const name =
      employeeName?.trim() ||
      (typeof window !== "undefined" ? localStorage.getItem("employeeName") : null)?.trim() ||
      "Employee";
    const now = new Date();
    try {
      setClockActionPending(true);
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: id,
          employee_name: name,
          date: getDateStringInTimeZone(now),
          clock_in: now.toISOString(),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(`auto_presence_prompt_${id}`);
        }
        clearClockSyncInterval(id);
        setIsClockedIn(true);
        setTimer(0);
        forceSyncClockState(id, setIsClockedIn, setTimer, setLoadingAttendance, setIntervalId);
        forceSyncBreakState(id, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
        forceSyncPrayerBreakState(
          id,
          setIsPrayerOn,
          setPrayerBreakTimer,
          setLoadingPrayerBreak,
          setPrayerBreakIntervalId,
          setPrayerStart
        );
        notifyAttendanceDataChanged();
        toastSuccess("You are now clocked in.", "Clock in successful");
      } else if (res.status === 403 && isBiometricGateError(data.error)) {
        runWithVerify("clock_in", (token) => handleClockIn(token));
      } else {
        toastError(data.error || "Failed to clock in. Please try again.");
      }
    } catch (error) {
      toastError("Error while clocking in. Please try again.");
    } finally {
      setClockActionPending(false);
    }
  };

  const handleClockOut = async () => {
    if (!employeeId) return;
    
    // Check for active breaks BEFORE showing confirmation
    try {
      const res = await fetch(`/api/attendance?employeeId=${employeeId}&activeBreakCheck=1`);
      const data = await res.json();

      if (data?.hasActiveBreak) {
        const activeBreakType = data.breakType === 'prayer_break' ? 'Prayer Break' : 'Break';
        setActiveBreakTitle(`Active ${activeBreakType}`);
        setActiveBreakErrorMsg(`There Is An Active ${activeBreakType}. Please End Your ${activeBreakType} First.`);
        setShowActiveBreakModal(true);
        return;
      }
    } catch (error) {
      console.error('Error checking breaks:', error);
      // Continue with clock out even if break check fails
    }
    
    // If no active break, show confirmation
    setShowClockOutConfirm(true);
  };

  const performClockOut = async (
    biometricToken: string | null = null,
    options?: { autoClockOut?: boolean }
  ) => {
    if (clockActionPending) return;
    const now = new Date();
    const useAutoClockOut = Boolean(options?.autoClockOut || graceExpiredForClockOutRef.current);
    try {
      setClockActionPending(true);
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date: getDateStringInTimeZone(now),
          clock_out: now.toISOString(),
          ...(useAutoClockOut ? { auto_clock_out: true } : {}),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        clearClockSyncInterval(employeeId);
        setIsClockedIn(false);
        setTimer(0);
        clearBreakSyncInterval(employeeId);
        setIsOnBreak(false);
        setBreakTimer(0);
        clearPrayerBreakSyncInterval(employeeId);
        setIsPrayerOn(false);
        setPrayerBreakTimer(0);
        setPrayerStart(null);
        forceSyncClockState(employeeId, setIsClockedIn, setTimer, setLoadingAttendance, setIntervalId);
        forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
        forceSyncPrayerBreakState(
          employeeId,
          setIsPrayerOn,
          setPrayerBreakTimer,
          setLoadingPrayerBreak,
          setPrayerBreakIntervalId,
          setPrayerStart
        );
        notifyAttendanceDataChanged();
        toastSuccess("You have been clocked out.", "Clock out successful");
      } else if (res.status === 403 && isBiometricGateError(data.error)) {
        runWithVerify("clock_out", (token) => performClockOut(token));
      } else {
        const errorMsg = data.error || "Failed to clock out. Please try again.";
        setActiveBreakTitle("Clock Out Error");
        setActiveBreakErrorMsg(errorMsg);
        setShowActiveBreakModal(true);
      }
    } catch (error) {
      const errorMsg = "Error while clocking out. Please try again.";
      setActiveBreakTitle("Clock Out Error");
      setActiveBreakErrorMsg(errorMsg);
      setShowActiveBreakModal(true);
    } finally {
      setClockActionPending(false);
    }
  };

  const confirmClockOut = (confirmed: boolean) => {
    setShowClockOutConfirm(false);
    if (!confirmed) return;
    if (graceExpiredForClockOutRef.current) {
      void performClockOut(null, { autoClockOut: true });
      return;
    }
    runWithVerify("clock_out", (token) => performClockOut(token));
  };

  const handleBreakStart = async (biometricToken: string | null = null) => {
    if (!employeeId || !isClockedIn || breakActionPending) {
      toastInfo("Please clock in first.", "Clock in required");
      return;
    }
    const startTime = new Date();
    try {
      setBreakActionPending(true);
      const res = await fetch("/api/breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          date: startTime.toISOString(),
          break_start: startTime.toISOString(),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        resetBreakPauseState();
        clearBreakSyncInterval(employeeId);
        setIsOnBreak(true);
        setBreakTimer(0);
        breakStartMsRef.current = startTime.getTime();
        setLoadingBreak(false);
        forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
        notifyBreakDataChanged();
        toastSuccess("Your break has started.", "Break started");
      } else if (res.status === 403 && isBiometricGateError(data.error)) {
        runWithVerify("break_start", (token) => handleBreakStart(token));
      } else {
        toastError(data.error || "Failed to start break.");
      }
    } catch (error) {
      toastError("Error starting break.");
    } finally {
      setBreakActionPending(false);
    }
  };

  const handleBreakEnd = async (biometricToken: string | null = null) => {
    if (!employeeId || !isOnBreak || breakActionPending) {
      toastInfo("No ongoing break found.", "Break");
      return;
    }
    const endTime = breakEndAtRef.current ?? new Date();
    try {
      setBreakActionPending(true);
      const res = await fetch("/api/breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date: endTime.toISOString(),
          break_end: endTime.toISOString(),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        resetBreakPauseState();
        clearBreakSyncInterval(employeeId);
        setIsOnBreak(false);
        setBreakTimer(0);
        setLoadingBreak(false);
        forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
        notifyBreakDataChanged();
        toastSuccess("Your break has ended.", "Break ended");
      } else if (res.status === 403 && isBiometricGateError(data.error)) {
        if (!breakEndAtRef.current) breakEndAtRef.current = new Date();
        pauseBreakTimerForVerify();
        runWithVerify("break_end", (token) => handleBreakEnd(token));
      } else {
        breakEndAtRef.current = null;
        resumeBreakTimerAfterVerify();
        toastError(data.error || "Failed to end break.");
      }
    } catch (error) {
      breakEndAtRef.current = null;
      resumeBreakTimerAfterVerify();
      toastError("Error ending break.");
    } finally {
      setBreakActionPending(false);
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <>
    {gateModal}
    <AutoPresencePrompt
      employeeId={employeeId}
      employeeName={employeeName}
      isClockedIn={isClockedIn}
      onGraceExpiredChange={(graceExpired) => {
        graceExpiredForClockOutRef.current = graceExpired;
      }}
      onClockedOut={() => {
        graceExpiredForClockOutRef.current = false;
        clearClockSyncInterval(employeeId);
        setIsClockedIn(false);
        setTimer(0);
        clearBreakSyncInterval(employeeId);
        setIsOnBreak(false);
        setBreakTimer(0);
        resetBreakPauseState();
        clearPrayerBreakSyncInterval(employeeId);
        setIsPrayerOn(false);
        setPrayerBreakTimer(0);
        setPrayerStart(null);
        resetPrayerPauseState();
        forceSyncClockState(employeeId, setIsClockedIn, setTimer, setLoadingAttendance, setIntervalId);
        forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
        forceSyncPrayerBreakState(
          employeeId,
          setIsPrayerOn,
          setPrayerBreakTimer,
          setLoadingPrayerBreak,
          setPrayerBreakIntervalId,
          setPrayerStart
        );
        notifyAttendanceDataChanged();
        notifyBreakDataChanged();
        notifyPrayerDataChanged();
      }}
    />
    <div className={`cbp-fade-in ${isSlack ? slackStyles.row : "cbp-widget-row"}${fadeIn ? " cbp-fade-in-active" : ""}`}>
      {/* Clock In Widget */}
      <div
        className={isSlack ? `${slackStyles.card} ${slackStyles.cardClock}` : undefined}
        style={isSlack ? undefined : { background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, minWidth: 180, display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        {isSlack ? (
          <div className={slackStyles.cardHeader}>
            <span className={`${slackStyles.cardTitle} ${slackStyles.titleClock}`}>
              <span className={slackStyles.titleIcon} aria-hidden>
                <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5.2l3.2 1.8" />
                </svg>
              </span>
              Clock in
            </span>
            {isClockedIn && <span className={`${slackStyles.cardBadge} ${slackStyles.badgeLive}`}>Active</span>}
          </div>
        ) : (
          <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "#27ae60", marginBottom: 10 }}>Clock In</div>
        )}
        {isSlack && isClockedIn && <span className={slackStyles.clockRing} aria-hidden />}
        {!loadingAttendance && (
          <>
            <button
              onClick={
                isClockedIn
                  ? handleClockOut
                  : () => runWithVerify("clock_in", (token) => handleClockIn(token))
              }
              disabled={clockActionPending || verifyPreparing}
              className={isSlack ? `${slackStyles.btn} ${isClockedIn ? slackStyles.btnClockOut : slackStyles.btnClockIn}` : undefined}
              style={isSlack ? undefined : {
                background: isClockedIn ? "#e74c3c" : "#27ae60",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 18px",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: clockActionPending || verifyPreparing ? "not-allowed" : "pointer",
                opacity: clockActionPending || verifyPreparing ? 0.6 : 1,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                transition: "background 0.2s"
              }}
            >
              {verifyPreparing ? "Preparing…" : isClockedIn ? "Clock Out" : "Clock In"}
            </button>
            {isClockedIn && (
              isSlack ? (
                <div className={slackStyles.statusBox}>
                  <div className={slackStyles.statusBoxInner}>
                    <div className={slackStyles.statusLabel}>Working</div>
                    <div className={slackStyles.statusTimer}>{formatTime(timer)}</div>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(52,120,246,0.10)", padding: "8px 12px", minWidth: 120 }}>
                  <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#3478f6", marginBottom: 6 }}>Working</div>
                  <div style={{ fontSize: "1rem", fontWeight: 500, color: "#2d3436" }}>{formatTime(timer)}</div>
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Break Widget */}
      {isClockedIn && (
        <div
          className={isSlack ? `${slackStyles.card} ${slackStyles.cardBreak}` : undefined}
          style={isSlack ? undefined : { background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, minWidth: 180, display: "flex", flexDirection: "column", alignItems: "center" }}
        >
          {isSlack ? (
            <div className={slackStyles.cardHeader}>
              <span className={`${slackStyles.cardTitle} ${slackStyles.titleBreak}`}>
                <span className={slackStyles.titleIcon} aria-hidden>
                  <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5.2l3.2 1.8" />
                  </svg>
                </span>
                Break
              </span>
              {isOnBreak && <span className={`${slackStyles.cardBadge} ${slackStyles.badgeLive}`}>On break</span>}
            </div>
          ) : (
            <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "#e67e22", marginBottom: 10 }}>Break</div>
          )}
          <button
            onClick={
              isOnBreak
                ? () => runWithVerify("break_end", (token) => handleBreakEnd(token))
                : () => runWithVerify("break_start", (token) => handleBreakStart(token))
            }
            disabled={isPrayerOn || breakActionPending || verifyPreparing}
            className={isSlack ? `${slackStyles.btn} ${isOnBreak ? slackStyles.btnBreakEnd : slackStyles.btnBreak}` : undefined}
            style={isSlack ? undefined : {
              background: isOnBreak ? "#e74c3c" : "#e67e22",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 18px",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: isPrayerOn || breakActionPending || verifyPreparing ? "not-allowed" : "pointer",
              opacity: isPrayerOn || breakActionPending || verifyPreparing ? 0.6 : 1,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              transition: "background 0.2s"
            }}
          >
            {verifyPreparing ? "Preparing…" : isOnBreak ? "End Break" : "Start Break"}
          </button>
          {isOnBreak && !isSlack ? (
            <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(230,126,34,0.10)", padding: "8px 12px", minWidth: 120 }}>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e67e22", marginBottom: 6 }}>
                {breakTimerPaused ? "⏸ Verifying…" : "🔴 Break Running"}
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 500, color: "#2d3436" }}>{formatTime(breakTimer)}</div>
            </div>
          ) : null}
          <BreakSummary
            employeeId={employeeId}
            isOnBreak={isOnBreak}
            liveBreakSeconds={breakTimer}
            variant={variant}
          />
        </div>
      )}

      {/* Prayer Break Widget */}
      {isClockedIn && (
        <PrayerButton
          employeeId={employeeId}
          employeeName={employeeName}
          isPrayerOn={isPrayerOn}
          setIsPrayerOn={setIsPrayerOn}
          setPrayerStart={setPrayerStart}
          prayerTimer={prayerBreakTimer}
          prayerTimerPaused={prayerTimerPaused}
          prayerEndAtRef={prayerEndAtRef}
          pausePrayerTimerForVerify={pausePrayerTimerForVerify}
          resumePrayerTimerAfterVerify={resumePrayerTimerAfterVerify}
          resetPrayerPauseState={resetPrayerPauseState}
          onPrayerStateChanged={syncPrayerBreakFromServer}
          disabled={isOnBreak}
          runWithVerify={runWithVerify}
          bioStatusLoading={verifyPreparing}
          onClearServerPrayerInterval={() => clearPrayerBreakSyncInterval(employeeId)}
          variant={variant}
        />
      )}
    </div>
    {typeof document !== "undefined" && showClockOutConfirm
      ? createPortal(
          <div className={modalStyles.overlay} data-hrm-modal-overlay role="presentation">
            <div
              className={modalStyles.box}
              role="dialog"
              aria-modal="true"
              aria-label="Confirm clock out"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={modalStyles.title}>Are you sure you want to clock out?</div>
              <div className={modalStyles.actions}>
                <button type="button" className={modalStyles.btnYes} onClick={() => confirmClockOut(true)}>
                  Yes
                </button>
                <button type="button" className={modalStyles.btnNo} onClick={() => confirmClockOut(false)}>
                  No
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null}
    {typeof document !== "undefined" && showActiveBreakModal
      ? createPortal(
          <div className={modalStyles.overlay} data-hrm-modal-overlay role="presentation">
            <div
              className={modalStyles.box}
              role="dialog"
              aria-modal="true"
              aria-label={activeBreakTitle}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={modalStyles.warnIcon} aria-hidden>⚠️</div>
              <div className={modalStyles.titleDanger}>{activeBreakTitle}</div>
              <div className={modalStyles.message}>{activeBreakErrorMsg}</div>
              <button
                type="button"
                className={modalStyles.btnOk}
                onClick={() => setShowActiveBreakModal(false)}
              >
                OK
              </button>
            </div>
          </div>,
          document.body
        )
      : null}
    </>
  );
});

// Today's break totals for quick glance
function BreakSummary({
  employeeId,
  isOnBreak = false,
  liveBreakSeconds = 0,
  variant = "default",
}: {
  employeeId: string;
  isOnBreak?: boolean;
  liveBreakSeconds?: number;
  variant?: "default" | "slack";
}) {
  const isSlack = variant === "slack";
  const [completedBreakSeconds, setCompletedBreakSeconds] = React.useState(0);
  // Removed prayer totals from BreakSummary; shown in Prayer widget instead

  const displayTotalSeconds =
    completedBreakSeconds + (isOnBreak ? Math.max(0, liveBreakSeconds) : 0);
  const displayExceedSeconds =
    displayTotalSeconds > 3600 ? displayTotalSeconds - 3600 : 0;

  const refreshTotals = React.useCallback(async () => {
    try {
      if (!employeeId) return;
      const today = getDateStringInTimeZone(new Date());
      const [y, m, d] = today.split("-").map(Number);
      const yest = new Date(Date.UTC(y, m - 1, d - 1));
      const fromDate = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, "0")}-${String(yest.getUTCDate()).padStart(2, "0")}`;
      const range = `fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(today)}`;

      const [attendanceRes, breakRes] = await Promise.all([
        fetch(`/api/attendance?employeeId=${encodeURIComponent(employeeId)}&${range}&summary=1`, {
          cache: "no-store",
        }),
        fetch(`/api/breaks?employeeId=${encodeURIComponent(employeeId)}&${range}`, {
          cache: "no-store",
        }),
      ]);
      const attendanceData = await attendanceRes.json();
      const breakData = await breakRes.json();
      const attendanceRowsPre = Array.isArray(attendanceData?.attendance)
        ? attendanceData.attendance
        : [];

      const breakRows =
        breakData.success && Array.isArray(breakData.breaks)
          ? breakData.breaks
          : [];
      const attendanceRows = attendanceRowsPre;

      const sortedAttendance = attendanceRows
        .filter((a: any) => a.clock_in)
        .sort(
          (a: any, b: any) =>
            (toKarachiEpochMs(b.clock_in) || 0) - (toKarachiEpochMs(a.clock_in) || 0)
        );

      const activeOrLatestAttendance =
        sortedAttendance.find((a: any) => a.clock_in && !a.clock_out) ||
        sortedAttendance[0] ||
        null;

      const activeAttendanceId =
        activeOrLatestAttendance?.id !== undefined &&
        activeOrLatestAttendance?.id !== null
          ? Number(activeOrLatestAttendance.id)
          : null;

      const sessionStartMs = activeOrLatestAttendance?.clock_in
        ? toKarachiEpochMs(activeOrLatestAttendance.clock_in)
        : null;
      const sessionEndMs = activeOrLatestAttendance?.clock_out
        ? toKarachiEpochMs(activeOrLatestAttendance.clock_out)
        : null;

      const belongsToCurrentSession = (row: any) => {
        if (!activeOrLatestAttendance) return true;

        const rowSessionId = row.attendance_session_id;
        if (
          activeAttendanceId !== null &&
          rowSessionId !== undefined &&
          rowSessionId !== null &&
          rowSessionId !== ""
        ) {
          return Number(rowSessionId) === activeAttendanceId;
        }

        if (!row.break_start || sessionStartMs === null) return false;
        const breakStartMs = toKarachiEpochMs(row.break_start);
        if (breakStartMs === null) {
          return false;
        }

        if (breakStartMs < sessionStartMs) return false;
        if (
          sessionEndMs !== null &&
          !Number.isNaN(sessionEndMs) &&
          breakStartMs > sessionEndMs
        ) {
          return false;
        }

        return true;
      };

      if (breakRows.length > 0) {
        let total = 0;
        breakRows.forEach((b: any) => {
          if (b.break_start && b.break_end && belongsToCurrentSession(b)) {
            const start = toKarachiEpochMs(b.break_start);
            const end = toKarachiEpochMs(b.break_end);
            if (start !== null && end !== null) {
              total += Math.floor((end - start) / 1000);
            }
          }
        });
        setCompletedBreakSeconds(total);
      } else {
        setCompletedBreakSeconds(0);
      }
    } catch (error) {
      setCompletedBreakSeconds(0);
    }
  }, [employeeId]);

  React.useEffect(() => {
    refreshTotals();
  }, [refreshTotals]);

  React.useEffect(() => {
    const onRefresh = () => {
      refreshTotals();
    };
    window.addEventListener(BREAK_DATA_CHANGED, onRefresh);
    window.addEventListener(ATTENDANCE_DATA_CHANGED, onRefresh);
    return () => {
      window.removeEventListener(BREAK_DATA_CHANGED, onRefresh);
      window.removeEventListener(ATTENDANCE_DATA_CHANGED, onRefresh);
    };
  }, [refreshTotals]);

  if (isSlack) {
    return (
      <div className={slackStyles.summaryBox}>
        <div className={slackStyles.summaryBoxInner}>
          <div className={slackStyles.summaryLabel}>Total Break</div>
          <div
            className={slackStyles.summaryValue}
            style={displayTotalSeconds > 3600 ? { color: "#dc2626", borderColor: "rgba(220,38,38,0.35)" } : undefined}
          >
            {formatDuration(displayTotalSeconds)}
          </div>
        </div>
        {displayExceedSeconds > 0 && (
          <div className={slackStyles.summaryExceed}>Exceed: {formatDuration(displayExceedSeconds)}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(230,126,34,0.10)", padding: "8px 12px", minWidth: 120 }}>
      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e67e22", marginBottom: 6 }}>Today's Total Break</div>
      <div style={{ fontSize: "1rem", fontWeight: 500, color: displayTotalSeconds > 3600 ? "#e74c3c" : "#2d3436" }}>{formatDuration(displayTotalSeconds)}</div>
      {displayExceedSeconds > 0 && (
        <div style={{ fontSize: "0.9rem", color: "#e74c3c", marginTop: 4 }}>Exceed: {formatDuration(displayExceedSeconds)}</div>
      )}
    </div>
  );
}
