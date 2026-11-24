/**
 * Company working-day rules (same as calendar / payroll):
 * - calendar override "working" → count
 * - calendar override "off" | "holiday" → skip
 * - else Mon–Fri only (Sat/Sun skip)
 *
 * Pure helpers only — safe for client bundles.
 * Server DB loaders live in company-working-days-server.ts.
 */

export type CalendarStatusMap = Record<string, string>;

/** YYYY-MM-DD from Date / ISO / loose string. */
export function toYmd(raw: string | Date | null | undefined): string {
  if (!raw) return "";
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return "";
    // Mongo DATE often midnight UTC
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return "";
  return toYmd(dt);
}

/** Local weekday for YYYY-MM-DD (0=Sun … 6=Sat). */
export function weekdayOfYmd(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function eachYmdInclusive(startYmd: string, endYmd: string): string[] {
  const start = toYmd(startYmd);
  const end = toYmd(endYmd) || start;
  if (!start || !end || end < start) return start ? [start] : [];
  const out: string[] = [];
  const [y, m, d] = start.split("-").map(Number);
  const cur = new Date(y, m - 1, d);
  const [ey, em, ed] = end.split("-").map(Number);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    const yy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, "0");
    const dd = String(cur.getDate()).padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function isCompanyWorkingDay(
  dateKey: string,
  calendarOverrides?: CalendarStatusMap | null,
): boolean {
  const key = toYmd(dateKey);
  if (!key) return false;
  const override = String(calendarOverrides?.[key] || "")
    .trim()
    .toLowerCase();
  if (override === "working") return true;
  if (override === "off" || override === "holiday") return false;
  const wd = weekdayOfYmd(key);
  return wd !== 0 && wd !== 6;
}

/** Count working days in [start, end] inclusive. */
export function countCompanyWorkingDays(
  startDate: string,
  endDate: string,
  calendarOverrides?: CalendarStatusMap | null,
): number {
  const days = eachYmdInclusive(startDate, endDate);
  let n = 0;
  for (const key of days) {
    if (isCompanyWorkingDay(key, calendarOverrides)) n += 1;
  }
  return n;
}
