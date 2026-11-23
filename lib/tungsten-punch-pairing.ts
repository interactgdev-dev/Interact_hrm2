import { computeShiftEndEpochMs, parseAttendanceDateTimeMs, wallClockToEpochMs } from "./shift-timing";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "./timezone";
import { parseZkbioDateTimeMs } from "./zkbio-time";
import {
  buildPinProfilesFromRows,
  hrmMapFromEmployees,
  hrmIdMapFromEmployees,
  profileMapsFromApi,
  resolveZkIdentity,
  type HrmCodeProfile,
  type PinProfile,
} from "./zkbio-employee-resolve";
import {
  PUNCH_ONLY_MIDNIGHT_EXIT_MORNING_CAP,
  punchOnlyUsesLastSpanOut,
  punchOnlyUsesMidnightExitLastOut,
} from "./punch-only-employees";

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
  hrmById: Map<string, HrmCodeProfile>;
  hrmEmployees: HrmEmployeeRef[];
};

export type HrmEmployeeRef = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  pseudonym: string;
  gender: string;
  /** hrm_employees.status — active | inactive | … */
  status: string;
};

/**
 * Match Tungsten punches to an HRM employee.
 * Priority: PIN / employee_code / id → then name + department (+ pseudonym).
 * Same legal name (e.g. two "Muhammad Bilal") must not share punches across depts.
 */
export type EmployeeMatchKeys = {
  employeeName: string;
  employeeCode?: string | null;
  employeeId?: string | null;
  pseudonym?: string | null;
  departmentName?: string | null;
};

export type ShiftDayTiming = {
  startTime: string;
  endTime: string;
};

export type EmployeeShiftResolver = (
  sessionDate: string,
) => ShiftDayTiming | null | undefined;

function resolveHrmPinMatch(ctx: TungstenPunchContext, pin: string) {
  if (!pin) return undefined;
  return ctx.hrmByCode.get(pin) || ctx.hrmById.get(pin);
}

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

function rawZkNameFromRow(z: Record<string, unknown>) {
  const first = String(z.first_name ?? "").trim();
  const last = String(z.last_name ?? "").trim();
  return `${first} ${last}`.trim();
}

function formatPunchTimeFromMs(ms: number) {
  return getTimeStringInTimeZone(new Date(ms), SERVER_TIMEZONE);
}

/** PIN match, exact name, or partial name (e.g. Tungsten "Zahid Ali" vs HRM "Zahid Ali Parviz"). */
function namesLooselyMatch(a: string, b: string) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // "NA" must not match "Naveed" / "Hussain" via 2-letter substring.
  if (na.length < 3 || nb.length < 3) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(" ").filter((t) => t.length >= 3);
  const tb = nb.split(" ").filter((t) => t.length >= 3);
  if (ta.length >= 2 && tb.length >= 2) {
    const shared = tb.filter((t) => ta.includes(t)).length;
    if (shared >= 2) return true;
    if (ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]) return true;
  }
  return false;
}

function normalizeDeptKey(value: string | null | undefined) {
  return normalizeName(String(value || "")).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** HRM "Production I (HIT)" vs ZK "Production I" / "HIT" — must agree enough to disambiguate. */
export function departmentsLooselyMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeDeptKey(a);
  const nb = normalizeDeptKey(b);
  if (!na || !nb || na === "-" || nb === "-") return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(" ").filter((t) => t.length >= 2);
  const tb = nb.split(" ").filter((t) => t.length >= 2);
  if (!ta.length || !tb.length) return false;
  const shared = tb.filter((t) => ta.includes(t));
  if (shared.some((t) => t.length >= 4)) return true;
  return shared.length >= 2;
}

function countLegalNamePeers(
  ctx: TungstenPunchContext | null | undefined,
  legalName: string,
): number {
  if (!ctx?.hrmEmployees?.length) return 0;
  let n = 0;
  for (const e of ctx.hrmEmployees) {
    if (namesLooselyMatch(e.employeeName, legalName)) n += 1;
  }
  return n;
}

/**
 * Attach a ZK punch to an HRM employee only when identity is strong:
 * 1) PIN === employee_code or PIN === employee id
 * 2) PIN registered in HRM to this same employee id
 * 3) Else name match ONLY with department agreement; never steal another employee's PIN
 */
export function punchMatchesEmployee(
  pin: string,
  zkResolvedName: string,
  hrmPinMatch: HrmCodeProfile | undefined,
  target: EmployeeMatchKeys,
  rawZkRowName?: string,
  zkDepartment?: string,
  ctx?: TungstenPunchContext | null,
): boolean {
  const empId = String(target.employeeId ?? "").trim();
  const code = String(target.employeeCode ?? "").trim();
  const targetDept = String(target.departmentName ?? "").trim();
  const zkDept = String(zkDepartment || hrmPinMatch?.department || "").trim();

  // PIN owned by this employee in HRM maps (strongest after explicit code).
  if (hrmPinMatch?.employeeId && empId && hrmPinMatch.employeeId === empId) {
    return true;
  }

  // Strict PIN / employee_code / id-as-pin.
  if (code) {
    if (pin && pin === code) return true;
    if (empId && pin && pin === empId) return true;
    return false;
  }
  if (empId && pin && pin === empId) return true;

  // This device PIN belongs to a *different* HRM employee — never name-match onto target
  // (fixes Muhammad Bilal Sean getting Anthony Gray's punches when Sean has empty code).
  if (hrmPinMatch?.employeeId && empId && hrmPinMatch.employeeId !== empId) {
    return false;
  }

  const candidates = [
    hrmPinMatch?.employeeName || "",
    zkResolvedName,
    rawZkRowName || "",
  ].filter(Boolean);

  let nameHit = false;
  for (const candidate of candidates) {
    if (namesLooselyMatch(target.employeeName, candidate)) {
      nameHit = true;
      break;
    }
    const pseudo = String(target.pseudonym ?? "").trim();
    if (pseudo && pseudo !== "-" && namesLooselyMatch(pseudo, candidate)) {
      nameHit = true;
      break;
    }
  }
  if (!nameHit) return false;

  const peers = countLegalNamePeers(ctx, target.employeeName);
  const deptOk = departmentsLooselyMatch(targetDept, zkDept);

  // Duplicate legal names (2+ Bilals): require department agreement.
  if (peers > 1) {
    return deptOk;
  }

  // Unique name: still prefer dept when both sides have one; allow if ZK dept unknown.
  if (targetDept && zkDept && targetDept !== "-" && zkDept !== "-") {
    return deptOk;
  }
  return true;
}

/**
 * Device PINs we trust without name matching.
 * Only when employee_code is set — otherwise callers fall back to name match
 * (empty codes on staging must not block all T.Punch).
 */
export function employeeZkPins(target: EmployeeMatchKeys): Set<string> {
  const pins = new Set<string>();
  const code = String(target.employeeCode ?? "").trim();
  const empId = String(target.employeeId ?? "").trim();
  if (!code) return pins;
  pins.add(code);
  if (empId) pins.add(empId);
  return pins;
}

export function punchMatchesEmployeePinOnly(
  pin: string,
  target: EmployeeMatchKeys,
): boolean {
  if (!pin) return false;
  return employeeZkPins(target).has(pin);
}

export function employeeHasZkPunchesInRange(
  ctx: TungstenPunchContext,
  target: EmployeeMatchKeys,
  dateFrom: string,
  dateTo: string,
): boolean {
  for (const z of ctx.zkRows) {
    const pin = String(z.pin ?? "").trim();
    const knownPins = employeeZkPins(target);
    if (knownPins.size > 0) {
      if (!knownPins.has(pin)) continue;
    } else {
      const { employeeName: zkName, department: zkDept } = resolveZkIdentity(
        z,
        ctx.batchPinProfiles,
        ctx.dbPinProfiles,
        ctx.hrmByCode,
      );
      const hrmMatch = resolveHrmPinMatch(ctx, pin);
      const rawName = rawZkNameFromRow(z);
      if (
        !punchMatchesEmployee(
          pin,
          zkName,
          hrmMatch,
          target,
          rawName,
          zkDept,
          ctx,
        )
      ) {
        continue;
      }
    }

    const rawVal = z.event_time ?? z.imported_at;
    if (rawVal == null || rawVal === "") continue;
    const punchMs = parseZkbioDateTimeMs(z);
    if (punchMs == null) continue;
    const eventDate = getDateStringInTimeZone(punchMs, SERVER_TIMEZONE);
    if (eventDate < dateFrom || eventDate > dateTo) continue;
    return true;
  }
  return false;
}

export function hrmEmployeesFromList(
  employees: {
    id?: string | number;
    first_name?: string;
    last_name?: string;
    employee_code?: string | null;
    department_name?: string | null;
    pseudonym?: string | null;
    gender?: string | null;
    status?: string | null;
  }[],
): HrmEmployeeRef[] {
  return employees
    .map((e) => {
      const employeeId = e.id != null ? String(e.id) : "";
      if (!employeeId) return null;
      const first = String(e.first_name ?? "").trim();
      const last = String(e.last_name ?? "").trim();
      const employeeName = `${first} ${last}`.trim() || "—";
      return {
        employeeId,
        employeeName,
        employeeCode: String(e.employee_code ?? "").trim(),
        departmentName: String(e.department_name ?? "").trim() || "-",
        pseudonym: String(e.pseudonym ?? "").trim() || "-",
        gender: String(e.gender ?? "").trim(),
        status: String(e.status ?? "").trim(),
      };
    })
    .filter((e): e is HrmEmployeeRef => e != null);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** HRM + ZKBio timestamps — prefer device-local eventTime for Tungsten rows. */
function rowFromIso(source: "H" | "T", isoOrMs: string | number, detail: string): InternalRow | null {
  const ms =
    typeof isoOrMs === "number"
      ? isoOrMs
      : parseAttendanceDateTimeMs(isoOrMs);
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

  const [zkResult, empListRes] = await Promise.all([
    fetchAllZkRows(zkParams),
    fetch("/api/employee-list"),
  ]);

  // Skip /api/zkbio-pin-profiles — full dump is multi‑MB and stalls Monthly Attendance.
  // Month-window rows already feed batchPinProfiles for identity backfill.
  const empListData = await empListRes.json();

  return {
    zkRows: zkResult.rows,
    batchPinProfiles: buildPinProfilesFromRows(zkResult.rows),
    dbPinProfiles: new Map(),
    hrmByCode:
      empListData.success && empListData.employees
        ? hrmMapFromEmployees(empListData.employees)
        : new Map(),
    hrmById:
      empListData.success && empListData.employees
        ? hrmIdMapFromEmployees(empListData.employees)
        : new Map(),
    hrmEmployees:
      empListData.success && empListData.employees
        ? hrmEmployeesFromList(empListData.employees)
        : [],
  };
}

function appendTungstenRows(
  merged: InternalRow[],
  target: EmployeeMatchKeys,
  ctx: TungstenPunchContext,
  zkDateFrom: string,
  zkDateTo: string,
) {
  for (const z of ctx.zkRows) {
    const pin = String(z.pin ?? "").trim();
    const knownPins = employeeZkPins(target);
    if (knownPins.size > 0) {
      if (!knownPins.has(pin)) continue;
    } else {
      const { employeeName: zkName, department: zkDept } = resolveZkIdentity(
        z,
        ctx.batchPinProfiles,
        ctx.dbPinProfiles,
        ctx.hrmByCode,
      );
      const hrmMatch = resolveHrmPinMatch(ctx, pin);
      const rawName = rawZkNameFromRow(z);
      if (
        !punchMatchesEmployee(
          pin,
          zkName,
          hrmMatch,
          target,
          rawName,
          zkDept,
          ctx,
        )
      ) {
        continue;
      }
    }

    const rawVal = z.event_time ?? z.imported_at;
    if (rawVal == null || rawVal === "") continue;
    const punchMs = parseZkbioDateTimeMs(z);
    if (punchMs == null) continue;
    const eventDate = getDateStringInTimeZone(punchMs, SERVER_TIMEZONE);
    if (eventDate < zkDateFrom || eventDate > zkDateTo) continue;

    const reader = String(z.reader_name || "").trim() || "-";
    const event = String(z.event_name || "").trim() || "Punch";
    const r = rowFromIso("T", punchMs, `${reader} — ${event}`);
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
 * 3) Else last punch after clock-out through shift-end window / session max
 *    (overnight: next-calendar-morning outs count — not same-day locked)
 */
function assignSessionPunchOut(
  tungstenByTime: TungstenEvent[],
  sessionDate: string,
  cinMs: number,
  outMs: number,
  nowMs: number,
  usedPunchAt: Set<number>,
  excludeExitAtMs?: number,
  shiftEndMs?: number | null,
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

  // Overnight / late ZK: allow next-calendar-day punches through shift end + grace
  // (do NOT lock to sessionDate — Fri 1:02 AM must close Thu open session).
  const lateSearchEnd = Math.min(
    nowMs,
    Math.max(
      outMs + 12 * 60 * 60 * 1000,
      shiftEndMs != null && Number.isFinite(shiftEndMs)
        ? shiftEndMs + EXIT_AFTER_SHIFT_END_MS
        : outMs + TUNGSTEN_AFTER_CLOCK_GRACE_MS,
      cinMs + MAX_SESSION_MS,
    ),
  );
  const lateExit = tungstenByTime.filter(
    (t) =>
      isExitCandidate(t, cinMs, usedPunchAt, excludeExitAtMs) &&
      t.atMs > outMs &&
      t.atMs <= lateSearchEnd,
  );
  if (lateExit.length) {
    const pick = lateExit[lateExit.length - 1];
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
      const { employeeName: zkName, department: zkDept } = resolveZkIdentity(
        z,
        ctx.batchPinProfiles,
        ctx.dbPinProfiles,
        ctx.hrmByCode,
      );
      const hrmMatch = resolveHrmPinMatch(ctx, pin);
      const rawName = rawZkNameFromRow(z);
      if (
        !punchMatchesEmployee(
          pin,
          zkName,
          hrmMatch,
          target,
          rawName,
          zkDept,
          ctx,
        )
      ) {
        continue;
      }
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
  resolveShift?: EmployeeShiftResolver,
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
    shiftTiming?: ShiftDayTiming | null;
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
      shiftTiming: shiftTiming?.endTime ? shiftTiming : null,
    });
  }

  // Newest session picks exit punches first (avoids long session stealing evening punches).
  const exitOrder = [...drafts]
    .filter((d) => d.outMs != null || d.shiftTiming?.endTime)
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
      exitAnchorMs,
      nowMs,
      usedPunchAt,
      draft.excludeExitAtMs,
      shiftEndMs,
    );
    if (lastPunch) draft.tungstenPunchOut = lastPunch;
  }

  return drafts.map(({ cinMs: _c, outMs: _o, excludeExitAtMs: _e, shiftTiming: _s, ...session }) => session);
}

export function buildEmployeeReportSessions(
  target: EmployeeMatchKeys | string,
  attendanceRecords: {
    clock_in?: string | null;
    clock_out?: string | null;
    shift_start_time?: string | null;
    shift_end_time?: string | null;
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
  const match: EmployeeMatchKeys =
    typeof target === "string" ? { employeeName: target } : target;
  const shiftTimingByDate = new Map<string, ShiftDayTiming>();
  for (const a of attendanceRecords) {
    if (!a.shift_start_time || !a.shift_end_time || !a.clock_in) continue;
    const dk = getDateStringInTimeZone(new Date(String(a.clock_in)), SERVER_TIMEZONE);
    if (dk && !shiftTimingByDate.has(dk)) {
      shiftTimingByDate.set(dk, {
        startTime: String(a.shift_start_time),
        endTime: String(a.shift_end_time),
      });
    }
  }

  const getShift = (sessionDate: string): ShiftDayTiming | null =>
    shiftTimingByDate.get(sessionDate) ?? resolveShift?.(sessionDate) ?? null;

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
    appendTungstenRows(merged, match, ctx, from, to);
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

  const paired = pairTungstenWithSessions(
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
