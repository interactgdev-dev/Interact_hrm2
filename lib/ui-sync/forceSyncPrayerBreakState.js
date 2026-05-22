// forceSyncPrayerBreakState.js
// Force UI state to always match backend prayer break record (no localStorage, no local override)

const prayerIntervalByEmp = new Map();

export function clearPrayerBreakSyncInterval(employeeId) {
  const eid = String(employeeId ?? "").trim();
  if (!eid) return;
  const prev = prayerIntervalByEmp.get(eid);
  if (prev) clearInterval(prev);
  prayerIntervalByEmp.delete(eid);
}

function pickRunningPrayerForOpenSession(openAttendance, runningRows) {
  if (!runningRows.length) return null;
  const openId =
    openAttendance?.id !== undefined && openAttendance?.id !== null
      ? Number(openAttendance.id)
      : null;

  if (openId !== null && !Number.isNaN(openId)) {
    const bySession = runningRows.find(
      (pb) =>
        pb.attendance_session_id != null &&
        pb.attendance_session_id !== "" &&
        Number(pb.attendance_session_id) === openId
    );
    if (bySession) return bySession;
  }

  if (runningRows.length === 1) return runningRows[0];

  if (openAttendance?.clock_in) {
    const t0 = new Date(openAttendance.clock_in).getTime();
    if (!Number.isNaN(t0)) {
      const afterClockIn = runningRows.find((pb) => {
        const t = new Date(pb.prayer_break_start).getTime();
        return !Number.isNaN(t) && t >= t0;
      });
      if (afterClockIn) return afterClockIn;
    }
  }

  return runningRows[0];
}

/**
 * @param {function|null|undefined} setPrayerStart - optional; pass React setState for Date | null so PrayerButton timer matches DB after refresh
 */
export async function forceSyncPrayerBreakState(
  employeeId,
  setIsOnPrayerBreak,
  setPrayerBreakTimer,
  setLoadingPrayerBreak,
  setPrayerBreakIntervalId,
  setPrayerStart
) {
  const eid = String(employeeId ?? "").trim();
  if (!eid) {
    setIsOnPrayerBreak(false);
    setPrayerBreakTimer(0);
    setLoadingPrayerBreak(false);
    if (setPrayerStart) setPrayerStart(null);
    return;
  }

  clearPrayerBreakSyncInterval(eid);

  try {
    const [attRes, pbRes] = await Promise.all([
      fetch(`/api/attendance?employeeId=${eid}`),
      fetch(`/api/prayer_breaks?employeeId=${eid}`),
    ]);
    const attData = await attRes.json();
    const data = await pbRes.json();

    const attendance = Array.isArray(attData?.attendance) ? attData.attendance : [];
    const openAttendance = attendance.find((a) => a.clock_in && !a.clock_out) || null;

    if (data.success && Array.isArray(data.prayer_breaks) && data.prayer_breaks.length > 0) {
      const running = data.prayer_breaks.filter(
        (pb) => pb.prayer_break_start && !pb.prayer_break_end
      );
      const runningPb = openAttendance
        ? pickRunningPrayerForOpenSession(openAttendance, running)
        : null;

      if (runningPb && runningPb.prayer_break_start) {
        setIsOnPrayerBreak(true);
        const startTime = new Date(runningPb.prayer_break_start);
        if (setPrayerStart) setPrayerStart(startTime);
        const elapsedSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
        setPrayerBreakTimer(elapsedSeconds);

        if (setPrayerBreakIntervalId) {
          const id = setInterval(() => {
            const newElapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
            setPrayerBreakTimer(newElapsed);
          }, 1000);
          prayerIntervalByEmp.set(eid, id);
          setPrayerBreakIntervalId(id);
        }
        setLoadingPrayerBreak(false);
        return;
      }
    }

    setIsOnPrayerBreak(false);
    setPrayerBreakTimer(0);
    setLoadingPrayerBreak(false);
    if (setPrayerStart) setPrayerStart(null);
    if (setPrayerBreakIntervalId) setPrayerBreakIntervalId(null);
  } catch (err) {
    setIsOnPrayerBreak(false);
    setPrayerBreakTimer(0);
    setLoadingPrayerBreak(false);
    if (setPrayerStart) setPrayerStart(null);
    if (setPrayerBreakIntervalId) setPrayerBreakIntervalId(null);
  }
}
