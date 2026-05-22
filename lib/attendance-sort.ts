/**
 * Attendance Summary ordering: open (running) sessions first, then latest activity first.
 * - Open rows: sort by clock_in descending (newest clock-in first among opens).
 * - Closed rows: sort by max(clock_in, clock_out) descending so the session that ended last is on top.
 */
import { getParts, SERVER_TIMEZONE } from "./timezone";

function toKarachiEpochMs(value: string | null | undefined) {
  if (!value) return 0;
  const parts = getParts(value, SERVER_TIMEZONE);
  if (!parts) return 0;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

export function compareAttendanceRows(a: any, b: any): number {
  const isOpen = (row: any) =>
    !!(row?.clock_in && (row.clock_out == null || String(row.clock_out).trim() === ""));

  const aOpen = isOpen(a);
  const bOpen = isOpen(b);
  if (aOpen !== bOpen) return aOpen ? -1 : 1;

  if (aOpen && bOpen) {
    const ta = toKarachiEpochMs(a.clock_in);
    const tb = toKarachiEpochMs(b.clock_in);
    if (tb !== ta) return tb - ta;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  }

  const endMs = (row: any) => {
    const tIn = toKarachiEpochMs(row.clock_in);
    const tOut = toKarachiEpochMs(row.clock_out);
    return Math.max(tIn, tOut);
  };
  const ka = endMs(a);
  const kb = endMs(b);
  if (kb !== ka) return kb - ka;
  return (Number(b.id) || 0) - (Number(a.id) || 0);
}
