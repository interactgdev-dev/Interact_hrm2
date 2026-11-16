import { parseAttendanceDateTimeMs } from "./shift-timing";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "./timezone";
import {
  buildPinProfilesFromRows,
  hrmMapFromEmployees,
  profileMapsFromApi,
  resolveZkIdentity,
  type HrmCodeProfile,
  type PinProfile,
} from "./zkbio-employee-resolve";

export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const TUNGSTEN_AFTER_CLOCK_GRACE_MS = 30 * 60 * 1000;
/** Exit window: up to 1h before shift end through 2h after (overnight AM outs). */
const EXIT_BEFORE_SHIFT_END_MS = 60 * 60 * 1000;
const EXIT_AFTER_SHIFT_END_MS = 2 * 60 * 60 * 1000;
/** Early arrival: count punches up to this long before shift start as T.Punch In. */
const ENTRY_BEFORE_SHIFT_START_MS = 4 * 60 * 60 * 1000;

export type TungstenPunchContext = {
  zkRows: Record<string, unknown>[];
  batchPinProfiles: Map<string, PinProfile>;
  dbPinProfiles: Map<string, PinProfile>;
  hrmByCode: Map<string, HrmCodeProfile>;
};

/** One row = one Employee Report session (same punch in/out logic). */
export type EmployeeReportSession = {
  sessionDate: string;
  tungstenPunchIn: string;
  hrmClockIn: string;
  hrmClockOut: string;
  tungstenPunchOut: string;
};

type InternalRow = {
  source: "H" | "T";
  sortAt: string;
  date: string;
  time: string;
  detail: string;
};

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** HRM + ZKBio timestamps — UTC wall in DB (same as attendance / auto clock-out). */
function rowFromIso(source: "H" | "T", iso: string, detail: string): InternalRow | null {
  const ms = parseAttendanceDateTimeMs(iso);
  if (ms == null) return null;
  const at = new Date(ms);
  return {
    source,
    sortAt: at.toISOString(),
    date: getDateStringInTimeZone(ms, SERVER_TIMEZONE),
    time: getTimeStringInTimeZone(ms, SERVER_TIMEZONE),
    detail,
  };
}

export async function fetchAllZkRows(baseParams: URLSearchParams): Promise<{
  rows: Record<string, unknown>[];
  departments: string[];
}> {
  const all: Record<string, unknown>[] = [];
  const deptSet = new Set<string>();
  let page = 1;
  let total = 0;

  do {
    const params = new URLSearchParams(baseParams);
    params.set("employeeReport", "1");
    params.set("page", String(page));
    params.set("pageSize", "2000");
    const res = await fetch(`/api/zkbio-punch-log?${params}`);
    const data = await res.json();
    if (!data.success) break;
    total = Number(data.total) || 0;
    const batch = (data.rows || []) as Record<string, unknown>[];
    all.push(...batch);
    if (Array.isArray(data.departments)) {
      data.departments.forEach((d: string) => deptSet.add(d));
    }
    if (batch.length === 0) break;
    page += 1;
  } while (all.length < total && page <= 250);

  return { rows: all, departments: [...deptSet] };
}

/** One bulk ZK fetch (like Employee Report) — identity resolved client-side via pin profiles. */
export async function loadTungstenPunchContext(
  dateFrom: string,
  dateTo: string,
  dept?: string,
): Promise<TungstenPunchContext> {
  const zkParams = new URLSearchParams({
    dateFrom: addDaysToDateKey(dateFrom, -1),
    dateTo: addDaysToDateKey(dateTo, 1),
  });
  if (dept) zkParams.set("dept", dept);

  const [zkResult, pinProfRes, empListRes] = await Promise.all([
    fetchAllZkRows(zkParams),
    fetch("/api/zkbio-pin-profiles"),
    fetch("/api/employee-list"),
  ]);

  const pinProfData = await pinProfRes.json();
  const empListData = await empListRes.json();

  return {
    zkRows: zkResult.rows,
    batchPinProfiles: buildPinProfilesFromRows(zkResult.rows),
    dbPinProfiles: pinProfData.success
      ? profileMapsFromApi(pinProfData.profiles || [])
      : new Map(),
    hrmByCode:
      empListData.success && empListData.employees
        ? hrmMapFromEmployees(empListData.employees)
        : new Map(),
  };
}

function appendTungstenRows(
  merged: InternalRow[],
  employeeName: string,
  ctx: TungstenPunchContext,
  zkDateFrom: string,
  zkDateTo: string,
) {
  const key = normalizeName(employeeName);
  for (const z of ctx.zkRows) {
    const pin = String(z.pin ?? "").trim();
    const { employeeName: zkName } = resolveZkIdentity(
      z,
      ctx.batchPinProfiles,
      ctx.dbPinProfiles,
      ctx.hrmByCode,
    );
    const hrmMatch = pin ? ctx.hrmByCode.get(pin) : undefined;
    const rowName = (hrmMatch?.employeeName || zkName).trim().toLowerCase().replace(/\s+/g, " ");
    if (rowName !== key) continue;

    const rawVal = z.event_time ?? z.imported_at;
    if (rawVal == null || rawVal === "") continue;
    const raw = String(rawVal);
    const punchMs = parseAttendanceDateTimeMs(raw);
    if (punchMs == null) continue;
    const eventDate = getDateStringInTimeZone(punchMs, SERVER_TIMEZONE);
    if (eventDate < zkDateFrom || eventDate > zkDateTo) continue;

    const reader = String(z.reader_name || "").trim() || "-";
    const event = String(z.event_name || "").trim() || "Punch";
    const r = rowFromIso("T", raw, `${reader} — ${event}`);
    if (r) merged.push(r);
  }
}

type HrmEvent = { sortAt: string; date: string; time: string };
type TungstenEvent = { atMs: number; time: string; date: string };

function parseShiftTimeToHms(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!match) return null;
  return {
    h: Number(match[1]),
    m: Number(match[2]),
    s: Number(match[3] || "0"),
  };
}

/** Wall-clock on dateKey in Asia/Karachi (UTC+5, no DST). */
function wallClockToEpochMs(dateKey: string, timeValue: string) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const hms = parseShiftTimeToHms(timeValue);
  if (!y || !mo || !d || !hms) return null;
  return Date.UTC(y, mo - 1, d, hms.h - 5, hms.m, hms.s);
}

/**
 * Earliest valid entry punch for a shift day (not overnight carry-over).
 * Prefer first punch before shift start ("aty hoye"); else first at/after shift start.
 */
function entryFloorMsForShiftDay(
  sessionDate: string,
  shiftStartMs: number,
  crossesMidnight: boolean,
): number {
  if (crossesMidnight) {
    return shiftStartMs - ENTRY_BEFORE_SHIFT_START_MS;
  }
  const noonMs = wallClockToEpochMs(sessionDate, "12:00:00");
  const dayStartMs = wallClockToEpochMs(sessionDate, "00:00:00");
  // Afternoon/evening day shift: ignore pre-noon AM leftovers from overnight.
  if (noonMs != null && shiftStartMs >= noonMs) return noonMs;
  // Morning shift: from midnight / up to 4h early — do NOT skip before noon.
  const early = shiftStartMs - ENTRY_BEFORE_SHIFT_START_MS;
  if (dayStartMs != null) return Math.max(dayStartMs, early);
  return early;
}

/**
 * Arrival thumb for a shift day: very first punch in the entry window
 * (early arrival before shift, else first at/after shift start).
 */
function firstArrivalPunchForShiftDay(
  tungstenByTime: TungstenEvent[],
  sessionDate: string,
  shiftStart: string | null | undefined,
  shiftEnd?: string | null,
): string | undefined {
  const shiftMs = wallClockToEpochMs(sessionDate, shiftStart || "14:00:00");
  if (shiftMs == null) return undefined;

  const startHms = parseShiftTimeToHms(shiftStart || "14:00:00");
  const endHms = parseShiftTimeToHms(shiftEnd || null);
  const crossesMidnight =
    !!startHms &&
    !!endHms &&
    endHms.h * 60 + endHms.m <= startHms.h * 60 + startHms.m;
  const floorMs = entryFloorMsForShiftDay(sessionDate, shiftMs, crossesMidnight);

  const candidates = tungstenByTime
    .filter((t) => t.atMs >= floorMs)
    .sort((a, b) => a.atMs - b.atMs);
  if (!candidates.length) return undefined;

  // Prefer first early arrival before shift start
  const early = candidates.find((t) => t.atMs < shiftMs);
  if (early) return early.time;
  // Else very first at/after shift start
  return candidates[0].time;
}

function isExitCandidate(
  t: TungstenEvent,
  cinMs: number,
  usedPunchAt: Set<number>,
  excludeExitAtMs?: number,
) {
  return (
    t.atMs >= cinMs &&
    !usedPunchAt.has(t.atMs) &&
    (excludeExitAtMs == null || t.atMs !== excludeExitAtMs)
  );
}

/**
 * T.Punch out: last exit Tungsten for this session.
 * 1) Last punch in 30 min after clock-out
 * 2) Else last door punch before clock-out
 * 3) Else last same-day punch after clock-out (late ZK / just past grace)
 */
function assignSessionPunchOut(
  tungstenByTime: TungstenEvent[],
  sessionDate: string,
  cinMs: number,
  outMs: number,
  nowMs: number,
  usedPunchAt: Set<number>,
  excludeExitAtMs?: number,
): string | undefined {
  if (Number.isNaN(cinMs) || Number.isNaN(outMs)) return undefined;

  const graceEnd = outMs + TUNGSTEN_AFTER_CLOCK_GRACE_MS;
  const searchEnd = Math.min(nowMs, graceEnd);

  const afterOutGrace = tungstenByTime.filter(
    (t) =>
      isExitCandidate(t, cinMs, usedPunchAt, excludeExitAtMs) &&
      t.atMs >= outMs &&
      t.atMs <= searchEnd,
  );
  if (afterOutGrace.length) {
    const pick = afterOutGrace[afterOutGrace.length - 1];
    usedPunchAt.add(pick.atMs);
    return pick.time;
  }

  const beforeOut = tungstenByTime.filter(
    (t) =>
      isExitCandidate(t, cinMs, usedPunchAt, excludeExitAtMs) &&
      t.atMs < outMs,
  );
  if (beforeOut.length) {
    const pick = beforeOut[beforeOut.length - 1];
    usedPunchAt.add(pick.atMs);
    return pick.time;
  }

  const sameDayLateExit = tungstenByTime.filter(
    (t) =>
      t.date === sessionDate &&
      isExitCandidate(t, cinMs, usedPunchAt, excludeExitAtMs) &&
      t.atMs > outMs,
  );
  if (sameDayLateExit.length) {
    const pick = sameDayLateExit[sameDayLateExit.length - 1];
    usedPunchAt.add(pick.atMs);
    return pick.time;
  }

  return undefined;
}

/** Shift-day punches: include next-morning exits for overnight shifts. */
function collectShiftDayPunches(
  tungstenByTime: TungstenEvent[],
  sessionDate: string,
  shift?: ShiftDayTiming | null,
): TungstenEvent[] {
  const onDay = tungstenByTime.filter((t) => t.date === sessionDate);
  if (!shift?.startTime || !shift?.endTime) return onDay;

  const start = parseShiftTimeToHms(shift.startTime);
  const end = parseShiftTimeToHms(shift.endTime);
  if (!start || !end) return onDay;

  const overnight = end.h * 60 + end.m <= start.h * 60 + start.m;
  if (!overnight) return onDay;

  const nextDate = addDaysToDateKey(sessionDate, 1);
  const shiftEndMs = computeShiftEndEpochMs(
    {
      start_time: shift.startTime,
      end_time: shift.endTime,
      assigned_date: sessionDate,
    },
    sessionDate,
  );
  const windowEnd =
    shiftEndMs != null ? shiftEndMs + EXIT_AFTER_SHIFT_END_MS : null;
  const nextDay = tungstenByTime.filter(
    (t) =>
      t.date === nextDate &&
      windowEnd != null &&
      t.atMs <= windowEnd,
  );
  return [...onDay, ...nextDay];
}

type ShiftDayPunchOptions = {
  /**
   * When true, T.Punch Out must be a real punch at/after shift end.
   * No fallback to "day last punch" before shift end.
   */
  requireOutAfterShiftEnd?: boolean;
  /**
   * When true (Khalid pilot): T.In = first at/after shift start;
   * T.Out = last punch in span until next day's shift start (overnight-safe).
   */
  lastAnyPunchInSpan?: boolean;
  /**
   * Pervaiz midnight shift: T.Out = last punch after midnight (shift end)
   * until morning cap (default 08:00) — ignores next-day late-morning returns.
   */
  midnightExitLastPunch?: boolean;
};

/**
 * Shift-day T.Punch: very first punch in entry window (early arrival allowed);
 * last punch near shift end / overnight midnight span.
 */
function firstLastPunchForShiftDay(
  tungstenByTime: TungstenEvent[],
  sessionDate: string,
  shift?: ShiftDayTiming | null,
  options?: ShiftDayPunchOptions,
): { punchIn: string; punchOut: string } {
  if (!shift?.startTime || !shift?.endTime) {
    const onDay = [...tungstenByTime.filter((t) => t.date === sessionDate)].sort(
      (a, b) => a.atMs - b.atMs,
    );
    if (!onDay.length) return { punchIn: "-", punchOut: "-" };
    const punchIn = onDay[0].time;
    const punchOut = onDay.length > 1 ? onDay[onDay.length - 1].time : "-";
    return { punchIn, punchOut: punchOut === punchIn ? "-" : punchOut };
  }

  const shiftStartMs = wallClockToEpochMs(sessionDate, shift.startTime);
  const shiftEndMs = computeShiftEndEpochMs(
    {
      start_time: shift.startTime,
      end_time: shift.endTime,
      assigned_date: sessionDate,
    },
    sessionDate,
  );
  if (shiftStartMs == null || shiftEndMs == null) return { punchIn: "-", punchOut: "-" };

  const crossesMidnight = shiftEndMs <= shiftStartMs;
  const entryFromMs = entryFloorMsForShiftDay(
    sessionDate,
    shiftStartMs,
    crossesMidnight,
  );

  // Pervaiz midnight: last punch after shift end until morning — not 10am–noon returns.
  if (options?.midnightExitLastPunch === true && crossesMidnight) {
    const nextStartMs = wallClockToEpochMs(
      addDaysToDateKey(sessionDate, 1),
      shift.startTime,
    );
    const morningCapMs = wallClockToEpochMs(
      addDaysToDateKey(sessionDate, 1),
      PUNCH_ONLY_MIDNIGHT_EXIT_MORNING_CAP,
    );
    let collectUntilMs =
      nextStartMs != null ? nextStartMs - 1 : shiftStartMs + MAX_SESSION_MS;
    if (morningCapMs != null) {
      collectUntilMs = Math.min(collectUntilMs, morningCapMs);
    }
    const spanPunches = tungstenByTime
      .filter((t) => t.atMs >= entryFromMs && t.atMs <= collectUntilMs)
      .sort((a, b) => a.atMs - b.atMs);
    if (!spanPunches.length) return { punchIn: "-", punchOut: "-" };
    const punchIn = spanPunches[0].time;
    const afterMidnight = spanPunches.filter(
      (t) => t.atMs >= shiftEndMs && t.time !== punchIn,
    );
    let punchOut = "-";
    if (afterMidnight.length) {
      punchOut = afterMidnight[afterMidnight.length - 1].time;
    } else if (spanPunches.length > 1) {
      // Left before midnight — last evening punch still counts as Out.
      punchOut = spanPunches[spanPunches.length - 1].time;
    }
    if (punchOut === punchIn) punchOut = "-";
    return { punchIn, punchOut };
  }

  // Overnight / Khalid last-span: through next morning (noon-capped) until next shift.
  // Default for midnight shifts so T.Out is the real last exit, not a mid-evening punch.
  const useLastSpan =
    options?.lastAnyPunchInSpan === true ||
    (crossesMidnight && options?.lastAnyPunchInSpan !== false && !options?.requireOutAfterShiftEnd);
  if (useLastSpan && crossesMidnight) {
    const nextStartMs = wallClockToEpochMs(
      addDaysToDateKey(sessionDate, 1),
      shift.startTime,
    );
    let collectUntilMs =
      nextStartMs != null ? nextStartMs - 1 : shiftStartMs + MAX_SESSION_MS;
    const noonNextMs = wallClockToEpochMs(
      addDaysToDateKey(sessionDate, 1),
      "12:00:00",
    );
    if (noonNextMs != null) {
      collectUntilMs = Math.min(collectUntilMs, noonNextMs);
    }
    const spanPunches = tungstenByTime
      .filter((t) => t.atMs >= entryFromMs && t.atMs <= collectUntilMs)
      .sort((a, b) => a.atMs - b.atMs);
    if (!spanPunches.length) return { punchIn: "-", punchOut: "-" };
    const punchIn = spanPunches[0].time;
    let punchOut =
      spanPunches.length > 1 ? spanPunches[spanPunches.length - 1].time : "-";
    if (punchOut === punchIn) punchOut = "-";
    return { punchIn, punchOut };
  }

  const collectUntilMs = shiftEndMs + EXIT_AFTER_SHIFT_END_MS;
  const dayPunches = tungstenByTime
    .filter((t) => t.atMs >= entryFromMs && t.atMs <= collectUntilMs)
    .sort((a, b) => a.atMs - b.atMs);
  if (!dayPunches.length) return { punchIn: "-", punchOut: "-" };

  // Very first punch in entry window (early arrival before shift start counts).
  const punchIn = dayPunches[0].time;
  const requireOutAfterShiftEnd = options?.requireOutAfterShiftEnd === true;
  const exitFromMs = requireOutAfterShiftEnd
    ? shiftEndMs
    : shiftEndMs - EXIT_BEFORE_SHIFT_END_MS;
  const exitCandidates = dayPunches.filter(
    (t) => t.atMs >= exitFromMs && t.atMs !== dayPunches[0].atMs,
  );
  let punchOut = "-";
  if (exitCandidates.length) {
    punchOut = exitCandidates[exitCandidates.length - 1].time;
  } else if (!requireOutAfterShiftEnd && dayPunches.length > 1) {
    punchOut = dayPunches[dayPunches.length - 1].time;
  }
  if (punchOut === punchIn) punchOut = "-";
  return { punchIn, punchOut };
}

function punchesInShiftWindow(
  tungstenByTime: TungstenEvent[],
  sessionDate: string,
  shift?: ShiftDayTiming | null,
): TungstenEvent[] {
  if (!shift?.startTime || !shift?.endTime) {
    return [...tungstenByTime.filter((t) => t.date === sessionDate)].sort((a, b) => a.atMs - b.atMs);
  }
  const shiftStartMs = wallClockToEpochMs(sessionDate, shift.startTime);
  const shiftEndMs = computeShiftEndEpochMs(
    {
      start_time: shift.startTime,
      end_time: shift.endTime,
      assigned_date: sessionDate,
    },
    sessionDate,
  );
  if (shiftStartMs == null || shiftEndMs == null) {
    return [...tungstenByTime.filter((t) => t.date === sessionDate)].sort((a, b) => a.atMs - b.atMs);
  }
  const crossesMidnight = shiftEndMs <= shiftStartMs;
  const entryFromMs = entryFloorMsForShiftDay(
    sessionDate,
    shiftStartMs,
    crossesMidnight,
  );
  const collectUntilMs = shiftEndMs + EXIT_AFTER_SHIFT_END_MS;
  return tungstenByTime
    .filter((t) => t.atMs >= entryFromMs && t.atMs <= collectUntilMs)
    .sort((a, b) => a.atMs - b.atMs);
}

function appendZkOnlyDaySessions(
  sessions: EmployeeReportSession[],
  tungstenByTime: TungstenEvent[],
  zkDateFrom: string,
  zkDateTo: string,
  resolveShift?: EmployeeShiftResolver,
): EmployeeReportSession[] {
  const coveredDates = new Set(sessions.map((s) => s.sessionDate));
  const punchDates = new Set(tungstenByTime.map((t) => t.date));
  const extra: EmployeeReportSession[] = [];

  // Punches already claimed as a prior session's T.Punch Out (by wall time string + nearby ms)
  const claimedOutTimes = new Set(
    sessions
      .map((s) => String(s.tungstenPunchOut || "").trim())
      .filter((t) => t && t !== "-"),
  );

  for (const date of punchDates) {
    if (date < zkDateFrom || date > zkDateTo) continue;
    if (coveredDates.has(date)) continue;

    // Overnight carry: punches on this calendar morning that belong to previous shift day
    // must NOT become a new "T.Punch In" row (e.g. Fri 1:02 AM closing Thu open session).
    const prevDate = addDaysToDateKey(date, -1);
    const prevSession = sessions.find((s) => s.sessionDate === prevDate);
    const prevShift = resolveShift?.(prevDate) ?? null;
    if (prevSession && prevShift?.startTime && prevShift?.endTime) {
      const start = parseShiftTimeToHms(prevShift.startTime);
      const end = parseShiftTimeToHms(prevShift.endTime);
      const overnight =
        !!start &&
        !!end &&
        end.h * 60 + end.m <= start.h * 60 + start.m;
      if (overnight) {
        const prevEndMs = computeShiftEndEpochMs(
          {
            start_time: prevShift.startTime,
            end_time: prevShift.endTime,
            assigned_date: prevDate,
          },
          prevDate,
        );
        if (prevEndMs != null) {
          const windowEnd = prevEndMs + EXIT_AFTER_SHIFT_END_MS;
          const dayPunches = tungstenByTime.filter((t) => t.date === date);
          const allCarryOver =
            dayPunches.length > 0 &&
            dayPunches.every((t) => t.atMs <= windowEnd);
          if (allCarryOver) continue;
        }
      }
    }

    // Also skip if the only punch times were already used as someone else's Out
    const dayPunchTimes = tungstenByTime
      .filter((t) => t.date === date)
      .map((t) => t.time);
    if (
      dayPunchTimes.length > 0 &&
      dayPunchTimes.every((t) => claimedOutTimes.has(t))
    ) {
      continue;
    }

    const shiftForDay = resolveShift?.(date) ?? null;
    const { punchIn, punchOut } = firstLastPunchForShiftDay(
      tungstenByTime,
      date,
      shiftForDay,
      // Overnight: last punch through next morning (same as admin midnight logic).
      shiftForDay
        ? { requireOutAfterShiftEnd: false, lastAnyPunchInSpan: true }
        : undefined,
    );
    if (punchIn === "-" && punchOut === "-") continue;
    // Don't invent a Friday In from a punch already shown as Thursday Out
    if (punchIn !== "-" && claimedOutTimes.has(punchIn) && punchOut === "-") {
      continue;
    }
    extra.push({
      sessionDate: date,
      tungstenPunchIn: punchIn,
      hrmClockIn: "-",
      hrmClockOut: "-",
      tungstenPunchOut: punchOut,
    });
  }

  if (!extra.length) return sessions;
  return [...sessions, ...extra].sort((a, b) =>
    a.sessionDate.localeCompare(b.sessionDate),
  );
}

function collectEmployeeTungstenEvents(
  target: EmployeeMatchKeys,
  ctx: TungstenPunchContext,
  zkDateFrom: string,
  zkDateTo: string,
  pinOnly = false,
): TungstenEvent[] {
  const tungsten: TungstenEvent[] = [];
  const knownPins = employeeZkPins(target);
  for (const z of ctx.zkRows) {
    const pin = String(z.pin ?? "").trim();
    if (knownPins.size > 0 || pinOnly) {
      if (!punchMatchesEmployeePinOnly(pin, target)) continue;
    } else {
      const { employeeName: zkName } = resolveZkIdentity(
        z,
        ctx.batchPinProfiles,
        ctx.dbPinProfiles,
        ctx.hrmByCode,
      );
      const hrmMatch = resolveHrmPinMatch(ctx, pin);
      const rawName = rawZkNameFromRow(z);
      if (!punchMatchesEmployee(pin, zkName, hrmMatch, target, rawName)) continue;
    }

    const punchMs = parseZkbioDateTimeMs(z);
    if (punchMs == null) continue;
    const eventDate = getDateStringInTimeZone(punchMs, SERVER_TIMEZONE);
    if (eventDate < zkDateFrom || eventDate > zkDateTo) continue;

    tungsten.push({
      atMs: punchMs,
      time: formatPunchTimeFromMs(punchMs),
      date: eventDate,
    });
  }
  return tungsten.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Punch-only employees (no HRM clock in/out): per shift day,
 * T.Punch In = first punch at/after shift start; T.Punch Out = last punch in shift window
 * (overnight exits on next calendar morning count for the previous shift day).
 * Overnight Admin punch-only (Khalid logic): T.Out = last punch until next shift start (noon-capped).
 * Day shifts (e.g. Dawood 2–10, Zahid 11–10): T.Out uses shift-end exit window — not next-day arrivals.
 */
export function buildShiftPunchOnlySessions(
  target: EmployeeMatchKeys,
  ctx: TungstenPunchContext | null,
  dateFrom: string,
  dateTo: string,
  resolveShift: EmployeeShiftResolver,
): EmployeeReportSession[] {
  if (!ctx || !dateFrom || !dateTo) return [];

  const tungsten = collectEmployeeTungstenEvents(
    target,
    ctx,
    addDaysToDateKey(dateFrom, -1),
    addDaysToDateKey(dateTo, 1),
    true, // punch-only rows must stay strict: pin(employee_code) or employee id only
  );

  const empId = String(target.employeeId ?? "").trim();
  const allowLastSpanOut = punchOnlyUsesLastSpanOut(empId);
  const midnightExit = punchOnlyUsesMidnightExitLastOut(empId);

  const sessions: EmployeeReportSession[] = [];
  let day = dateFrom;
  while (day <= dateTo) {
    const shift = resolveShift(day);
    if (shift) {
      // Overnight = end clock <= start clock (crosses midnight). Day shifts use exit window.
      const [sh = 0, sm = 0] = String(shift.startTime).split(":").map(Number);
      const [eh = 0, em = 0] = String(shift.endTime).split(":").map(Number);
      const crossesMidnight = eh * 60 + em <= sh * 60 + sm;
      // Pervaiz: dedicated midnight last-out. Others: Khalid last-span (noon-capped).
      const useMidnightExit = midnightExit && crossesMidnight;
      const lastAnyPunchInSpan =
        !useMidnightExit && allowLastSpanOut && crossesMidnight;

      const { punchIn, punchOut } = firstLastPunchForShiftDay(tungsten, day, shift, {
        // Day shifts: allow exit window from 1h before shift end (not only after end).
        requireOutAfterShiftEnd: false,
        lastAnyPunchInSpan,
        midnightExitLastPunch: useMidnightExit,
      });
      if (punchIn !== "-" || punchOut !== "-") {
        sessions.push({
          sessionDate: day,
          tungstenPunchIn: punchIn,
          hrmClockIn: "-",
          hrmClockOut: "-",
          tungstenPunchOut: punchOut,
        });
      }
    }
    day = addDaysToDateKey(day, 1);
  }
  return sessions;
}

/**
 * T.Punch in: first Tungsten entry of the shift day.
 * T.Punch out: last exit punch for the session (never the day-first arrival).
 */
export function pairTungstenWithSessions(
  hrmIns: HrmEvent[],
  hrmOuts: HrmEvent[],
  tungsten: TungstenEvent[],
  todayKey: string,
  nowMs: number = Date.now(),
  resolveShiftStart?: (sessionDate: string) => string | null | undefined,
): EmployeeReportSession[] {
  const tungstenByTime = [...tungsten].sort((a, b) => a.atMs - b.atMs);
  const arrivalPunchByShiftDay = new Map<string, string>();

  const hrmInsSorted = [...hrmIns].sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  const usedOutIdx = new Set<number>();
  const usedPunchAt = new Set<number>();

  type SessionDraft = EmployeeReportSession & {
    cinMs: number;
    outMs: number | null;
    excludeExitAtMs?: number;
  };

  const drafts: SessionDraft[] = [];

  for (let i = 0; i < hrmInsSorted.length; i += 1) {
    const cin = hrmInsSorted[i];
    const sessionDate = cin.date;
    const cinMs = parseAttendanceDateTimeMs(cin.sortAt) ?? Number.NaN;

    let hrmOut: HrmEvent | null = null;
    let matchedOutIdx = -1;
    for (let j = 0; j < hrmOuts.length; j += 1) {
      if (usedOutIdx.has(j)) continue;
      const outMs = parseAttendanceDateTimeMs(hrmOuts[j].sortAt) ?? Number.NaN;
      if (Number.isNaN(cinMs) || Number.isNaN(outMs)) continue;
      if (outMs >= cinMs && outMs - cinMs <= MAX_SESSION_MS) {
        hrmOut = hrmOuts[j];
        matchedOutIdx = j;
        break;
      }
    }
    if (!hrmOut) {
      let bestIdx = -1;
      let bestOutMs = Number.POSITIVE_INFINITY;
      for (let j = 0; j < hrmOuts.length; j += 1) {
        if (usedOutIdx.has(j)) continue;
        const outMs = parseAttendanceDateTimeMs(hrmOuts[j].sortAt) ?? Number.NaN;
        if (Number.isNaN(cinMs) || Number.isNaN(outMs) || outMs < cinMs) continue;
        if (outMs < bestOutMs) {
          bestOutMs = outMs;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        hrmOut = hrmOuts[bestIdx];
        matchedOutIdx = bestIdx;
      }
    }
    if (matchedOutIdx >= 0) usedOutIdx.add(matchedOutIdx);

    let punchIn = "-";
    let excludeExitAtMs: number | undefined;

    const shiftTiming =
      resolveShift?.(sessionDate) ??
      (resolveShiftStart?.(sessionDate)
        ? {
            startTime: String(resolveShiftStart(sessionDate)),
            endTime: "",
          }
        : null);

    // T.Punch In (shift-day very first punch — not "second"/near clock-in):
    // 1) First arrival in entry window (early before shift, else first at/after start)
    // 2) Else last door punch at/before this Clock In
    // 3) Else first punch in shift window
    {
      const shiftStart =
        shiftTiming?.startTime ?? resolveShiftStart?.(sessionDate) ?? null;
      const shiftEnd = shiftTiming?.endTime || null;
      const cacheKey = `${sessionDate}|${shiftStart ?? ""}|${shiftEnd ?? ""}`;
      let arrival = arrivalPunchByShiftDay.get(cacheKey);
      if (arrival === undefined) {
        const found = firstArrivalPunchForShiftDay(
          tungstenByTime,
          sessionDate,
          shiftStart,
          shiftEnd,
        );
        arrival = found ?? "";
        arrivalPunchByShiftDay.set(cacheKey, arrival);
      }
      if (arrival) {
        const arrivalEvent = tungstenByTime.find(
          (t) => t.time === arrival && !usedPunchAt.has(t.atMs),
        );
        if (arrivalEvent) {
          punchIn = arrival;
          excludeExitAtMs = arrivalEvent.atMs;
          usedPunchAt.add(arrivalEvent.atMs);
        }
      }
      if (punchIn === "-" && !Number.isNaN(cinMs)) {
        const beforeCin = tungstenByTime.filter(
          (t) =>
            t.atMs <= cinMs &&
            t.atMs >= cinMs - 16 * 60 * 60 * 1000 &&
            !usedPunchAt.has(t.atMs),
        );
        if (beforeCin.length) {
          const pick = beforeCin[beforeCin.length - 1];
          punchIn = pick.time;
          excludeExitAtMs = pick.atMs;
          usedPunchAt.add(pick.atMs);
        }
      }
      if (punchIn === "-" && shiftTiming?.startTime) {
        const inWindow = punchesInShiftWindow(
          tungstenByTime,
          sessionDate,
          shiftTiming,
        ).filter((t) => !usedPunchAt.has(t.atMs));
        if (inWindow.length) {
          punchIn = inWindow[0].time;
          excludeExitAtMs = inWindow[0].atMs;
          usedPunchAt.add(inWindow[0].atMs);
        }
      }
    }

    const outMs =
      hrmOut != null ? parseAttendanceDateTimeMs(hrmOut.sortAt) ?? null : null;

    drafts.push({
      sessionDate,
      tungstenPunchIn: punchIn,
      hrmClockIn: cin.time,
      hrmClockOut: hrmOut ? hrmOut.time : "-",
      tungstenPunchOut: "-",
      cinMs,
      outMs: outMs != null && !Number.isNaN(outMs) ? outMs : null,
      excludeExitAtMs,
    });
  }

  // Newest session picks exit punches first (avoids long session stealing evening punches).
  const exitOrder = [...drafts]
    .filter((d) => d.outMs != null)
    .sort((a, b) => b.cinMs - a.cinMs);

  for (const draft of exitOrder) {
    const shiftEndMs =
      draft.shiftTiming?.startTime && draft.shiftTiming?.endTime
        ? computeShiftEndEpochMs(
            {
              start_time: draft.shiftTiming.startTime,
              end_time: draft.shiftTiming.endTime,
              assigned_date: draft.sessionDate,
            },
            draft.sessionDate,
          )
        : null;
    const startHms = draft.shiftTiming?.startTime
      ? parseShiftTimeToHms(draft.shiftTiming.startTime)
      : null;
    const endHms = draft.shiftTiming?.endTime
      ? parseShiftTimeToHms(draft.shiftTiming.endTime)
      : null;
    const overnight =
      !!startHms &&
      !!endHms &&
      endHms.h * 60 + endHms.m <= startHms.h * 60 + startHms.m;

    // Prefer real HRM clock-out as exit anchor — but if overnight was auto-closed
    // early (mid-shift ~6:46 PM), anchor on shift end so Fri 1:02 AM can match.
    let exitAnchorMs: number | null =
      draft.outMs != null && !Number.isNaN(draft.outMs)
        ? draft.outMs
        : shiftEndMs != null && !Number.isNaN(shiftEndMs)
          ? shiftEndMs
          : null;
    if (
      overnight &&
      shiftEndMs != null &&
      draft.outMs != null &&
      draft.outMs < shiftEndMs - 30 * 60 * 1000
    ) {
      exitAnchorMs = shiftEndMs;
    }
    if (exitAnchorMs == null) continue;

    const { punchOut: last } = firstLastPunchForShiftDay(
      tungstenByTime,
      draft.sessionDate,
      draft.shiftTiming,
      overnight
        ? { requireOutAfterShiftEnd: false, lastAnyPunchInSpan: true }
        : undefined,
    );
    let acceptedShiftOut = false;
    if (last && last !== "-" && last !== draft.tungstenPunchIn) {
      // Reject mid-shift "outs" on overnight when a later punch exists in the exit window
      const lastEv = tungstenByTime.find(
        (t) => t.time === last && t.atMs >= draft.cinMs,
      );
      const lastTooEarly =
        overnight &&
        shiftEndMs != null &&
        lastEv != null &&
        lastEv.atMs < shiftEndMs - 30 * 60 * 1000;
      if (!lastTooEarly) {
        draft.tungstenPunchOut = last;
        acceptedShiftOut = true;
      } else {
        // Prefer last punch at/after shift end (true overnight exit)
        const { punchOut: strictOut } = firstLastPunchForShiftDay(
          tungstenByTime,
          draft.sessionDate,
          draft.shiftTiming,
          { requireOutAfterShiftEnd: true },
        );
        if (
          strictOut &&
          strictOut !== "-" &&
          strictOut !== draft.tungstenPunchIn
        ) {
          draft.tungstenPunchOut = strictOut;
          acceptedShiftOut = true;
        }
      }
    }
    if (acceptedShiftOut) continue;

    const lastPunch = assignSessionPunchOut(
      tungstenByTime,
      draft.sessionDate,
      draft.cinMs,
      draft.outMs as number,
      nowMs,
      usedPunchAt,
      draft.excludeExitAtMs,
    );
    if (last) draft.tungstenPunchOut = last;
  }

  return drafts.map(({ cinMs: _c, outMs: _o, excludeExitAtMs: _e, ...session }) => session);
}

export function buildEmployeeReportSessions(
  employeeName: string,
  attendanceRecords: {
    clock_in?: string | null;
    clock_out?: string | null;
    shift_start_time?: string | null;
  }[],
  ctx: TungstenPunchContext | null,
  todayKey: string,
  nowMs: number = Date.now(),
  zkDateFrom?: string,
  zkDateTo?: string,
  resolveShift?: EmployeeShiftResolver,
  /**
   * When true, invent T.Punch rows for days with ZK punches but no HRM clock-in
   * (forgot clock-in). Status still comes from HRM only — this only fills T.Punch
   * first/last per shift (including midnight). Monthly Attendance enables for all.
   */
  includeZkOnlyDays: boolean = false,
): EmployeeReportSession[] {
  const shiftStartByDate = new Map<string, string>();
  for (const a of attendanceRecords) {
    if (!a.shift_start_time || !a.clock_in) continue;
    const dk = getDateStringInTimeZone(new Date(String(a.clock_in)), SERVER_TIMEZONE);
    if (dk && !shiftStartByDate.has(dk)) {
      shiftStartByDate.set(dk, String(a.shift_start_time));
    }
  }

  const merged: InternalRow[] = [];

  for (const a of attendanceRecords) {
    if (a.clock_in) {
      const r = rowFromIso("H", String(a.clock_in), "Clock In");
      if (r) merged.push(r);
    }
    if (a.clock_out) {
      const r = rowFromIso("H", String(a.clock_out), "Clock Out");
      if (r) merged.push(r);
    }
  }

  if (ctx) {
    const from = zkDateFrom || "0000-01-01";
    const to = zkDateTo || "9999-12-31";
    appendTungstenRows(merged, employeeName, ctx, from, to);
  }

  merged.sort((a, b) => a.sortAt.localeCompare(b.sortAt));

  const hrmIns: HrmEvent[] = [];
  const hrmOuts: HrmEvent[] = [];
  const tungsten: TungstenEvent[] = [];

  for (const r of merged) {
    if (r.source === "H") {
      if (r.detail === "Clock In") {
        hrmIns.push({ sortAt: r.sortAt, date: r.date, time: r.time });
      } else {
        hrmOuts.push({ sortAt: r.sortAt, date: r.date, time: r.time });
      }
    } else {
      const atMs = parseAttendanceDateTimeMs(r.sortAt);
      if (atMs != null) {
        tungsten.push({ atMs, time: r.time, date: r.date });
      }
    }
  }

  return pairTungstenWithSessions(
    hrmIns,
    hrmOuts,
    tungsten,
    todayKey,
    nowMs,
    (sessionDate) => getShift(sessionDate)?.startTime ?? null,
    (sessionDate) => getShift(sessionDate),
  );

  // When false: T.Punch only beside real Clock In sessions.
  // When true: also show ZK-only days (no HRM clock-in) — display only, not status.
  if (!includeZkOnlyDays) return paired;

  const from = zkDateFrom || "0000-01-01";
  const to = zkDateTo || "9999-12-31";
  return appendZkOnlyDaySessions(paired, tungsten, from, to, (sessionDate) =>
    getShift(sessionDate),
  );
}

export function monthlyDash(value: string) {
  return value === "-" || value === "" ? "---" : value;
}
