"use client";

import React from "react";
import './ClockBreakPrayerFade.css';
import { PrayerButton } from "./PrayerButton";
import { forceSyncClockState } from "../../lib/ui-sync/forceSyncClockState";
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
export function ClockBreakPrayerWidget({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
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

  // Fade-in on mount and force backend-only sync for clock state
  React.useEffect(() => {
    setFadeIn(true);
    if (!employeeId) return;
    
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
        forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
        forceSyncPrayerBreakState(
          employeeId,
          setIsPrayerOn,
          setPrayerBreakTimer,
          setLoadingPrayerBreak,
          setPrayerBreakIntervalId,
          setPrayerStart
        );
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (intervalId) clearInterval(intervalId);
      if (breakIntervalId) clearInterval(breakIntervalId);
      if (prayerBreakIntervalId) clearInterval(prayerBreakIntervalId);
      clearBreakSyncInterval(employeeId);
      clearPrayerBreakSyncInterval(employeeId);
    };
  }, [employeeId]);

  const handleClockIn = async () => {
    if (!employeeId || !employeeName || clockActionPending) {
      alert("Missing employee info");
      return;
    }
    const now = new Date();
    try {
      setClockActionPending(true);
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_name: employeeName,
          date: getDateStringInTimeZone(now),
          clock_in: now.toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Force sync from backend instead of manual state management
        forceSyncClockState(employeeId, setIsClockedIn, setTimer, setLoadingAttendance, setIntervalId);
      } else {
        alert(data.error || "Failed to clock in. Please try again.");
      }
    } catch (error) {
      alert("Error while clocking in. Please try again.");
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

  const confirmClockOut = async (confirmed: boolean) => {
    setShowClockOutConfirm(false);
    if (!confirmed) return;
    if (clockActionPending) return;
    const now = new Date();
    try {
      setClockActionPending(true);
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date: getDateStringInTimeZone(now),
          clock_out: now.toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Force sync from backend instead of manual state management
        forceSyncClockState(employeeId, setIsClockedIn, setTimer, setLoadingAttendance, setIntervalId);
      } else {
        // Show error modal for API errors
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

  const handleBreakStart = async () => {
    if (!employeeId || !isClockedIn || breakActionPending) {
      alert("Clock in first");
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
        }),
      });
      const data = await res.json();
      if (data.success) {
        clearBreakSyncInterval(employeeId);
        setIsOnBreak(true);
        setBreakTimer(0);
        setLoadingBreak(false);
        forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
      } else {
        alert(data.error || "Failed to start break.");
      }
    } catch (error) {
      alert("Error starting break.");
    } finally {
      setBreakActionPending(false);
    }
  };

  const handleBreakEnd = async () => {
    if (!employeeId || !isOnBreak || breakActionPending) {
      alert("No ongoing break found.");
      return;
    }
    const endTime = new Date();
    try {
      setBreakActionPending(true);
      const res = await fetch("/api/breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date: endTime.toISOString(),
          break_end: endTime.toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        clearBreakSyncInterval(employeeId);
        setIsOnBreak(false);
        setBreakTimer(0);
        setLoadingBreak(false);
        forceSyncBreakState(employeeId, setIsOnBreak, setBreakTimer, setLoadingBreak, setBreakIntervalId);
      } else {
        alert(data.error || "Failed to end break.");
      }
    } catch (error) {
      alert("Error ending break.");
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
    <div className={`cbp-fade-in${fadeIn ? ' cbp-fade-in-active' : ''}`} style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: 24, marginBottom: 32 }}>
      {/* Clock In Widget */}
      <div style={{ background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, minWidth: 180, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "#27ae60", marginBottom: 10 }}>Clock In</div>
        {!loadingAttendance && (
          <>
            <button
              onClick={isClockedIn ? handleClockOut : handleClockIn}
              disabled={clockActionPending}
              style={{
                background: isClockedIn ? "#e74c3c" : "#27ae60",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 18px",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: clockActionPending ? "not-allowed" : "pointer",
                opacity: clockActionPending ? 0.6 : 1,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                transition: "background 0.2s"
              }}
            >
              {isClockedIn ? "Clock Out" : "Clock In"}
            </button>
            {showClockOutConfirm && (
              <>
                <style>{`
                  .cbp-modal-overlay {
                    position: fixed;
                    top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.35);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 9999;
                    animation: cbp-fade-in 0.3s;
                  }
                  @keyframes cbp-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                  }
                  .cbp-modal-box {
                    background: #fff;
                    border-radius: 18px;
                    padding: 38px 32px 32px 32px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                    min-width: 340px;
                    text-align: center;
                    animation: cbp-modal-pop 0.35s cubic-bezier(.22,1,.36,1);
                  }
                  @keyframes cbp-modal-pop {
                    0% { transform: scale(0.85); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                  }
                  .cbp-modal-title {
                    font-weight: 700;
                    font-size: 1.25rem;
                    margin-bottom: 22px;
                    color: #e67e22;
                  }
                  .cbp-modal-btn {
                    border: none;
                    border-radius: 8px;
                    padding: 10px 28px;
                    font-weight: 600;
                    font-size: 1.08rem;
                    margin: 0 10px;
                    cursor: pointer;
                    transition: background 0.18s, box-shadow 0.18s;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                  }
                  .cbp-modal-btn-yes {
                    background: linear-gradient(90deg,#e74c3c 60%,#e67e22 100%);
                    color: #fff;
                  }
                  .cbp-modal-btn-yes:hover {
                    background: linear-gradient(90deg,#e67e22 0%,#e74c3c 100%);
                  }
                  .cbp-modal-btn-no {
                    background: linear-gradient(90deg,#27ae60 60%,#00b894 100%);
                    color: #fff;
                  }
                  .cbp-modal-btn-no:hover {
                    background: linear-gradient(90deg,#00b894 0%,#27ae60 100%);
                  }
                `}</style>
                <div className="cbp-modal-overlay">
                  <div className="cbp-modal-box">
                    <div className="cbp-modal-title">Are you sure you want to clock out?</div>
                    <button className="cbp-modal-btn cbp-modal-btn-yes" onClick={() => confirmClockOut(true)}>Yes</button>
                    <button className="cbp-modal-btn cbp-modal-btn-no" onClick={() => confirmClockOut(false)}>No</button>
                  </div>
                </div>
              </>
            )}
            {isClockedIn && (
              <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(52,120,246,0.10)", padding: "8px 12px", minWidth: 120 }}>
                <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#3478f6", marginBottom: 6 }}>Working</div>
                <div style={{ fontSize: "1rem", fontWeight: 500, color: "#2d3436" }}>{formatTime(timer)}</div>
              </div>
            )}
            {showActiveBreakModal && (
              <>
                <style>{`
                  .cbp-break-modal-overlay {
                    position: fixed;
                    top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.35);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 9999;
                    animation: cbp-fade-in 0.3s;
                  }
                  .cbp-break-modal-box {
                    background: #fff;
                    border-radius: 18px;
                    padding: 38px 32px 32px 32px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                    min-width: 360px;
                    text-align: center;
                    animation: cbp-modal-pop 0.35s cubic-bezier(.22,1,.36,1);
                  }
                  .cbp-break-modal-title {
                    font-weight: 700;
                    font-size: 1.25rem;
                    margin-bottom: 8px;
                    color: #e74c3c;
                  }
                  .cbp-break-modal-message {
                    font-weight: 500;
                    font-size: 1.05rem;
                    margin-bottom: 22px;
                    color: #2d3436;
                    line-height: 1.5;
                  }
                  .cbp-break-modal-btn-ok {
                    border: none;
                    border-radius: 8px;
                    padding: 12px 42px;
                    font-weight: 600;
                    font-size: 1.1rem;
                    cursor: pointer;
                    background: linear-gradient(90deg,#e74c3c 60%,#e67e22 100%);
                    color: #fff;
                    transition: background 0.18s, box-shadow 0.18s;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                  }
                  .cbp-break-modal-btn-ok:hover {
                    background: linear-gradient(90deg,#e67e22 0%,#e74c3c 100%);
                  }
                `}</style>
                <div className="cbp-break-modal-overlay">
                  <div className="cbp-break-modal-box">
                    <div style={{ fontSize: "3rem", marginBottom: 12 }}>⚠️</div>
                    <div className="cbp-break-modal-title">{activeBreakTitle}</div>
                    <div className="cbp-break-modal-message">{activeBreakErrorMsg}</div>
                    <button className="cbp-break-modal-btn-ok" onClick={() => setShowActiveBreakModal(false)}>OK</button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Break Widget */}
      {isClockedIn && (
        <div style={{ background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, minWidth: 180, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "#e67e22", marginBottom: 10 }}>Break</div>
          <button
            onClick={isOnBreak ? handleBreakEnd : handleBreakStart}
            disabled={isPrayerOn || breakActionPending}
            style={{
              background: isOnBreak ? "#e74c3c" : "#e67e22",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 18px",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: isPrayerOn || breakActionPending ? "not-allowed" : "pointer",
              opacity: isPrayerOn || breakActionPending ? 0.6 : 1,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              transition: "background 0.2s"
            }}
          >
            {isOnBreak ? "End Break" : "Start Break"}
          </button>
          {isOnBreak && (
            <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(230,126,34,0.10)", padding: "8px 12px", minWidth: 120 }}>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e67e22", marginBottom: 6 }}>🔴 Break Running</div>
              <div style={{ fontSize: "1rem", fontWeight: 500, color: "#2d3436" }}>{formatTime(breakTimer)}</div>
            </div>
          )}
          <BreakSummary employeeId={employeeId} />
        </div>
      )}

      {/* Prayer Break Widget */}
      {isClockedIn && (
        <PrayerButton
          employeeId={employeeId}
          employeeName={employeeName}
          isPrayerOn={isPrayerOn}
          setIsPrayerOn={setIsPrayerOn}
          prayerStart={prayerStart}
          setPrayerStart={setPrayerStart}
          disabled={isOnBreak}
          onClearServerPrayerInterval={() => clearPrayerBreakSyncInterval(employeeId)}
        />
      )}
    </div>
  );
}

// Today's break totals for quick glance
function BreakSummary({ employeeId }: { employeeId: string }) {
  const [totalBreakSeconds, setTotalBreakSeconds] = React.useState(0);
  const [exceedSeconds, setExceedSeconds] = React.useState(0);
  // Removed prayer totals from BreakSummary; shown in Prayer widget instead

  React.useEffect(() => {
    const fetchBreaks = async () => {
      try {
        if (!employeeId) return;
        const attendanceRes = await fetch(`/api/attendance?employeeId=${employeeId}`);
        const attendanceData = await attendanceRes.json();
        const attendanceRowsPre = Array.isArray(attendanceData?.attendance)
          ? attendanceData.attendance
          : [];
        // Fetch ALL breaks for this employee (no date filter)
        const breakRes = await fetch(`/api/breaks?employeeId=${employeeId}`);
        const breakData = await breakRes.json();

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
          setTotalBreakSeconds(total);
          setExceedSeconds(total > 3600 ? total - 3600 : 0);
        } else {
          setTotalBreakSeconds(0);
          setExceedSeconds(0);
        }
      } catch (error) {
        setTotalBreakSeconds(0);
        setExceedSeconds(0);
      }
    };
    fetchBreaks();
  }, [employeeId]);

  return (
    <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(230,126,34,0.10)", padding: "8px 12px", minWidth: 120 }}>
      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e67e22", marginBottom: 6 }}>Today's Total Break</div>
      <div style={{ fontSize: "1rem", fontWeight: 500, color: totalBreakSeconds > 3600 ? "#e74c3c" : "#2d3436" }}>{formatDuration(totalBreakSeconds)}</div>
      {exceedSeconds > 0 && (
        <div style={{ fontSize: "0.9rem", color: "#e74c3c", marginTop: 4 }}>Exceed: {formatDuration(exceedSeconds)}</div>
      )}
    </div>
  );
}
