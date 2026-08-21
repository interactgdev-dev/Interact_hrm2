import { parseAttendanceDateTimeMs } from "./shift-timing";
import { parseZkbioDateTimeMs } from "./zkbio-time";
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

/** HRM: UTC wall in DB. Tungsten/ZKBio: Asia/Karachi wall (see parseZkbioDateTimeMs). */
function rowFromIso(source: "H" | "T", iso: string, detail: string): InternalRow | null {
  const ms =
    source === "T" ? parseZkbioDateTimeMs(iso) : parseAttendanceDateTimeMs(iso);
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
    const punchMs = parseZkbioDateTimeMs(raw);
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
 * Arrival thumb for a shift day: skip early-morning punches (overnight carry-over
 * after midnight). Prefer first punch before shift start (aty hoye); else first at/after shift start.
 */
function firstArrivalPunchForShiftDay(
  tungstenByTime: TungstenEvent[],
  sessionDate: string,
  shiftStart: string | null | undefined,
): string | undefined {
  const shiftMs = wallClockToEpochMs(sessionDate, shiftStart || "14:00:00");
  const noonMs = wallClockToEpochMs(sessionDate, "12:00:00");
  if (shiftMs == null || noonMs == null) return undefined;

  const onDay = tungstenByTime.filter((t) => t.date === sessionDate);
  if (!onDay.length) return undefined;

  for (const t of onDay) {
    if (t.atMs < noonMs) continue;
    if (t.atMs < shiftMs) return t.time;
  }
  for (const t of onDay) {
    if (t.atMs >= noonMs && t.atMs >= shiftMs) return t.time;
  }
  return undefined;
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

    const shiftStart = resolveShiftStart?.(sessionDate);
    const cacheKey = `${sessionDate}|${shiftStart ?? ""}`;
    let arrival = arrivalPunchByShiftDay.get(cacheKey);
    if (arrival === undefined) {
      const found = firstArrivalPunchForShiftDay(tungstenByTime, sessionDate, shiftStart);
      arrival = found ?? "";
      arrivalPunchByShiftDay.set(cacheKey, arrival);
    }
    if (arrival) {
      punchIn = arrival;
      const arrivalEvent = tungstenByTime.find(
        (t) => t.date === sessionDate && t.time === arrival,
      );
      if (arrivalEvent) excludeExitAtMs = arrivalEvent.atMs;
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
    const last = assignSessionPunchOut(
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
    (sessionDate) => shiftStartByDate.get(sessionDate) ?? null,
  );
}

export function monthlyDash(value: string) {
  return value === "-" || value === "" ? "---" : value;
}
