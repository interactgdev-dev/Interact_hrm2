import { SERVER_TIMEZONE } from "@/lib/timezone";

/**
 * Format ticket timestamps for UI in Asia/Karachi.
 * - Date / ISO-with-Z → true instant
 * - Naive "YYYY-MM-DD HH:mm:ss" from older mongo sqlNow() → treat as UTC wall
 */
export function parseTicketInstant(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const s = String(value).trim();
  if (!s || s === "null") return null;

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    const iso = s.includes("T") ? s : s.replace(" ", "T");
    const d = new Date(`${iso.replace(/\.\d+$/, "")}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTicketDateTime(value: unknown): string {
  const d = parseTicketInstant(value);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: SERVER_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
