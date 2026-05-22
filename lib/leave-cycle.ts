import { getDateStringInTimeZone, getParts, SERVER_TIMEZONE } from "./timezone";

function parseYmd(input: string | Date | null | undefined): { year: number; month: number; day: number } | null {
  if (!input) return null;

  if (typeof input === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.trim());
    if (m) {
      return {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
      };
    }
    // Try to parse as generic date string.
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return null;
    // Use server timezone calendar parts to avoid Ubuntu/local date shifts.
    const parts = getParts(parsed, SERVER_TIMEZONE);
    if (!parts) return null;
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
    };
  }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    // Use server timezone calendar parts to avoid Ubuntu/local date shifts.
    const parts = getParts(input, SERVER_TIMEZONE);
    if (!parts) return null;
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
    };
  }

  return null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function normalizeAnniversaryDay(year: number, month: number, day: number): number {
  // Handle Feb 29 for non-leap years.
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return 28;
  }
  return day;
}

function buildYmd(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function getLeaveCycleStartYmd(
  joinedDate: string | Date | null | undefined,
  now: Date = new Date()
): string | null {
  const joined = parseYmd(joinedDate);
  if (!joined) return null;

  const todayYmd = getDateStringInTimeZone(now, SERVER_TIMEZONE);
  const nowParts = getParts(now, SERVER_TIMEZONE);
  if (!nowParts) return null;
  const thisYear = nowParts.year;

  const thisYearDay = normalizeAnniversaryDay(thisYear, joined.month, joined.day);
  const annivThisYear = buildYmd(thisYear, joined.month, thisYearDay);

  const cycleYear = todayYmd >= annivThisYear ? thisYear : thisYear - 1;
  const cycleDay = normalizeAnniversaryDay(cycleYear, joined.month, joined.day);
  const cycleStart = buildYmd(cycleYear, joined.month, cycleDay);

  const joinedYmd = buildYmd(joined.year, joined.month, joined.day);
  return cycleStart < joinedYmd ? joinedYmd : cycleStart;
}
