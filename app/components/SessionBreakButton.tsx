"use client";

import React from "react";
import type { BiometricAction } from "@/lib/face-types";
import type { SessionBreakConfig } from "@/lib/session-break-config";
import { getDateStringInTimeZone } from "../../lib/timezone";
import slackStylesDefault from "./clock-widgets-slack.module.css";
import todayStyles from "./clock-widgets-today.module.css";
import { ATTENDANCE_DATA_CHANGED } from "../../lib/ui-sync/breakPrayerDataRefresh";
import { toastError, toastSuccess } from "@/lib/app-toast";

interface SessionBreakButtonProps {
  config: SessionBreakConfig;
  employeeId: string;
  employeeName: string;
  isOn: boolean;
  setIsOn: React.Dispatch<React.SetStateAction<boolean>>;
  setBreakStart: React.Dispatch<React.SetStateAction<Date | null>>;
  breakTimer: number;
  breakTimerPaused: boolean;
  breakEndAtRef: React.MutableRefObject<Date | null>;
  pauseBreakTimerForVerify: () => void;
  resumeBreakTimerAfterVerify: () => void;
  resetBreakPauseState: () => void;
  onBreakStateChanged: () => void;
  notifyDataChanged: () => void;
  disabled?: boolean;
  runWithVerify?: (
    action: BiometricAction,
    callback: (biometricToken: string | null) => void | Promise<void>
  ) => void;
  bioStatusLoading?: boolean;
  onClearServerBreakInterval?: () => void;
  variant?: "default" | "slack" | "todayStatus";
}

export function SessionBreakButton({
  config,
  employeeId,
  employeeName,
  isOn,
  setIsOn,
  setBreakStart,
  breakTimer,
  breakTimerPaused,
  breakEndAtRef,
  pauseBreakTimerForVerify,
  resumeBreakTimerAfterVerify,
  resetBreakPauseState,
  onBreakStateChanged,
  notifyDataChanged,
  disabled = false,
  runWithVerify,
  bioStatusLoading = false,
  onClearServerBreakInterval,
  variant = "default",
}: SessionBreakButtonProps) {
  const isSlack = variant === "slack" || variant === "todayStatus";
  const slackStyles = variant === "todayStatus" ? todayStyles : slackStylesDefault;
  const [actionPending, setActionPending] = React.useState(false);
  const startField = config.startField;
  const endField = config.endField;

  const handleStart = async (biometricToken: string | null = null) => {
    if (!employeeId || actionPending) return;
    const startTime = new Date();
    try {
      setActionPending(true);
      const res = await fetch(config.apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          date: startTime.toISOString(),
          [startField]: startTime.toISOString(),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsOn(true);
        setBreakStart(startTime);
        notifyDataChanged();
        onBreakStateChanged();
        toastSuccess(`${config.label} started.`, config.label);
      } else if (
        res.status === 403 &&
        String(data.error || "").toLowerCase().includes("face verification") &&
        runWithVerify
      ) {
        runWithVerify(config.startAction, (token) => handleStart(token));
      } else {
        toastError(data.error || `Failed to start ${config.shortLabel.toLowerCase()}`);
      }
    } catch (err) {
      console.error(err);
      toastError(`Error starting ${config.shortLabel.toLowerCase()}`);
    } finally {
      setActionPending(false);
    }
  };

  const handleEnd = async (biometricToken: string | null = null) => {
    if (!employeeId || actionPending) return;
    const endTime = breakEndAtRef.current ?? new Date();
    try {
      setActionPending(true);
      const res = await fetch(config.apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date: endTime.toISOString(),
          [endField]: endTime.toISOString(),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        resetBreakPauseState();
        setIsOn(false);
        setBreakStart(null);
        onClearServerBreakInterval?.();
        notifyDataChanged();
        onBreakStateChanged();
        toastSuccess(`${config.label} ended.`, config.label);
      } else if (
        res.status === 403 &&
        String(data.error || "").toLowerCase().includes("face verification") &&
        runWithVerify
      ) {
        if (!breakEndAtRef.current) breakEndAtRef.current = new Date();
        pauseBreakTimerForVerify();
        runWithVerify(config.endAction, (token) => handleEnd(token));
      } else {
        breakEndAtRef.current = null;
        resumeBreakTimerAfterVerify();
        toastError(data.error || `Failed to end ${config.shortLabel.toLowerCase()}`);
      }
    } catch (err) {
      console.error(err);
      breakEndAtRef.current = null;
      resumeBreakTimerAfterVerify();
      toastError(`Error ending ${config.shortLabel.toLowerCase()}`);
    } finally {
      setActionPending(false);
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}h ${m}m ${s}s`;
  };

  const cardClass = isSlack ? `${slackStyles.card} ${(slackStyles as Record<string, string>)[config.cardClass]}` : undefined;
  const titleClass = `${slackStyles.cardTitle} ${(slackStyles as Record<string, string>)[config.titleClass]}`;
  const btnClass = isSlack
    ? `${slackStyles.btn} ${isOn ? (slackStyles as Record<string, string>)[config.btnEndClass] : (slackStyles as Record<string, string>)[config.btnClass]}`
    : undefined;

  return (
    <div
      className={cardClass}
      style={
        isSlack
          ? undefined
          : {
              background: "#f7fafc",
              borderRadius: 16,
              boxShadow: "0 2px 8px #e2e8f0",
              padding: 24,
              minWidth: 180,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }
      }
    >
      {isSlack ? (
        <div className={slackStyles.cardHeader}>
          <span className={titleClass}>
            <span
              className={`${slackStyles.titleIcon} ${(slackStyles as Record<string, string>)[config.titleClass]}`}
              aria-hidden
            >
              {config.kind === "refreshment" ? (
                <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v4" />
                  <path d="M16 2v4" />
                  <path d="M6 8h12" />
                  <path d="M7 8v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              )}
            </span>
            {config.label}
          </span>
          {isOn && <span className={`${slackStyles.cardBadge} ${slackStyles.badgeLive}`}>Active</span>}
        </div>
      ) : (
        <div style={{ fontWeight: 600, fontSize: "1.1rem", color: config.accentColor, marginBottom: 10 }}>
          {config.label}
        </div>
      )}
      <button
        onClick={
          isOn
            ? () =>
                runWithVerify
                  ? runWithVerify(config.endAction, (token) => handleEnd(token))
                  : handleEnd()
            : () =>
                runWithVerify
                  ? runWithVerify(config.startAction, (token) => handleStart(token))
                  : handleStart()
        }
        disabled={disabled || actionPending || bioStatusLoading}
        className={btnClass}
        style={
          isSlack
            ? undefined
            : {
                background: isOn ? "#e74c3c" : config.accentColor,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 18px",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: disabled || actionPending || bioStatusLoading ? "not-allowed" : "pointer",
                opacity: disabled || actionPending || bioStatusLoading ? 0.6 : 1,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                transition: "background 0.2s",
              }
        }
      >
        {bioStatusLoading ? "Preparing…" : isOn ? `End ${config.shortLabel}` : `Start ${config.shortLabel}`}
      </button>
      {isOn && !isSlack ? (
        <div
          style={{
            marginTop: 12,
            background: "#fff",
            borderRadius: 12,
            boxShadow: `0 2px 8px ${config.accentColor}1a`,
            padding: "8px 12px",
            minWidth: 120,
          }}
        >
          <div style={{ fontSize: "0.95rem", fontWeight: 600, color: config.accentColor, marginBottom: 6 }}>
            {breakTimerPaused ? "⏸ Verifying…" : `🔴 ${config.label} Running`}
          </div>
          <div style={{ fontSize: "1rem", fontWeight: 500, color: "#2d3436" }}>{formatTime(breakTimer)}</div>
        </div>
      ) : null}
      <SessionBreakTotals
        config={config}
        employeeId={employeeId}
        isOn={isOn}
        liveSeconds={breakTimer}
        variant={variant}
      />
    </div>
  );
}

function SessionBreakTotals({
  config,
  employeeId,
  isOn = false,
  liveSeconds = 0,
  variant = "default",
}: {
  config: SessionBreakConfig;
  employeeId: string;
  isOn?: boolean;
  liveSeconds?: number;
  variant?: "default" | "slack" | "todayStatus";
}) {
  const isSlack = variant === "slack" || variant === "todayStatus";
  const slackStyles = variant === "todayStatus" ? todayStyles : slackStylesDefault;
  const [completedSeconds, setCompletedSeconds] = React.useState(0);
  const startField = config.startField;
  const endField = config.endField;

  const displayTotalSeconds = completedSeconds + (isOn ? Math.max(0, liveSeconds) : 0);
  const displayExceedSeconds =
    displayTotalSeconds > config.exceedSeconds ? displayTotalSeconds - config.exceedSeconds : 0;

  const refreshTotals = React.useCallback(async () => {
    try {
      if (!employeeId) return;
      const attendanceRes = await fetch(`/api/attendance?employeeId=${employeeId}`);
      const attendanceData = await attendanceRes.json();
      const attendanceRowsPre = Array.isArray(attendanceData?.attendance) ? attendanceData.attendance : [];
      const breakRes = await fetch(`${config.apiPath}?employeeId=${employeeId}`);
      const breakData = await breakRes.json();
      const breakRows =
        breakData.success && Array.isArray(breakData[config.responseKey]) ? breakData[config.responseKey] : [];
      const attendanceRows = attendanceRowsPre;

      const sortedAttendance = attendanceRows
        .filter((a: any) => a.clock_in)
        .sort(
          (a: any, b: any) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime()
        );

      const activeOrLatestAttendance =
        sortedAttendance.find((a: any) => a.clock_in && !a.clock_out) || sortedAttendance[0] || null;

      const activeAttendanceId =
        activeOrLatestAttendance?.id !== undefined && activeOrLatestAttendance?.id !== null
          ? Number(activeOrLatestAttendance.id)
          : null;

      const sessionStartMs = activeOrLatestAttendance?.clock_in
        ? new Date(activeOrLatestAttendance.clock_in).getTime()
        : null;
      const sessionEndMs = activeOrLatestAttendance?.clock_out
        ? new Date(activeOrLatestAttendance.clock_out).getTime()
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
        if (!row[startField] || sessionStartMs === null) return false;
        const startMs = new Date(row[startField]).getTime();
        if (Number.isNaN(startMs) || Number.isNaN(sessionStartMs)) return false;
        if (startMs < sessionStartMs) return false;
        if (sessionEndMs !== null && !Number.isNaN(sessionEndMs) && startMs > sessionEndMs) return false;
        return true;
      };

      let total = 0;
      breakRows.forEach((row: any) => {
        if (row[startField] && row[endField] && belongsToCurrentSession(row)) {
          const s = new Date(row[startField]).getTime();
          const e = new Date(row[endField]).getTime();
          total += Math.floor((e - s) / 1000);
        }
      });
      setCompletedSeconds(total);
    } catch {
      setCompletedSeconds(0);
    }
  }, [employeeId, config]);

  React.useEffect(() => {
    refreshTotals();
  }, [refreshTotals]);

  React.useEffect(() => {
    const onRefresh = () => refreshTotals();
    window.addEventListener(config.dataChangedEvent, onRefresh);
    window.addEventListener(ATTENDANCE_DATA_CHANGED, onRefresh);
    return () => {
      window.removeEventListener(config.dataChangedEvent, onRefresh);
      window.removeEventListener(ATTENDANCE_DATA_CHANGED, onRefresh);
    };
  }, [refreshTotals, config.dataChangedEvent]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}h ${m}m ${s}s`;
  };

  if (isSlack) {
    return (
      <div className={slackStyles.summaryBox}>
        <div className={slackStyles.summaryBoxInner}>
          <div className={slackStyles.summaryLabel}>Total {config.shortLabel}</div>
          <div
            className={slackStyles.summaryValue}
            style={
              displayTotalSeconds > config.exceedSeconds
                ? { color: "#dc2626", borderColor: "rgba(220,38,38,0.35)" }
                : undefined
            }
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
    <div
      style={{
        marginTop: 12,
        background: "#fff",
        borderRadius: 12,
        boxShadow: `0 2px 8px ${config.accentColor}1a`,
        padding: "8px 12px",
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: config.accentColor, marginBottom: 6 }}>
        Today&apos;s Total {config.shortLabel}
      </div>
      <div
        style={{
          fontSize: "1rem",
          fontWeight: 500,
          color: displayTotalSeconds > config.exceedSeconds ? "#e74c3c" : "#2d3436",
        }}
      >
        {formatDuration(displayTotalSeconds)}
      </div>
      {displayExceedSeconds > 0 && (
        <div style={{ fontSize: "0.9rem", color: "#e74c3c", marginTop: 4 }}>
          Exceed: {formatDuration(displayExceedSeconds)}
        </div>
      )}
    </div>
  );
}
