// forceSyncBreakState.js
// Force UI state to always match backend break record (no localStorage, no local override)

const breakIntervalByEmp = new Map();

export function clearBreakSyncInterval(employeeId) {
  const eid = String(employeeId ?? "").trim();
  if (!eid) return;
  const prev = breakIntervalByEmp.get(eid);
  if (prev) clearInterval(prev);
  breakIntervalByEmp.delete(eid);
}

function pickRunningBreakForOpenSession(openAttendance, runningBreaks) {
  if (!runningBreaks.length) return null;
  const openId =
    openAttendance?.id !== undefined && openAttendance?.id !== null
      ? Number(openAttendance.id)
      : null;

  if (openId !== null && !Number.isNaN(openId)) {
    const bySession = runningBreaks.find(
      (b) =>
        b.attendance_session_id != null &&
        b.attendance_session_id !== "" &&
        Number(b.attendance_session_id) === openId
    );
    if (bySession) return bySession;
  }

  if (runningBreaks.length === 1) return runningBreaks[0];

  if (openAttendance?.clock_in) {
    const t0 = new Date(openAttendance.clock_in).getTime();
    if (!Number.isNaN(t0)) {
      const afterClockIn = runningBreaks.find((b) => {
        const t = new Date(b.break_start).getTime();
        return !Number.isNaN(t) && t >= t0;
      });
      if (afterClockIn) return afterClockIn;
    }
  }

  return runningBreaks[0];
}

export async function forceSyncBreakState(
  employeeId,
  setIsOnBreak,
  setBreakTimer,
  setLoadingBreak,
  setBreakIntervalId
) {
  const eid = String(employeeId ?? "").trim();
  if (!eid) {
    setIsOnBreak(false);
    setBreakTimer(0);
    setLoadingBreak(false);
    return;
  }

  clearBreakSyncInterval(eid);

  try {
    const [attRes, breakRes] = await Promise.all([
      fetch(`/api/attendance?employeeId=${eid}`),
      fetch(`/api/breaks?employeeId=${eid}`),
    ]);
    const attData = await attRes.json();
    const data = await breakRes.json();

    const attendance = Array.isArray(attData?.attendance) ? attData.attendance : [];
    const openAttendance = attendance.find((a) => a.clock_in && !a.clock_out) || null;

    if (data.success && Array.isArray(data.breaks) && data.breaks.length > 0) {
      const running = data.breaks.filter((b) => b.break_start && !b.break_end);
      // Only show a running break while clocked in (open attendance row).
      const runningBreak = openAttendance
        ? pickRunningBreakForOpenSession(openAttendance, running)
        : null;

      if (runningBreak && runningBreak.break_start) {
        setIsOnBreak(true);
        const breakStartTime = new Date(runningBreak.break_start);
        const elapsedSeconds = Math.floor((Date.now() - breakStartTime.getTime()) / 1000);
        setBreakTimer(elapsedSeconds);

        if (setBreakIntervalId) {
          const id = setInterval(() => {
            const newElapsed = Math.floor((Date.now() - breakStartTime.getTime()) / 1000);
            setBreakTimer(newElapsed);
          }, 1000);
          breakIntervalByEmp.set(eid, id);
          setBreakIntervalId(id);
        }
        setLoadingBreak(false);
        return;
      }
    }

    setIsOnBreak(false);
    setBreakTimer(0);
    setLoadingBreak(false);
    if (setBreakIntervalId) setBreakIntervalId(null);
  } catch (err) {
    setIsOnBreak(false);
    setBreakTimer(0);
    setLoadingBreak(false);
    if (setBreakIntervalId) setBreakIntervalId(null);
  }
}
