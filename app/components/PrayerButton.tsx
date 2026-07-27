"use client";
import React from "react";
import type { BiometricAction } from "@/lib/face-types";
import { getDateStringInTimeZone } from "../../lib/timezone";
import slackStylesDefault from "./clock-widgets-slack.module.css";
import todayStyles from "./clock-widgets-today.module.css";
import {
  ATTENDANCE_DATA_CHANGED,
  PRAYER_DATA_CHANGED,
  notifyPrayerDataChanged,
} from "../../lib/ui-sync/breakPrayerDataRefresh";
import { toastError, toastSuccess } from "@/lib/app-toast";

/** When clocked in across midnight, breaks/prayers fall on multiple calendar days; use session range, not date=today only. */
function buildPrayerBreaksListUrl(employeeId: string, attendanceRows: any[]): string {
  const today = getDateStringInTimeZone(new Date());
  const sorted = attendanceRows
    .filter((a: any) => a.clock_in)
    .sort(
      (a: any, b: any) =>
        new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime()
    );
  const activeOpen = sorted.find((a: any) => a.clock_in && !a.clock_out) || null;
  let url = `/api/prayer_breaks?employeeId=${encodeURIComponent(employeeId)}`;
  if (activeOpen?.clock_in) {
    const from = getDateStringInTimeZone(activeOpen.clock_in);
    url += `&fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(today)}`;
  } else {
    url += `&date=${encodeURIComponent(today)}`;
  }
  return url;
}

interface PrayerButtonProps {
  employeeId: string;
  employeeName: string;
  isPrayerOn: boolean;
  setIsPrayerOn: React.Dispatch<React.SetStateAction<boolean>>;
  setPrayerStart: React.Dispatch<React.SetStateAction<Date | null>>;
  /** Parent-owned timer (same pattern as lunch breakTimer in ClockBreakPrayer). */
  prayerTimer: number;
  prayerTimerPaused: boolean;
  prayerEndAtRef: React.MutableRefObject<Date | null>;
  pausePrayerTimerForVerify: () => void;
  resumePrayerTimerAfterVerify: () => void;
  resetPrayerPauseState: () => void;
  onPrayerStateChanged: () => void;
  disabled?: boolean;
  runWithVerify?: (
    action: BiometricAction,
    callback: (biometricToken: string | null) => void | Promise<void>
  ) => void;
  bioStatusLoading?: boolean;
  /** Stop server-sync interval after ending prayer (parent refresh uses Map-based intervals). */
  onClearServerPrayerInterval?: () => void;
  variant?: "default" | "slack" | "todayStatus";
}

export function PrayerButton({
  employeeId,
  employeeName,
  isPrayerOn,
  setIsPrayerOn,
  setPrayerStart,
  prayerTimer,
  prayerTimerPaused,
  prayerEndAtRef,
  pausePrayerTimerForVerify,
  resumePrayerTimerAfterVerify,
  resetPrayerPauseState,
  onPrayerStateChanged,
  disabled = false,
  runWithVerify,
  bioStatusLoading = false,
  onClearServerPrayerInterval,
  variant = "default",
}: PrayerButtonProps) {
  const isSlack = variant === "slack" || variant === "todayStatus";
  const slackStyles = variant === "todayStatus" ? todayStyles : slackStylesDefault;
  const [prayerActionPending, setPrayerActionPending] = React.useState(false);

  const handlePrayerStart = async (biometricToken: string | null = null) => {
    if (!employeeId || prayerActionPending) return;
    const startTime = new Date();
    try {
      setPrayerActionPending(true);
      const res = await fetch("/api/prayer_breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          date: startTime.toISOString(),
          prayer_break_start: startTime.toISOString(),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsPrayerOn(true);
        setPrayerStart(startTime);
        notifyPrayerDataChanged();
        onPrayerStateChanged();
        toastSuccess("Prayer break started.", "Prayer break");
      } else if (
        res.status === 403 &&
        String(data.error || "").toLowerCase().includes("face verification") &&
        runWithVerify
      ) {
        runWithVerify("prayer_start", (token) => handlePrayerStart(token));
      } else {
        toastError(data.error || "Failed to start prayer break");
      }
    } catch (err) {
      console.error(err);
      toastError("Error starting prayer break");
    } finally {
      setPrayerActionPending(false);
    }
  };

  const handlePrayerEnd = async (biometricToken: string | null = null) => {
    if (!employeeId || prayerActionPending) return;
    const endTime = prayerEndAtRef.current ?? new Date();
    try {
      setPrayerActionPending(true);
      const res = await fetch("/api/prayer_breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date: endTime.toISOString(),
          prayer_break_end: endTime.toISOString(),
          ...(biometricToken ? { biometric_token: biometricToken } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        resetPrayerPauseState();
        setIsPrayerOn(false);
        setPrayerStart(null);
        onClearServerPrayerInterval?.();
        notifyPrayerDataChanged();
        onPrayerStateChanged();
        toastSuccess("Prayer break ended.", "Prayer break");
      } else if (
        res.status === 403 &&
        String(data.error || "").toLowerCase().includes("face verification") &&
        runWithVerify
      ) {
        if (!prayerEndAtRef.current) prayerEndAtRef.current = new Date();
        pausePrayerTimerForVerify();
        runWithVerify("prayer_end", (token) => handlePrayerEnd(token));
      } else {
        prayerEndAtRef.current = null;
        resumePrayerTimerAfterVerify();
        toastError(data.error || "Failed to end prayer break");
      }
    } catch (err) {
      console.error(err);
      prayerEndAtRef.current = null;
      resumePrayerTimerAfterVerify();
      toastError("Error ending prayer break");
    } finally {
      setPrayerActionPending(false);
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div
      className={isSlack ? `${slackStyles.card} ${slackStyles.cardPrayer}` : undefined}
      style={isSlack ? undefined : { background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, minWidth: 180, display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      {isSlack ? (
        <div className={slackStyles.cardHeader}>
          <span className={`${slackStyles.cardTitle} ${slackStyles.titlePrayer}`}>
            <span className={`${slackStyles.titleIcon} ${slackStyles.titleIconPrayer}`} aria-hidden>
              {/* Standing prayer — clear side profile, hands folded on mat */}
              <svg viewBox="0 0 56 56" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {/* Prayer mat */}
                <path d="M4 48h48" />
                <path d="M8 48 L14 42 H50 L44 48" />
                {/* Head */}
                <circle cx="18" cy="10" r="5.5" />
                {/* Body (long robe) — side standing */}
                <path d="M18 15.5v3.5" />
                <path d="M12 20.5c0-1.5 1.3-2.8 3-2.8h6c1.7 0 3 1.3 3 2.8v22.5c0 1.2-1 2.2-2.2 2.2h-7.6c-1.2 0-2.2-1-2.2-2.2V20.5z" />
                {/* Arms folded across body */}
                <path d="M11.5 28.5c2.2 2.8 5.2 4.2 8.5 4.2s6.3-1.4 8.5-4.2" />
                <path d="M13 31.5c1.8 1.8 4 2.7 6.5 2.7s4.7-.9 6.5-2.7" />
                {/* Feet */}
                <path d="M14.5 45.8h4" />
                <path d="M19.5 45.8h4" />
              </svg>
            </span>
            Prayer Break
          </span>
          {isPrayerOn && <span className={`${slackStyles.cardBadge} ${slackStyles.badgeLive}`}>In prayer</span>}
        </div>
      ) : (
        <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "#8e44ad", marginBottom: 10 }}>Prayer Break</div>
      )}
      <button
        onClick={
          isPrayerOn
            ? () =>
                runWithVerify
                  ? runWithVerify("prayer_end", (token) => handlePrayerEnd(token))
                  : handlePrayerEnd()
            : () =>
                runWithVerify
                  ? runWithVerify("prayer_start", (token) => handlePrayerStart(token))
                  : handlePrayerStart()
        }
        disabled={disabled || prayerActionPending || bioStatusLoading}
        className={isSlack ? `${slackStyles.btn} ${isPrayerOn ? slackStyles.btnPrayerEnd : slackStyles.btnPrayer}` : undefined}
        style={isSlack ? undefined : {
          background: isPrayerOn ? "#e74c3c" : "#8e44ad",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "8px 18px",
          fontSize: "1rem",
          fontWeight: 600,
          cursor: disabled || prayerActionPending || bioStatusLoading ? "not-allowed" : "pointer",
          opacity: disabled || prayerActionPending || bioStatusLoading ? 0.6 : 1,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          transition: "background 0.2s"
        }}
      >
        {bioStatusLoading ? "Preparing…" : isPrayerOn ? "End Prayer" : "Start Prayer"}
      </button>
      {isPrayerOn && !isSlack ? (
        <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(142,68,173,0.10)", padding: "8px 12px", minWidth: 120 }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#8e44ad", marginBottom: 6 }}>
            {prayerTimerPaused ? "⏸ Verifying…" : "🔴 Prayer Running"}
          </div>
          <div style={{ fontSize: "1rem", fontWeight: 500, color: "#2d3436" }}>{formatTime(prayerTimer)}</div>
        </div>
      ) : null}
      <PrayerTotals
        employeeId={employeeId}
        isPrayerOn={isPrayerOn}
        livePrayerSeconds={prayerTimer}
        variant={variant}
      />
    </div>
  );
}

// Today's total prayer time summary
function PrayerTotals({
  employeeId,
  isPrayerOn = false,
  livePrayerSeconds = 0,
  variant = "default",
}: {
  employeeId: string;
  isPrayerOn?: boolean;
  livePrayerSeconds?: number;
  variant?: "default" | "slack" | "todayStatus";
}) {
  const isSlack = variant === "slack" || variant === "todayStatus";
  const slackStyles = variant === "todayStatus" ? todayStyles : slackStylesDefault;
  const [completedPrayerSeconds, setCompletedPrayerSeconds] = React.useState(0);

  const displayTotalSeconds =
    completedPrayerSeconds + (isPrayerOn ? Math.max(0, livePrayerSeconds) : 0);
  const displayExceedSeconds =
    displayTotalSeconds > 1800 ? displayTotalSeconds - 1800 : 0;

  const refreshTotals = React.useCallback(async () => {
    try {
      if (!employeeId) return;
      const attendanceRes = await fetch(`/api/attendance?employeeId=${employeeId}`);
      const attendanceData = await attendanceRes.json();
      const attendanceRowsPre = Array.isArray(attendanceData?.attendance)
        ? attendanceData.attendance
        : [];
      const prayerRes = await fetch(`/api/prayer_breaks?employeeId=${employeeId}`);
      const prayerData = await prayerRes.json();

      const prayerRows =
        prayerData.success && Array.isArray(prayerData.prayer_breaks)
          ? prayerData.prayer_breaks
          : [];
      const attendanceRows = attendanceRowsPre;

      const sortedAttendance = attendanceRows
        .filter((a: any) => a.clock_in)
        .sort(
          (a: any, b: any) =>
            new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime()
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

        if (!row.prayer_break_start || sessionStartMs === null) return false;
        const prayerStartMs = new Date(row.prayer_break_start).getTime();
        if (Number.isNaN(prayerStartMs) || Number.isNaN(sessionStartMs)) {
          return false;
        }

        if (prayerStartMs < sessionStartMs) return false;
        if (
          sessionEndMs !== null &&
          !Number.isNaN(sessionEndMs) &&
          prayerStartMs > sessionEndMs
        ) {
          return false;
        }

        return true;
      };

      if (prayerRows.length > 0) {
        let total = 0;
        prayerRows.forEach((p: any) => {
          if (
            p.prayer_break_start &&
            p.prayer_break_end &&
            belongsToCurrentSession(p)
          ) {
            const s = new Date(p.prayer_break_start).getTime();
            const e = new Date(p.prayer_break_end).getTime();
            total += Math.floor((e - s) / 1000);
          }
        });
        setCompletedPrayerSeconds(total);
      } else {
        setCompletedPrayerSeconds(0);
      }
    } catch {
      setCompletedPrayerSeconds(0);
    }
  }, [employeeId]);

  React.useEffect(() => {
    refreshTotals();
  }, [refreshTotals]);

  React.useEffect(() => {
    const onRefresh = () => {
      refreshTotals();
    };
    window.addEventListener(PRAYER_DATA_CHANGED, onRefresh);
    window.addEventListener(ATTENDANCE_DATA_CHANGED, onRefresh);
    return () => {
      window.removeEventListener(PRAYER_DATA_CHANGED, onRefresh);
      window.removeEventListener(ATTENDANCE_DATA_CHANGED, onRefresh);
    };
  }, [refreshTotals]);

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
          <div className={slackStyles.summaryLabel}>Total Prayer</div>
          <div
            className={slackStyles.summaryValue}
            style={displayTotalSeconds > 1800 ? { color: "#dc2626", borderColor: "rgba(220,38,38,0.35)" } : undefined}
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
    <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(142,68,173,0.10)", padding: "8px 12px", minWidth: 120 }}>
      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#8e44ad", marginBottom: 6 }}>Today's Total Prayer</div>
      <div style={{ fontSize: "1rem", fontWeight: 500, color: displayTotalSeconds > 1800 ? "#e74c3c" : "#2d3436" }}>{formatDuration(displayTotalSeconds)}</div>
      {displayExceedSeconds > 0 && (
        <div style={{ fontSize: "0.9rem", color: "#e74c3c", marginTop: 4 }}>Exceed: {formatDuration(displayExceedSeconds)}</div>
      )}
    </div>
  );
}
