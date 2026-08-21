import { getDateStringInTimeZone, getTimeStringInTimeZone, SERVER_TIMEZONE } from "./timezone";

/**
 * ZKBio / Tungsten device times are Asia/Karachi wall clocks.
 * - Naive "YYYY-MM-DD HH:mm:ss" (MySQL DATETIME) → interpret as +05:00.
 * - Date / ISO with Z → true UTC instant (Mongo after correct sync / migration).
 */
export function parseZkbioDateTimeMs(value: unknown): number | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }

  const s = String(value).trim();
  if (!s || s === "null") return null;

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? null : t;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = new Date(`${s}T00:00:00+05:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = (s.includes("T") ? s : s.replace(" ", "T")).replace(/\.\d+$/, "");
    const t = new Date(`${iso}+05:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }

  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Format ZKBio event for UI in Asia/Karachi. */
export function formatZkbioDateTime(value: unknown): string {
  const ms = parseZkbioDateTimeMs(value);
  if (ms == null) return "";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: SERVER_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function zkbioCalendarDay(value: unknown): string {
  const ms = parseZkbioDateTimeMs(value);
  if (ms == null) return "";
  return getDateStringInTimeZone(ms, SERVER_TIMEZONE);
}

export function zkbioTimeString(value: unknown): string {
  const ms = parseZkbioDateTimeMs(value);
  if (ms == null) return "";
  return getTimeStringInTimeZone(ms, SERVER_TIMEZONE);
}

/**
 * Legacy Mongo rows: naive Karachi wall was inserted as UTC (digits unchanged).
 * Convert stored UTC-wall Date → true UTC instant (subtract 5h).
 */
export function legacyZkbioUtcWallToInstantMs(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    value.getUTCHours() - 5,
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  );
}
