import * as XLSX from "xlsx";
import { normalizeAttendanceStatus, uiStatusTextColor } from "./attendance-status";
import {
  applyImportedAbsentIfShortShift,
  computeClockInLateStatus,
  defaultHrShiftTiming,
  importedDeductionForFiveHourShift,
  importedDeductionForStatus,
  isEmptyClockDisplay,
  isFiveHourAssignedShift,
  isLatePastHalfDayThreshold,
  lateCountsForStatus,
  parseDisplayClockToIso,
  parseHmDurationToSeconds,
  resolveImportedDayStatus,
  shiftSecondsFromAssignedWH,
  STATUS_FIRST_HALF_DAY,
  totalDeductionPercentForFiveHourDays,
  workedSecondsBetween,
} from "./monthly-attendance-status";

/** Accidental double-tap / duplicate punch (e.g. in & out 4 sec apart, 00h 00m). */
const GLITCH_PUNCH_MAX_SECONDS = 5 * 60;

export type ImportedMonthlyDay = {
  dateKey: string;
  weekday: string;
  dateDisplay: string;
  tPunchIn?: string;
  tPunchOut?: string;
  clockIn: string;
  clockOut: string;
  totalWH: string;
  assignedWH: string;
  overtime: string;
  tardyCount: string;
  status: string;
  /** Original Excel values (never recalculated on display). */
  sheetStatus?: string;
  sheetTardyCount?: string;
  sheetDeduction?: string;
  deduction: string;
  statusColor: string;
};

export type ImportedMonthlyEmployee = {
  employeeId: string;
  employeeName: string;
  pseudonym: string;
  departmentName: string;
  /** Parsed from sheet header or inferred from on-time clock-ins + assigned W.H. */
  shiftStart?: string;
  shiftEnd?: string;
  days: ImportedMonthlyDay[];
  footer?: {
    totalDeduction: string;
    extraHours: string;
    workingDays: string;
  };
};

export type ImportedMonthlySnapshot = {
  month: string;
  employees: ImportedMonthlyEmployee[];
  /** Bumped when HR sheet rules change — triggers re-apply on load. */
  rulesVersion?: number;
};

const STORAGE_PREFIX = "monthly-attendance-import:";
const STORAGE_RULES_VERSION = 8;

export function importedEmployeeUsesFiveHourShift(days: ImportedMonthlyDay[]): boolean {
  const sample = days.find((d) => shiftSecondsFromAssignedWH(d.assignedWH) >= 4.5 * 3600);
  return sample ? isFiveHourAssignedShift(sample.assignedWH) : false;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const m = value.getMonth() + 1;
    const d = value.getDate();
    const y = value.getFullYear();
    return `${m}/${d}/${y}`;
  }
  return String(value).trim();
}

function secondsToHmDisplay(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "---";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

/** Excel time serial (fraction of day) → seconds. */
function excelTimeSerialToSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  const fraction = value >= 1 ? value % 1 : value;
  return Math.round(fraction * 24 * 3600);
}

/** Clock in/out from Excel (serial, Date, or text). */
export function formatExcelClockCell(value: unknown): string {
  if (value == null || String(value).trim() === "") return "---";
  if (typeof value === "number" && Number.isFinite(value)) {
    const sec = excelTimeSerialToSeconds(value);
    const h24 = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const period = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} ${period}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h24 = value.getHours();
    const m = value.getMinutes();
    const s = value.getSeconds();
    const period = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} ${period}`;
  }
  const raw = String(value).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return "---";
  return raw || "---";
}

/** Total W.H / Assigned W.H / Overtime from Excel. */
export function formatExcelDurationCell(value: unknown): string {
  if (value == null || String(value).trim() === "") return "---";
  if (typeof value === "number" && Number.isFinite(value)) {
    return secondsToHmDisplay(excelTimeSerialToSeconds(value));
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const sec = value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds();
    return secondsToHmDisplay(sec);
  }
  const raw = String(value).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return "---";
  return raw || "---";
}

function parseExportDate(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const raw = String(value).trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function formatDateDisplay(dateKey: string, fallback: string) {
  if (fallback && fallback !== "---") return fallback;
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return fallback || "-";
  return `${m}/${d}/${y}`;
}


function parseSummaryRow(row: unknown[]) {
  for (let i = 0; i < row.length; i++) {
    const label = cellStr(row[i]).toLowerCase();
    const value = cellStr(row[i + 1] ?? row[row.length - 1]);
    if (label.includes("total deduction")) return { kind: "deduction" as const, value };
    if (label.includes("extra hours")) return { kind: "extra" as const, value };
    if (label.includes("total working days")) return { kind: "working" as const, value };
  }
  return null;
}

function findHeaderIndex(rows: unknown[][]) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const headers = (rows[i] || []).map((c) => normalizeHeader(c));
    if (headers.includes("day") && headers.includes("date")) {
      return i;
    }
  }
  return -1;
}

function colIndex(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    const idx = headers.indexOf(normalizeHeader(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseClockToken(raw: string): string | null {
  const t = String(raw || "").trim();
  if (!t || t === "---") return null;
  const match = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || "0");
  const ampm = (match[4] || "").toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function minutesToShiftHms(totalMinutes: number): string {
  let mins = totalMinutes;
  while (mins < 0) mins += 24 * 60;
  while (mins >= 24 * 60) mins -= 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function parseSheetShiftTiming(rows: unknown[][], headerRowIndex: number): { start: string; end: string } | null {
  for (let i = 0; i < headerRowIndex; i++) {
    const row = rows[i] || [];

    for (let c = 0; c < row.length; c++) {
      const label = cellStr(row[c]).toLowerCase();
      const value = cellStr(row[c + 1]);
      if (!value) continue;

      if (label.includes("shift start") || label.includes("start time") || label === "from") {
        const start = parseClockToken(value);
        for (let j = c + 1; j < row.length - 1; j++) {
          const label2 = cellStr(row[j]).toLowerCase();
          const value2 = cellStr(row[j + 1]);
          if (label2.includes("shift end") || label2.includes("end time") || label2 === "to") {
            const end = parseClockToken(value2);
            if (start && end) return { start, end };
          }
        }
      }
    }

    const joined = row.map((cell) => cellStr(cell)).join(" ");
    const range = joined.match(
      /(?:shift\s*)?(?:timing|time|hours)?[:\s-]*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*(?:-|–|to)\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i,
    );
    if (range) {
      const start = parseClockToken(range[1]);
      const end = parseClockToken(range[2]);
      if (start && end) return { start, end };
    }
  }
  return null;
}

function workedSecondsForImportedDay(day: ImportedMonthlyDay): number {
  const fromSheet = parseHmDurationToSeconds(day.totalWH);
  const clockInIso = parseDisplayClockToIso(day.dateKey, day.clockIn, 0);
  let clockOutAddDays = 0;
  if (!isEmptyClockDisplay(day.clockIn) && !isEmptyClockDisplay(day.clockOut)) {
    const outSame = parseDisplayClockToIso(day.dateKey, day.clockOut, 0);
    if (clockInIso && outSame && new Date(outSame).getTime() <= new Date(clockInIso).getTime()) {
      clockOutAddDays = 1;
    }
    if (/PM/i.test(String(day.clockIn)) && /AM/i.test(String(day.clockOut))) {
      clockOutAddDays = 1;
    }
  }
  const clockOutIso = parseDisplayClockToIso(day.dateKey, day.clockOut, clockOutAddDays);
  return Math.max(fromSheet, workedSecondsBetween(clockInIso, clockOutIso));
}

export function isGlitchOrDuplicateImportedDay(day: ImportedMonthlyDay): boolean {
  if (isEmptyClockDisplay(day.clockIn) || isEmptyClockDisplay(day.clockOut)) return false;
  const worked = workedSecondsForImportedDay(day);
  return worked < GLITCH_PUNCH_MAX_SECONDS;
}

/** Drop scanner glitches; one row per date (keep longest work). */
export function sanitizeImportedEmployeeDays(days: ImportedMonthlyDay[]): ImportedMonthlyDay[] {
  const kept = days.filter((d) => !isGlitchOrDuplicateImportedDay(d));
  const byDate = new Map<string, ImportedMonthlyDay>();

  kept.forEach((day) => {
    const existing = byDate.get(day.dateKey);
    if (!existing) {
      byDate.set(day.dateKey, day);
      return;
    }
    if (workedSecondsForImportedDay(day) > workedSecondsForImportedDay(existing)) {
      byDate.set(day.dateKey, day);
    }
  });

  return Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function inferShiftTimingFromSheet(days: ImportedMonthlyDay[]): { start: string; end: string } | null {
  const onTimeMinutes: number[] = [];

  days.forEach((day) => {
    const sheetStatus = normalizeAttendanceStatus(day.sheetStatus ?? day.status ?? "");
    if (sheetStatus !== "On Time") return;
    if (isEmptyClockDisplay(day.clockIn)) return;
    const parsed = parseClockToken(day.clockIn);
    if (!parsed) return;
    const [h, m] = parsed.split(":").map(Number);
    onTimeMinutes.push(h * 60 + m);
  });

  if (onTimeMinutes.length < 2) return null;

  onTimeMinutes.sort((a, b) => a - b);
  const median = onTimeMinutes[Math.floor(onTimeMinutes.length / 2)];
  const startMin = Math.round(median / 30) * 30;

  const sampleAssigned =
    days.find((d) => parseHmDurationToSeconds(d.assignedWH) > 0)?.assignedWH ?? days[0]?.assignedWH;
  const shiftSeconds = shiftSecondsFromAssignedWH(sampleAssigned);
  let endMin = startMin + Math.round(shiftSeconds / 60);
  while (endMin >= 24 * 60) endMin -= 24 * 60;

  return { start: minutesToShiftHms(startMin), end: minutesToShiftHms(endMin) };
}

function parseSheet(sheetName: string, sheet: XLSX.WorkSheet): ImportedMonthlyEmployee | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }) as unknown[][];
  const headerRowIndex = findHeaderIndex(rows);
  if (headerRowIndex < 0) return null;

  const headers = (rows[headerRowIndex] || []).map((c) => normalizeHeader(c));
  const iDay = colIndex(headers, ["day"]);
  const iDate = colIndex(headers, ["date"]);
  const iTPIn = colIndex(headers, ["t.punch in", "t punch in", "tungsten punch in"]);
  const iIn = colIndex(headers, ["clock in", "clock_in"]);
  const iOut = colIndex(headers, ["clock out", "clock_out"]);
  const iTPOut = colIndex(headers, ["t.punch out", "t punch out", "tungsten punch out"]);
  const iTotal = colIndex(headers, ["total w.h", "total wh", "total hours"]);
  const iAssigned = colIndex(headers, ["assigned w.h", "assigned wh"]);
  const iOt = colIndex(headers, ["overtime", "over time"]);
  const iTardy = colIndex(headers, ["tardy count", "tardy"]);
  const iStatus = colIndex(headers, ["status"]);
  const iDed = colIndex(headers, ["deduction"]);

  const days: ImportedMonthlyDay[] = [];
  const footer = { totalDeduction: "", extraHours: "", workingDays: "" };

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const summary = parseSummaryRow(row);
    if (summary) {
      if (summary.kind === "deduction") footer.totalDeduction = summary.value.replace(/%$/, "") || summary.value;
      if (summary.kind === "extra") footer.extraHours = summary.value;
      if (summary.kind === "working") footer.workingDays = summary.value;
      continue;
    }

    const first = cellStr(row[0]);
    if (!first && !cellStr(row[iDate >= 0 ? iDate : 1])) continue;

    const dateRaw = iDate >= 0 ? row[iDate] : row[1];
    const dateKey = parseExportDate(dateRaw);
    if (!dateKey) continue;

    const statusRaw = iStatus >= 0 ? cellStr(row[iStatus]) : "";
    const status = normalizeAttendanceStatus(statusRaw || (days.length ? "On Time" : ""));
    const deduction = iDed >= 0 ? cellStr(row[iDed]) : "";
    const tardyRaw = iTardy >= 0 ? cellStr(row[iTardy]) : "";

    days.push({
      dateKey,
      weekday: iDay >= 0 ? cellStr(row[iDay]) : "",
      dateDisplay: formatDateDisplay(dateKey, cellStr(dateRaw)),
      tPunchIn: iTPIn >= 0 ? formatExcelClockCell(row[iTPIn]) : "---",
      tPunchOut: iTPOut >= 0 ? formatExcelClockCell(row[iTPOut]) : "---",
      clockIn: iIn >= 0 ? formatExcelClockCell(row[iIn]) : "---",
      clockOut: iOut >= 0 ? formatExcelClockCell(row[iOut]) : "---",
      totalWH: iTotal >= 0 ? formatExcelDurationCell(row[iTotal]) : "---",
      assignedWH: iAssigned >= 0 ? formatExcelDurationCell(row[iAssigned]) : "---",
      overtime: iOt >= 0 ? formatExcelDurationCell(row[iOt]) : "---",
      tardyCount: tardyRaw,
      status,
      sheetStatus: status,
      sheetTardyCount: tardyRaw,
      sheetDeduction: deduction,
      deduction,
      statusColor: uiStatusTextColor(status),
    });
  }

  const cleanDays = sanitizeImportedEmployeeDays(days);
  if (!cleanDays.length) return null;

  const employeeName = sheetName.trim() || "Employee";
  let shift = parseSheetShiftTiming(rows, headerRowIndex);
  if (!shift) shift = defaultHrShiftTiming();

  const employee: ImportedMonthlyEmployee = {
    employeeId: `import-${employeeName.replace(/\s+/g, "-").toLowerCase()}`,
    employeeName,
    pseudonym: "-",
    departmentName: "-",
    shiftStart: shift?.start,
    shiftEnd: shift?.end,
    days: cleanDays,
    footer:
      footer.totalDeduction || footer.extraHours || footer.workingDays ? footer : undefined,
  };

  applyHrRulesDirectlyOnSheet(employee);
  return employee;
}

/** Write Status + Deduction directly on each sheet row (HR rules). */
export function applyHrRulesDirectlyOnSheet(emp: ImportedMonthlyEmployee) {
  const shiftStart = emp.shiftStart ?? null;
  const shiftEnd = emp.shiftEnd ?? null;
  const fiveHourShift = importedEmployeeUsesFiveHourShift(emp.days);
  let runningTardy = 0;

  const sorted = [...emp.days].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  sorted.forEach((day) => {
    if (!fiveHourShift && applyImportedAbsentIfShortShift(day)) {
      day.status = "Absent";
      day.deduction = "100%";
      day.statusColor = uiStatusTextColor("Absent");
      return;
    }

    const statusLabel = resolveImportedDayStatus({
      day,
      shiftStart,
      shiftEnd,
    });
    const sheetDed = day.sheetDeduction ?? day.deduction ?? "";

    day.status = statusLabel;
    if (fiveHourShift) {
      day.deduction = importedDeductionForFiveHourShift(statusLabel);
    } else if (normalizeAttendanceStatus(statusLabel) === "Tardy") {
      runningTardy += 1;
      day.deduction = importedDeductionForStatus(statusLabel, sheetDed, runningTardy);
    } else {
      day.deduction = importedDeductionForStatus(statusLabel, sheetDed, "");
    }
    day.statusColor = uiStatusTextColor(statusLabel);
  });
}

/** Deep-clone snapshot and re-apply HR rules (avoids stale React/localStorage status). */
export function reapplyImportedHrRulesSnapshot(
  snapshot: ImportedMonthlySnapshot,
): ImportedMonthlySnapshot {
  const next = JSON.parse(JSON.stringify(snapshot)) as ImportedMonthlySnapshot;
  next.rulesVersion = STORAGE_RULES_VERSION;
  next.employees.forEach((emp) => {
    const hrShift = defaultHrShiftTiming();
    emp.shiftStart = hrShift.start;
    emp.shiftEnd = hrShift.end;
    emp.days = sanitizeImportedEmployeeDays(emp.days);
    applyHrRulesDirectlyOnSheet(emp);
  });
  return next;
}

export function parseMonthlyAttendanceWorkbook(buffer: ArrayBuffer): ImportedMonthlySnapshot {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const employees: ImportedMonthlyEmployee[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const parsed = parseSheet(sheetName, workbook.Sheets[sheetName]);
    if (parsed) employees.push(parsed);
  });

  let month = "";
  for (const emp of employees) {
    for (const day of emp.days) {
      if (day.dateKey) {
        month = day.dateKey.slice(0, 7);
        break;
      }
    }
    if (month) break;
  }

  employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName, undefined, { sensitivity: "base" }));

  return { month, employees, rulesVersion: STORAGE_RULES_VERSION };
}

export function saveImportedMonthlySnapshot(snapshot: ImportedMonthlySnapshot) {
  if (!snapshot.month || typeof window === "undefined") return;
  localStorage.setItem(`${STORAGE_PREFIX}${snapshot.month}`, JSON.stringify(snapshot));
}

function migrateImportedSnapshot(snapshot: ImportedMonthlySnapshot): ImportedMonthlySnapshot {
  const next = reapplyImportedHrRulesSnapshot(snapshot);
  if (next.month) {
    saveImportedMonthlySnapshot(next);
  }
  return next;
}

/** Status + deduction for UI/Excel — applies 2h–3h15m → Absent even if cache is stale. */
export function getImportedDayDisplayFields(
  day: ImportedMonthlyDay,
  options?: { fiveHourShift?: boolean; runningTardyCount?: number },
): {
  status: string;
  deduction: string;
} {
  const fiveHour = options?.fiveHourShift ?? isFiveHourAssignedShift(day.assignedWH);

  if (!fiveHour && applyImportedAbsentIfShortShift(day)) {
    return { status: "Absent", deduction: "100%" };
  }

  const status = normalizeAttendanceStatus(day.status || "");
  const sheetDed = day.sheetDeduction ?? day.deduction ?? "";
  const tardyForDed =
    options?.runningTardyCount != null
      ? options.runningTardyCount
      : normalizeAttendanceStatus(status) === "Tardy"
        ? day.sheetTardyCount ?? day.tardyCount ?? ""
        : "";
  const deduction = fiveHour
    ? importedDeductionForFiveHourShift(status)
    : importedDeductionForStatus(status, sheetDed, tardyForDed) || sheetDed || "";
  return { status, deduction };
}

/** Tardy count for display/export — blank unless value is a positive running count. */
export function formatImportedRunningLate(
  value: number | string | undefined | null,
): string {
  if (value === 0 || value === "" || value == null) return "";
  return String(value);
}

function excelDayDeduction(day: ImportedMonthlyDay) {
  return day.sheetDeduction ?? day.deduction ?? "";
}

export function loadImportedMonthlySnapshot(month: string): ImportedMonthlySnapshot | null {
  if (!month || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${month}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImportedMonthlySnapshot;
    if (!parsed?.employees?.length) return null;
    return migrateImportedSnapshot(parsed);
  } catch {
    return null;
  }
}

/** Read Status/Deduction already set on sheet rows by applyHrRulesDirectlyOnSheet. */
function buildDateMetaFromImportedDays(
  days: ImportedMonthlyDay[],
  opts?: { shiftStart?: string | null; gender?: string | null },
) {
  const dateMeta: Record<
    string,
    {
      runningLate: number | string;
      statusLabel: string;
      statusColor: string;
      deduction: string;
      lateMinutes?: number;
    }
  > = {};

  const sorted = [...days].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const fiveHourShift = importedEmployeeUsesFiveHourShift(sorted);
  let runningTardy = 0;

  sorted.forEach((day) => {
    let statusLabel: string;
    let deduction: string;
    let runningLate: number | string = "";
    let lateMinutes = 0;

    if (!fiveHourShift && applyImportedAbsentIfShortShift(day)) {
      statusLabel = "Absent";
      deduction = "100%";
    } else {
      statusLabel = normalizeAttendanceStatus(day.status || "");
      const sheetDed = day.sheetDeduction ?? day.deduction ?? "";
      if (fiveHourShift) {
        deduction = importedDeductionForFiveHourShift(statusLabel);
      } else if (normalizeAttendanceStatus(statusLabel) === "Tardy") {
        runningTardy += 1;
        runningLate = runningTardy;
        deduction = importedDeductionForStatus(statusLabel, sheetDed, runningTardy);
      } else {
        deduction = importedDeductionForStatus(statusLabel, sheetDed, "") || sheetDed || "";
      }
    }

    if (!isEmptyClockDisplay(day.clockIn) && opts?.shiftStart) {
      const iso = parseDisplayClockToIso(day.dateKey, day.clockIn, 0);
      if (iso) {
        const late = computeClockInLateStatus(iso, opts.shiftStart, opts.gender);
        if (
          isLatePastHalfDayThreshold(late.lateMinutes) &&
          (statusLabel === "Tardy" || statusLabel === "On Time")
        ) {
          if (statusLabel === "Tardy" && runningTardy > 0) {
            runningTardy -= 1;
          }
          statusLabel = STATUS_FIRST_HALF_DAY;
          deduction = "50%";
          runningLate = "";
        }
        lateMinutes = lateCountsForStatus(statusLabel)
          ? late.excessLateMinutes
          : 0;
      }
    } else {
      lateMinutes = 0;
    }

    dateMeta[day.dateKey] = {
      runningLate,
      statusLabel,
      statusColor: uiStatusTextColor(statusLabel),
      deduction,
      lateMinutes,
    };
  });

  const totalDeduction = fiveHourShift
    ? totalDeductionPercentForFiveHourDays(sorted)
    : sorted.reduce((sum, day) => {
        const ded = dateMeta[day.dateKey]?.deduction;
        return sum + (parseInt(String(ded).replace(/%/g, ""), 10) || 0);
      }, 0);

  return { dateMeta, sorted, totalDeduction };
}

export function importedSnapshotToAttendanceEmployees(snapshot: ImportedMonthlySnapshot) {
  const fresh = reapplyImportedHrRulesSnapshot(snapshot);
  return fresh.employees.map((emp) => {
    const byDate: Record<string, any[]> = {};
    const { dateMeta, sorted, totalDeduction } = buildDateMetaFromImportedDays(emp.days, {
      shiftStart: emp.shiftStart,
    });

    sorted.forEach((day) => {
      const shiftSeconds = shiftSecondsFromAssignedWH(day.assignedWH);
      byDate[day.dateKey] = [
        {
          id: `import-${emp.employeeId}-${day.dateKey}`,
          clock_in: null,
          clock_out: null,
          total_hours: day.totalWH,
          assigned_shift_seconds: shiftSeconds,
          assigned_working_hours: day.assignedWH,
          overtime: day.overtime,
          _importedDay: day,
        },
      ];
    });

    return {
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      pseudonym: emp.pseudonym,
      departmentName: emp.departmentName,
      gender: "",
      byDate,
      dateMeta,
      importedDays: sorted,
      importedFooter: emp.footer
        ? { ...emp.footer, totalDeduction: String(totalDeduction) }
        : { totalDeduction: String(totalDeduction), extraHours: "", workingDays: "" },
      shiftStart: emp.shiftStart,
      shiftEnd: emp.shiftEnd,
      isImported: true,
    };
  });
}
