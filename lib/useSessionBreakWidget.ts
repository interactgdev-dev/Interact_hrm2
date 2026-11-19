"use client";

import React from "react";
import type { BiometricAction } from "@/lib/face-types";
import type { SessionBreakConfig } from "@/lib/session-break-config";
import {
  clearSessionBreakSyncInterval,
  forceSyncSessionBreakState,
} from "./ui-sync/forceSyncSessionBreakState";

export function useSessionBreakWidget(employeeId: string, config: SessionBreakConfig) {
  const [isOn, setIsOn] = React.useState(false);
  const [breakStart, setBreakStart] = React.useState<Date | null>(null);
  const [breakIntervalId, setBreakIntervalId] = React.useState<NodeJS.Timeout | null>(null);
  const [breakTimer, setBreakTimer] = React.useState(0);
  const [loadingBreak, setLoadingBreak] = React.useState(true);
  const [breakTimerPaused, setBreakTimerPaused] = React.useState(false);
  const breakTimerPausedRef = React.useRef(false);
  const breakEndAtRef = React.useRef<Date | null>(null);
  const breakStartMsRef = React.useRef<number | null>(null);
  const breakPausedMsRef = React.useRef(0);
  const breakPauseStartedAtRef = React.useRef<number | null>(null);
  const breakPauseTickRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearBreakPauseTick = React.useCallback(() => {
    if (breakPauseTickRef.current) {
      clearInterval(breakPauseTickRef.current);
      breakPauseTickRef.current = null;
    }
  }, []);

  const syncBreakStartAnchor = React.useCallback(
    (elapsedSeconds: number) => {
      if (!isOn) {
        breakStartMsRef.current = null;
        return;
      }
      if (breakStartMsRef.current === null && elapsedSeconds >= 0) {
        breakStartMsRef.current = Date.now() - elapsedSeconds * 1000;
      }
    },
    [isOn]
  );

  const pauseBreakTimerForVerify = React.useCallback(() => {
    syncBreakStartAnchor(breakTimer);
    clearSessionBreakSyncInterval(employeeId, config);
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
  }, [syncBreakStartAnchor, breakTimer, employeeId, config, breakIntervalId, clearBreakPauseTick]);

  const resumeBreakTimerAfterVerify = React.useCallback(() => {
    if (breakPauseStartedAtRef.current) {
      breakPausedMsRef.current += Date.now() - breakPauseStartedAtRef.current;
      breakPauseStartedAtRef.current = null;
    }
    breakTimerPausedRef.current = false;
    setBreakTimerPaused(false);
    clearBreakPauseTick();
    clearSessionBreakSyncInterval(employeeId, config);

    breakPauseTickRef.current = setInterval(() => {
      if (!breakStartMsRef.current) return;
      const elapsed = Math.floor(
        (Date.now() - breakStartMsRef.current - breakPausedMsRef.current) / 1000
      );
      setBreakTimer(Math.max(0, elapsed));
    }, 1000);
  }, [clearBreakPauseTick, employeeId, config]);

  const resetBreakPauseState = React.useCallback(() => {
    breakEndAtRef.current = null;
    breakStartMsRef.current = null;
    breakPausedMsRef.current = 0;
    breakPauseStartedAtRef.current = null;
    breakTimerPausedRef.current = false;
    setBreakTimerPaused(false);
    clearBreakPauseTick();
  }, [clearBreakPauseTick]);

  React.useEffect(() => {
    breakTimerPausedRef.current = breakTimerPaused;
  }, [breakTimerPaused]);

  const syncFromServer = React.useCallback(() => {
    if (breakTimerPaused) return;
    void forceSyncSessionBreakState(
      employeeId,
      config,
      setIsOn,
      setBreakTimer,
      setLoadingBreak,
      setBreakIntervalId,
      setBreakStart
    );
  }, [employeeId, config, breakTimerPaused]);

  const handleVerifyOpen = React.useCallback(
    (action: BiometricAction) => {
      if (action === config.endAction) {
        if (!breakEndAtRef.current) breakEndAtRef.current = new Date();
        pauseBreakTimerForVerify();
      }
    },
    [config.endAction, pauseBreakTimerForVerify]
  );

  const handleVerifyClose = React.useCallback(
    (action: BiometricAction | null, reason: "cancel" | "success") => {
      if (action === config.endAction) {
        if (reason === "cancel") {
          breakEndAtRef.current = null;
          resumeBreakTimerAfterVerify();
        }
      }
    },
    [config.endAction, resumeBreakTimerAfterVerify]
  );

  return {
    isOn,
    setIsOn,
    breakStart,
    setBreakStart,
    breakTimer,
    loadingBreak,
    breakTimerPaused,
    breakEndAtRef,
    pauseBreakTimerForVerify,
    resumeBreakTimerAfterVerify,
    resetBreakPauseState,
    syncFromServer,
    handleVerifyOpen,
    handleVerifyClose,
    clearServerInterval: () => clearSessionBreakSyncInterval(employeeId, config),
    forceSync: () =>
      forceSyncSessionBreakState(
        employeeId,
        config,
        setIsOn,
        setBreakTimer,
        setLoadingBreak,
        setBreakIntervalId,
        setBreakStart
      ),
  };
}
