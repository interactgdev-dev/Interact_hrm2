import "server-only";

import { query } from "@/lib/db";
import {
  countCompanyWorkingDays,
  toYmd,
  type CalendarStatusMap,
} from "@/lib/company-working-days";

function rowDateKey(raw: unknown): string {
  if (raw instanceof Date) return toYmd(raw);
  return toYmd(String(raw || ""));
}

/** Load company_calendar_days overrides for a range (inclusive). */
export async function loadCompanyCalendarOverrides(
  fromDate: string,
  toDate: string,
): Promise<CalendarStatusMap> {
  const from = toYmd(fromDate);
  const to = toYmd(toDate) || from;
  const map: CalendarStatusMap = {};
  if (!from) return map;
  try {
    const result = (await query(
      `SELECT date, status FROM company_calendar_days
       WHERE date >= ? AND date <= ?`,
      [from, to],
    )) as unknown[];
    const rows = Array.isArray(result?.[0]) ? result[0] : [];
    for (const row of rows as Array<{ date?: unknown; status?: unknown }>) {
      const key = rowDateKey(row.date);
      if (!key) continue;
      map[key] = String(row.status || "")
        .trim()
        .toLowerCase();
    }
  } catch {
    /* calendar table optional */
  }
  return map;
}

/**
 * Working-day leave length (server): half day → 0.5;
 * full day → count Mon–Fri minus calendar offs (+ forced working).
 */
export async function leaveWorkingDaysAsync(
  duration: "full" | "first_half" | "second_half",
  startDate: string,
  endDate: string,
): Promise<number> {
  if (duration === "first_half" || duration === "second_half") return 0.5;
  const start = toYmd(startDate);
  const end = toYmd(endDate) || start;
  if (!start) return 0;
  const overrides = await loadCompanyCalendarOverrides(start, end);
  return countCompanyWorkingDays(start, end, overrides);
}
