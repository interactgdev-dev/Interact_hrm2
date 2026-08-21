export const SERVER_TIMEZONE = "Asia/Karachi";

type DateInput = Date | string | number;

/**
 * Parse to an absolute instant.
 * Attendance / MySQL datetimes are UTC wall ("YYYY-MM-DD HH:mm:ss") — without an
 * offset, append Z so Asia/Karachi process TZ does not treat them as local (−5h).
 * Date-only "YYYY-MM-DD" stays UTC midnight (calendar key).
 */
export function parseToInstant(value: DateInput): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const s = String(value ?? "").trim();
  if (!s) return new Date(NaN);
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    const iso = (s.includes("T") ? s : s.replace(" ", "T")).replace(/\.\d+$/, "");
    return new Date(`${iso}Z`);
  }
  return new Date(s);
}

function toDate(value: DateInput) {
  return parseToInstant(value);
}

/** Reuse formatters — getParts is called on every clock tick and must stay cheap. */
const partsFormatterByTz = new Map<string, Intl.DateTimeFormat>();
const timeFormatterByTz = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string) {
  let formatter = partsFormatterByTz.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterByTz.set(timeZone, formatter);
  }
  return formatter;
}

function getTimeFormatter(timeZone: string) {
  let formatter = timeFormatterByTz.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    timeFormatterByTz.set(timeZone, formatter);
  }
  return formatter;
}

export function getParts(value: DateInput, timeZone: string = SERVER_TIMEZONE) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = getPartsFormatter(timeZone).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const second = Number(parts.find((part) => part.type === "second")?.value);

  if (
    [year, month, day, hour, minute, second].some((num) => Number.isNaN(num))
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

export function getDateStringInTimeZone(
  value: DateInput,
  timeZone: string = SERVER_TIMEZONE
) {
  const parts = getParts(value, timeZone);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getTimeStringInTimeZone(
  value: DateInput,
  timeZone: string = SERVER_TIMEZONE
) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";

  return getTimeFormatter(timeZone).format(date);
}

export function getTimeInMinutesInTimeZone(
  value: DateInput,
  timeZone: string = SERVER_TIMEZONE
) {
  const parts = getParts(value, timeZone);
  if (!parts) return null;
  return parts.hour * 60 + parts.minute;
}

export function getDateTimeLocalInTimeZone(
  value: DateInput,
  timeZone: string = SERVER_TIMEZONE
) {
  const parts = getParts(value, timeZone);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function dateTimeLocalToIsoInTimeZone(
  dateTimeLocal: string,
  timeZone: string = SERVER_TIMEZONE
) {
  if (!dateTimeLocal) return "";
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(
    dateTimeLocal
  );
  if (!match) return "";

  const datePart = match[1];
  const timePart = match[2];
  const seconds = match[3] || "00";

  if (timeZone === SERVER_TIMEZONE) {
    const parsed = new Date(`${datePart}T${timePart}:${seconds}+05:00`);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  const fallback = new Date(`${datePart}T${timePart}:${seconds}`);
  return Number.isNaN(fallback.getTime()) ? "" : fallback.toISOString();
}