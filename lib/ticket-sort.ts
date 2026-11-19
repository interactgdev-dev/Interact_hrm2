/** Client-safe newest-first ticket sorting (no DB imports). */

export function ticketRecencyMs(t: {
  id?: number | string | null;
  updated_at?: string | Date | null;
  resolved_at?: string | Date | null;
  requested_at?: string | Date | null;
}): number {
  let best = 0;
  for (const c of [t.updated_at, t.resolved_at, t.requested_at]) {
    if (c instanceof Date) {
      const ms = c.getTime();
      if (Number.isFinite(ms) && ms > best) best = ms;
      continue;
    }
    const raw = String(c || "").trim();
    if (!raw) continue;
    const ms = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (Number.isFinite(ms) && ms > best) best = ms;
  }
  return best || Number(t.id) || 0;
}

/** Newest activity first (recent approvals float to top). Id as tiebreaker. */
export function sortTicketsNewestFirst<
  T extends {
    id?: number | string | null;
    updated_at?: string | Date | null;
    resolved_at?: string | Date | null;
    requested_at?: string | Date | null;
  },
>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) => {
    const diff = ticketRecencyMs(b) - ticketRecencyMs(a);
    if (diff !== 0) return diff;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}
