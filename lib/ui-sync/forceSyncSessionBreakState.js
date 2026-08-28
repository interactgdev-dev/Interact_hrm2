import { getDateStringInTimeZone, SERVER_TIMEZONE } from "../timezone";

const intervalByEmpKind = new Map();

function intervalKey(employeeId, kind) {
  return `${kind}:${String(employeeId ?? "").trim()}`;
}

export function clearSessionBreakSyncInterval(employeeId, config) {
  const key = intervalKey(employeeId, config.kind);
  const prev = intervalByEmpKind.get(key);
  if (prev) clearInterval(prev);
  intervalByEmpKind.delete(key);
}

function recentRangeQs() {
  const today = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
  const [y, m, d] = today.split("-").map(Number);
  const yest = new Date(Date.UTC(y, m - 1, d - 1));
  const fromDate = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, "0")}-${String(yest.getUTCDate()).padStart(2, "0")}`;
  return `fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(today)}`;
}

function pickRunningForOpenSession(openAttendance, runningRows, startField) {
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
        const t = new Date(pb[startField]).getTime();
        return !Number.isNaN(t) && t >= t0;
      });
      if (afterClockIn) return afterClockIn;
    }
  }

  return runningRows[0];
}

export async function forceSyncSessionBreakState(
  employeeId,
  config,
  setIsOnBreak,
  setBreakTimer,
  setLoadingBreak,
  setBreakIntervalId,
  setBreakStart
) {
  const eid = String(employeeId ?? "").trim();
  const startField = config.startField;
  const endField = config.endField;

  if (!eid) {
    setIsOnBreak(false);
    setBreakTimer(0);
    setLoadingBreak(false);
    if (setBreakStart) setBreakStart(null);
    return;
  }

  clearSessionBreakSyncInterval(eid, config);

  try {
    const range = recentRangeQs();
    const [attRes, pbRes] = await Promise.all([
      fetch(`/api/attendance?employeeId=${eid}&openOnly=1&summary=1`, { cache: "no-store" }),
      fetch(`${config.apiPath}?employeeId=${eid}&${range}`, { cache: "no-store" }),
    ]);
    const attData = await attRes.json();
    const data = await pbRes.json();

    const attendance = Array.isArray(attData?.attendance) ? attData.attendance : [];
    const openAttendance = attendance.find((a) => a.clock_in && !a.clock_out) || null;
    const rows = data.success && Array.isArray(data[config.responseKey]) ? data[config.responseKey] : [];

    if (rows.length > 0) {
      const running = rows.filter((pb) => pb[startField] && !pb[endField]);
      const runningPb = openAttendance
        ? pickRunningForOpenSession(openAttendance, running, startField)
        : null;

      if (runningPb && runningPb[startField]) {
        setIsOnBreak(true);
        const startTime = new Date(runningPb[startField]);
        if (setBreakStart) setBreakStart(startTime);
        const elapsedSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
        setBreakTimer(elapsedSeconds);

        if (setBreakIntervalId) {
          const id = setInterval(() => {
            const newElapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
            setBreakTimer(newElapsed);
          }, 1000);
          intervalByEmpKind.set(intervalKey(eid, config.kind), id);
          setBreakIntervalId(id);
        }
        setLoadingBreak(false);
        return;
      }
    }

    setIsOnBreak(false);
    setBreakTimer(0);
    setLoadingBreak(false);
    if (setBreakStart) setBreakStart(null);
    if (setBreakIntervalId) setBreakIntervalId(null);
  } catch (_) {
    setIsOnBreak(false);
    setBreakTimer(0);
    setLoadingBreak(false);
    if (setBreakStart) setBreakStart(null);
    if (setBreakIntervalId) setBreakIntervalId(null);
  }
}
