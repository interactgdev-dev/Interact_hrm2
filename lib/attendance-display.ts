import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

/** Same as Attendance Summary page formatDateOnly */
export function formatDateOnly(dateValue: string | null | undefined) {
  if (!dateValue) return "";
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.exec(dateValue);
  if (dateOnlyMatch) return dateValue;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return getDateStringInTimeZone(parsed, SERVER_TIMEZONE);
}

export function monthStartFromDate(dateStr: string) {
  return `${dateStr.slice(0, 7)}-01`;
}

/** YYYY-MM → first and last day of month (last day capped to today if current month). */
export function monthRangeFromMonth(monthStr: string) {
  const [yearStr, monthStrNum] = monthStr.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStrNum) - 1;
  if (!year || monthIndex < 0) {
    const today = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    return { from: today, to: today };
  }
  const from = `${yearStr}-${monthStrNum}-01`;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthEnd = `${yearStr}-${monthStrNum}-${String(daysInMonth).padStart(2, "0")}`;
  const today = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
  const to = monthEnd > today ? today : monthEnd;
  return { from, to };
}
