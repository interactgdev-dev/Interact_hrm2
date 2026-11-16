import { parseAttendanceDateTimeMs } from "./shift-timing";
import {
  dateTimeLocalToIsoInTimeZone,
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "./timezone";

/**
 * Raw ZKBio / Mongo date values (Date, ISO, naive Karachi DATETIME).
 * - Naive "YYYY-MM-DD HH:mm:ss" → interpret as +05:00.
 * - Date / ISO with Z → true UTC instant.
 */
function parseRawZkbioValueMs(value: unknown): number | null {
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

function isPunchRow(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || value instanceof Date || Array.isArray(value)) {
    return false;
  }
  const z = value as Record<string, unknown>;
  return (
    "raw_json" in z ||
    "pin" in z ||
    "log_id" in z ||
    "first_name" in z ||
    ("event_time" in z && ("imported_at" in z || "device_name" in z))
  );
}

/**
 * Prefer device-local eventTime from raw_json on punch rows; otherwise parse raw
 * Date/string values (Mongo adapter / direct event_time fields).
 */
export function parseZkbioDateTimeMs(value: unknown): number | null {
  if (value == null || value === "") return null;

  if (isPunchRow(value)) {
    const rawJson = value.raw_json;
    if (rawJson != null && rawJson !== "") {
      try {
        const parsed =
          typeof rawJson === "string"
            ? JSON.parse(rawJson)
            : (rawJson as Record<string, unknown>);
        const eventTime = parsed?.eventTime ?? parsed?.event_time;
        if (eventTime != null && String(eventTime).trim() !== "") {
          const local = String(eventTime).trim().replace(" ", "T");
          const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?/.exec(local);
          if (match) {
            const isoLocal = `${match[1]}:${match[2] || "00"}`;
            const iso = dateTimeLocalToIsoInTimeZone(isoLocal, SERVER_TIMEZONE);
            if (iso) {
              const ms = new Date(iso).getTime();
              if (!Number.isNaN(ms)) return ms;
            }
          }
        }
      } catch {
        /* fall through */
      }
    }

    const rawVal = value.event_time ?? value.imported_at;
    if (rawVal == null || rawVal === "") return null;
    return parseAttendanceDateTimeMs(rawVal) ?? parseRawZkbioValueMs(rawVal);
  }

  return parseRawZkbioValueMs(value);
}

export function formatPunchTimeMs(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: SERVER_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

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

export function formatZkbioDateTime12h(
  z: Record<string, unknown>,
  fallback?: unknown,
): string {
  const ms = parseZkbioDateTimeMs(z);
  if (ms == null) {
    if (fallback == null || fallback === "") return "";
    const d = new Date(String(fallback));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", {
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
