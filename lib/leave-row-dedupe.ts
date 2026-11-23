/**
 * Deduplicate employee_leaves clones created when ticket→leave sync
 * failed to find an existing `[ticket:N]` row (Mongo LIKE + multiline reason).
 */

export function ticketIdFromReason(reason: unknown): number | null {
  const m = /\[ticket:(\d+)\]/i.exec(String(reason || ""));
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export type LeaveLikeRow = {
  id?: number | string;
  reason?: unknown;
  status?: unknown;
  leave_category?: unknown;
  total_days?: unknown;
  employee_id?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  updated_at?: unknown;
};

function statusRank(status: unknown): number {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return 3;
  if (s === "rejected") return 2;
  if (s === "pending") return 1;
  return 0;
}

/** Prefer approved → rejected → pending, then lowest id (original). */
export function pickCanonicalLeaveRow<T extends LeaveLikeRow>(rows: T[]): T | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const sr = statusRank(b.status) - statusRank(a.status);
    if (sr !== 0) return sr;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  })[0];
}

/**
 * One row per ticket marker. Untagged rows kept individually by id.
 * Input order does not matter.
 */
export function dedupeLeavesByTicketMarker<T extends LeaveLikeRow>(
  rows: T[],
): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const byTicket = new Map<number, T[]>();
  const untagged: T[] = [];
  for (const row of rows) {
    const tid = ticketIdFromReason(row?.reason);
    if (tid == null) {
      untagged.push(row);
      continue;
    }
    const list = byTicket.get(tid);
    if (list) list.push(row);
    else byTicket.set(tid, [row]);
  }
  const out: T[] = [...untagged];
  for (const group of byTicket.values()) {
    const keep = pickCanonicalLeaveRow(group);
    if (keep) out.push(keep);
  }
  return out;
}
