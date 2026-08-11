// forceSyncClockState.js
// Force UI state to always match backend attendance record (no localStorage, no local override)

import { getParts, SERVER_TIMEZONE } from "../timezone";

const clockIntervalByEmp = new Map();

export function clearClockSyncInterval(employeeId) {
  const eid = String(employeeId ?? "").trim();
  if (!eid) return;
  const prev = clockIntervalByEmp.get(eid);
  if (prev) clearInterval(prev);
  clockIntervalByEmp.delete(eid);
}

function toKarachiEpochMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const parts = getParts(value, SERVER_TIMEZONE);
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

function elapsedSecondsSince(clockInValue) {
  const startMs = toKarachiEpochMs(clockInValue);
  if (startMs === null) return 0;
  const nowMs = toKarachiEpochMs(new Date());
  if (nowMs === null) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

function pickLatestOpenAttendance(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const open = rows.filter(
    (a) =>
      a.clock_in &&
      (a.clock_out == null || a.clock_out === "" || a.clock_out === "null")
  );
  if (open.length === 0) return null;
  open.sort(
    (a, b) => (toKarachiEpochMs(b.clock_in) || 0) - (toKarachiEpochMs(a.clock_in) || 0)
  );
  return open[0];
}

export async function forceSyncClockState(
  employeeId,
  setIsClockedIn,
  setTimer,
  setLoadingAttendance,
  setIntervalId
) {
  const eid = String(employeeId ?? "").trim();
  if (!eid) {
    setIsClockedIn(false);
    setTimer(0);
    setLoadingAttendance(false);
    if (setIntervalId) setIntervalId(null);
    return;
  }

  clearClockSyncInterval(eid);

  try {
    // Same scope as POST clock-in guard: any open row, any date
    const res = await fetch(
      `/api/attendance?employeeId=${encodeURIComponent(eid)}&openOnly=1&summary=1&ts=${Date.now()}`,
      { cache: "no-store" }
    );
    const data = await res.json();

    const openAttendance =
      data.success && Array.isArray(data.attendance)
        ? pickLatestOpenAttendance(data.attendance)
        : null;

    if (openAttendance?.clock_in) {
      setIsClockedIn(true);
      const elapsed = elapsedSecondsSince(openAttendance.clock_in);
      setTimer(elapsed);

      if (setIntervalId) {
        // Tick from Date.now() after one timezone calc — avoids getParts every second
        const baseElapsed = elapsed;
        const baseNow = Date.now();
        const id = setInterval(() => {
          setTimer(baseElapsed + Math.max(0, Math.floor((Date.now() - baseNow) / 1000)));
        }, 1000);
        clockIntervalByEmp.set(eid, id);
        setIntervalId(id);
      }
      setLoadingAttendance(false);
      return;
    }

    setIsClockedIn(false);
    setTimer(0);
    setLoadingAttendance(false);
    if (setIntervalId) setIntervalId(null);
  } catch (err) {
    setIsClockedIn(false);
    setTimer(0);
    setLoadingAttendance(false);
    if (setIntervalId) setIntervalId(null);
  }
}
