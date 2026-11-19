import "server-only";

import type { Db, Document, Filter } from "mongodb";
import { getDbDriver, pool } from "@/lib/db";
import { getMongoDb } from "@/lib/mongo";

const COLLECTION = "zkbio_punch_log";

export type ZkbioPunchListOpts = {
  page: number;
  pageSize: number;
  name?: string;
  dept?: string;
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
};

function dayStartUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  // Store wall times as naive UTC in many rows — use PKT offset for range bounds.
  return new Date(Date.UTC(y, m - 1, d, -5, 0, 0, 0));
}

function dayEndUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, -5, 0, 0, 0));
}

function coerceDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const normalized = s.includes("T") ? s : s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function punchInstant(doc: Document): Date | null {
  return coerceDate(doc.event_time) || coerceDate(doc.imported_at);
}

/** Date window on event_time only. Do NOT OR imported_at — backfill sets imported_at=now
 *  and that was flooding every recent query with the whole history (T.Punch / Tungsten empty/hang). */
function eventTimeRangeFilter(from?: string, to?: string): Filter<Document> {
  const range: Record<string, Date> = {};
  if (from) range.$gte = dayStartUtc(from);
  if (to) range.$lt = dayEndUtc(to);
  return {
    $or: [
      { event_time: range },
      // Legacy rows with null event_time only
      {
        $and: [
          {
            $or: [
              { event_time: null },
              { event_time: { $exists: false } },
            ],
          },
          { imported_at: range },
        ],
      },
    ],
  };
}

function buildFilter(opts: ZkbioPunchListOpts): Filter<Document> {
  const and: Filter<Document>[] = [];

  const from = opts.dateFrom?.trim();
  const to = opts.dateTo?.trim();
  if (from || to) {
    and.push(eventTimeRangeFilter(from || undefined, to || undefined));
  } else {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
    and.push(
      eventTimeRangeFilter(
        `${y}-${m}-01`,
        `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
      ),
    );
  }

  if (opts.dept?.trim()) {
    and.push({ dept_name: opts.dept.trim() });
  }

  if (opts.name?.trim()) {
    const core = opts.name.replace(/[%_\\]/g, " ").trim();
    if (core) {
      const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Tokenize so "Waqas Rafique" matches first/last separately (full-string regex never matched).
      const tokens = core.split(/\s+/).filter(Boolean);
      const nameOr: Filter<Document>[] = [];
      for (const t of tokens) {
        const re = new RegExp(escape(t), "i");
        nameOr.push({ first_name: re }, { last_name: re });
      }
      and.push({ $or: nameOr });
    }
  }

  return and.length === 1 ? and[0]! : { $and: and };
}

function timeHmsToSeconds(t: string): number | null {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
}

function wallSecondsInPkt(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

async function ensureEventTimeIndex(db: Db): Promise<void> {
  try {
    await db.collection(COLLECTION).createIndex(
      { event_time: -1, id: -1 },
      { name: "idx_event_time_id", background: true },
    );
    await db.collection(COLLECTION).createIndex(
      { pin: 1, event_time: -1 },
      { name: "idx_pin_event_time", background: true },
    );
  } catch {
    /* index may already exist */
  }
}

function dedupeKey(doc: Document): string {
  const logId = String(doc.log_id ?? "").trim();
  if (logId) return `log:${logId}`;
  const pin = String(doc.pin ?? "").trim();
  const at = punchInstant(doc);
  const stamp = at ? at.toISOString().slice(0, 19) : String(doc.id ?? "");
  return `pin:${pin}|${stamp}`;
}

export async function listZkbioPunchesNative(opts: ZkbioPunchListOpts): Promise<{
  rows: Record<string, unknown>[];
  total: number;
}> {
  const db = await getMongoDb();
  await ensureEventTimeIndex(db);
  const filter = buildFilter(opts);
  const page = Math.max(1, opts.page);
  const pageSize = Math.max(10, Math.min(2000, opts.pageSize));

  // Fetch date-bounded set then dedupe in memory (avoids Mongo SQL GROUP BY hang).
  // Month windows + employeeReport need the full range; collection is ~tens of k.
  const bufferLimit =
    opts.dateFrom && opts.dateTo
      ? 50_000
      : Math.min(12_000, Math.max(page * pageSize + pageSize * 4, 4000));
  const raw = await db
    .collection(COLLECTION)
    .find(filter)
    .sort({ event_time: -1, id: -1 })
    .limit(bufferLimit)
    .toArray();

  const timeFromSec = opts.timeFrom ? timeHmsToSeconds(opts.timeFrom) : null;
  const timeToSec = opts.timeTo ? timeHmsToSeconds(opts.timeTo) : null;

  const seen = new Set<string>();
  const deduped: Document[] = [];
  for (const doc of raw) {
    const at = punchInstant(doc);
    if (!at) continue;
    if (timeFromSec != null || timeToSec != null) {
      const sec = wallSecondsInPkt(at);
      if (timeFromSec != null && sec < timeFromSec) continue;
      if (timeToSec != null && sec > timeToSec) continue;
    }
    const key = dedupeKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(doc);
  }

  // Approximate total: if we filled the buffer, use countDocuments (indexed range).
  let total = deduped.length;
  if (raw.length >= bufferLimit) {
    total = await db.collection(COLLECTION).countDocuments(filter);
  }

  const start = (page - 1) * pageSize;
  const pageDocs = deduped.slice(start, start + pageSize);
  const rows = pageDocs.map((d) => {
    const { _id, ...rest } = d as Document & { _id?: unknown };
    return rest as Record<string, unknown>;
  });

  return { rows, total };
}

/** Fast dept names for filters — avoid full-table DISTINCT + JSON_EXTRACT. */
export async function loadZkbioDepartmentNamesFast(): Promise<string[]> {
  const names = new Set<string>();

  try {
    const [hrmRows] = await pool.query(
      `SELECT DISTINCT TRIM(name) AS d FROM departments
       WHERE name IS NOT NULL AND TRIM(name) <> ''
       ORDER BY d ASC LIMIT 500`,
    );
    for (const r of hrmRows as { d: string }[]) {
      if (r?.d) names.add(String(r.d).trim());
    }
  } catch {
    /* ignore */
  }

  if (getDbDriver() === "mongo") {
    try {
      const db = await getMongoDb();
      const recent = await db
        .collection(COLLECTION)
        .find(
          { dept_name: { $type: "string", $ne: "" } },
          { projection: { dept_name: 1 } },
        )
        .sort({ event_time: -1 })
        .limit(3000)
        .toArray();
      for (const d of recent) {
        const n = String(d.dept_name || "").trim();
        if (n) names.add(n);
      }
    } catch {
      /* ignore */
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Last Tungsten punch for an employee pin at/after clock-in (for auto clock-out time).
 */
export async function findLastTungstenPunchAfter(opts: {
  pins: string[];
  afterMs: number;
  beforeMs?: number;
}): Promise<{ atMs: number; iso: string } | null> {
  const pinSet = new Set<string | number>();
  for (const p of opts.pins) {
    const s = String(p || "").trim();
    if (!s) continue;
    pinSet.add(s);
    if (/^\d+$/.test(s)) {
      pinSet.add(Number(s));
      // ZK pads PINs: "097" vs "97"
      pinSet.add(String(Number(s)));
    }
  }
  const pins = [...pinSet];
  if (!pins.length || !Number.isFinite(opts.afterMs)) return null;

  const after = new Date(opts.afterMs);
  const beforeMs = opts.beforeMs ?? Date.now() + 60_000;
  const before = new Date(beforeMs);

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    await ensureEventTimeIndex(db);
    const docs = await db
      .collection(COLLECTION)
      .find({
        pin: { $in: pins },
        $or: [
          { event_time: { $gte: after, $lte: before } },
          { imported_at: { $gte: after, $lte: before } },
        ],
      })
      .sort({ event_time: -1 })
      .limit(50)
      .toArray();
    let best: { atMs: number; iso: string } | null = null;
    for (const d of docs) {
      const at = punchInstant(d);
      if (!at) continue;
      const ms = at.getTime();
      if (ms >= opts.afterMs && ms <= beforeMs) {
        if (!best || ms > best.atMs) best = { atMs: ms, iso: at.toISOString() };
      }
    }
    return best;
  }

  const [rows] = await pool.query(
    `SELECT event_time, imported_at FROM zkbio_punch_log
     WHERE pin IN (${pins.map(() => "?").join(",")})
       AND COALESCE(event_time, imported_at) >= ?
       AND COALESCE(event_time, imported_at) <= ?
     ORDER BY COALESCE(event_time, imported_at) DESC
     LIMIT 50`,
    [...pins.map(String), after, before],
  );
  for (const r of rows as { event_time?: unknown; imported_at?: unknown }[]) {
    const at = coerceDate(r.event_time) || coerceDate(r.imported_at);
    if (!at) continue;
    const ms = at.getTime();
    if (ms >= opts.afterMs && ms <= beforeMs) return { atMs: ms, iso: at.toISOString() };
  }
  return null;
}
