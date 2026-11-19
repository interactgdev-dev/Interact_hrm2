import type { Document } from "mongodb";
import { getMongoDb } from "./mongo";
import { flexibleDayRangeFilter, unwrapMongoDate } from "./mongo-helpers";
import { getTimeInMinutesInTimeZone, SERVER_TIMEZONE } from "./timezone";
import {
  parseZkbioDateTimeMs,
  zkbioCalendarDay,
} from "./zkbio-time";

const COLUMNS = [
  "id",
  "log_id",
  "event_time",
  "pin",
  "first_name",
  "last_name",
  "event_name",
  "verify_mode",
  "device_name",
  "reader_name",
  "dept_name",
  "raw_json",
  "imported_at",
] as const;

function punchAt(doc: Document): unknown {
  return unwrapMongoDate(doc.event_time) ?? unwrapMongoDate(doc.imported_at);
}

function punchDay(doc: Document): string {
  return zkbioCalendarDay(doc.event_time) || zkbioCalendarDay(doc.imported_at);
}

function displayName(doc: Document): string {
  return `${String(doc.first_name || "").trim()} ${String(doc.last_name || "").trim()}`.trim();
}

function dedupeKey(doc: Document): string {
  const logId = String(doc.log_id || "").trim();
  if (logId) return `log:${logId}`;
  const pin = String(doc.pin || "").trim();
  const day = punchDay(doc);
  const ms = parseZkbioDateTimeMs(punchAt(doc));
  const mins =
    ms != null ? getTimeInMinutesInTimeZone(ms, SERVER_TIMEZONE) : null;
  return `pin:${pin}|${day}|${mins ?? ""}`;
}

function serializePunch(doc: Document): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of COLUMNS) {
    const v = unwrapMongoDate(doc[col]);
    if (col === "event_time" || col === "imported_at") {
      const ms = parseZkbioDateTimeMs(v);
      row[col] = ms != null ? new Date(ms).toISOString() : null;
      continue;
    }
    row[col] = v instanceof Date ? v.toISOString() : v ?? null;
  }
  return row;
}

function parseHm(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function monthBounds(): { from: string; to: string } {
  const now = new Date();
  const y = now.toLocaleString("en-CA", { timeZone: SERVER_TIMEZONE, year: "numeric" });
  const mo = now.toLocaleString("en-CA", { timeZone: SERVER_TIMEZONE, month: "2-digit" });
  const last = new Date(Number(y), Number(mo), 0).getDate();
  return { from: `${y}-${mo}-01`, to: `${y}-${mo}-${String(last).padStart(2, "0")}` };
}

export async function mongoListZkbioPunches(opts: {
  page: number;
  pageSize: number;
  name?: string;
  dept?: string;
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
}): Promise<{
  rows: Record<string, unknown>[];
  total: number;
  departments: string[];
}> {
  const db = await getMongoDb();
  const col = db.collection("zkbio_punch_log");
  const useRange = Boolean(opts.dateFrom || opts.dateTo);
  const bounds = useRange
    ? { from: opts.dateFrom || "1970-01-01", to: opts.dateTo || "2099-12-31" }
    : monthBounds();

  const docs = await col
    .find(flexibleDayRangeFilter(bounds.from, bounds.to, ["event_time", "imported_at"]))
    .toArray();

  const nameCore = (opts.name || "").replace(/[%_\\]/g, " ").trim().toLowerCase();
  const timeFromM = opts.timeFrom ? parseHm(opts.timeFrom) : null;
  const timeToM = opts.timeTo ? parseHm(opts.timeTo.length === 5 ? `${opts.timeTo}:59` : opts.timeTo) : null;

  const matched = docs.filter((doc) => {
    const day = punchDay(doc);
    if (!day || day < bounds.from || day > bounds.to) return false;
    if (opts.dept && String(doc.dept_name || "").trim() !== opts.dept) return false;
    if (nameCore) {
      const blob = `${displayName(doc)} ${doc.first_name || ""} ${doc.last_name || ""}`.toLowerCase();
      if (!blob.includes(nameCore)) return false;
    }
    const punchMs = parseZkbioDateTimeMs(punchAt(doc));
    const mins =
      punchMs != null ? getTimeInMinutesInTimeZone(punchMs, SERVER_TIMEZONE) : null;
    if (timeFromM != null && (mins == null || mins < timeFromM)) return false;
    if (timeToM != null && (mins == null || mins > timeToM)) return false;
    return true;
  });

  const byKey = new Map<string, Document>();
  for (const doc of matched) {
    const key = dedupeKey(doc);
    const prev = byKey.get(key);
    if (!prev || Number(doc.id || 0) < Number(prev.id || Number.MAX_SAFE_INTEGER)) {
      byKey.set(key, doc);
    }
  }

  const unique = [...byKey.values()].sort((a, b) => {
    const am = new Date(String(punchAt(a) || 0)).getTime();
    const bm = new Date(String(punchAt(b) || 0)).getTime();
    if (bm !== am) return bm - am;
    return Number(b.id || 0) - Number(a.id || 0);
  });

  const offset = (opts.page - 1) * opts.pageSize;
  const rows = unique.slice(offset, offset + opts.pageSize).map(serializePunch);

  const deptSet = new Set<string>();
  const deptDocs = await col
    .find({ dept_name: { $exists: true, $nin: [null, ""] } })
    .project({ dept_name: 1 })
    .limit(4000)
    .toArray();
  for (const d of deptDocs) {
    const name = String(d.dept_name || "").trim();
    if (name) deptSet.add(name);
  }

  return {
    rows,
    total: unique.length,
    departments: [...deptSet].sort((a, b) => a.localeCompare(b)),
  };
}

export async function mongoZkbioPinProfiles(): Promise<
  Array<{ pin: string; first_name: unknown; last_name: unknown; dept_name: unknown }>
> {
  const db = await getMongoDb();
  const docs = await db
    .collection("zkbio_punch_log")
    .find({ pin: { $exists: true, $nin: [null, ""] } })
    .sort({ id: -1 })
    .limit(8000)
    .toArray();
  const byPin = new Map<string, Document>();
  for (const doc of docs) {
    const pin = String(doc.pin || "").trim();
    if (!pin || byPin.has(pin)) continue;
    const named =
      String(doc.first_name || "").trim() ||
      String(doc.last_name || "").trim() ||
      String(doc.dept_name || "").trim();
    if (!named) continue;
    byPin.set(pin, doc);
  }
  return [...byPin.values()].map((d) => ({
    pin: String(d.pin || "").trim(),
    first_name: d.first_name,
    last_name: d.last_name,
    dept_name: d.dept_name,
  }));
}

export async function mongoZkbioPunchesForDate(opts: {
  date: string;
  name?: string;
  dept?: string;
}): Promise<
  Array<{
    first_name: string;
    last_name: string;
    dept_name: string;
    reader_name: string;
    event_name: string;
    punch_at: string;
  }>
> {
  const { rows } = await mongoListZkbioPunches({
    page: 1,
    pageSize: 2000,
    name: opts.name,
    dept: opts.dept,
    dateFrom: opts.date,
    dateTo: opts.date,
  });
  return rows
    .map((row) => ({
      first_name: String(row.first_name || ""),
      last_name: String(row.last_name || ""),
      dept_name: String(row.dept_name || ""),
      reader_name: String(row.reader_name || ""),
      event_name: String(row.event_name || ""),
      punch_at: String(row.event_time || row.imported_at || ""),
    }))
    .sort((a, b) => a.punch_at.localeCompare(b.punch_at));
}

export async function mongoZkbioDepartments(): Promise<string[]> {
  const db = await getMongoDb();
  const [punch, depts] = await Promise.all([
    db
      .collection("zkbio_punch_log")
      .find({ dept_name: { $exists: true, $nin: [null, ""] } })
      .project({ dept_name: 1 })
      .limit(4000)
      .toArray(),
    db
      .collection("departments")
      .find({ name: { $exists: true, $nin: [null, ""] } })
      .project({ name: 1 })
      .toArray(),
  ]);
  const set = new Set<string>();
  for (const d of punch) {
    const n = String(d.dept_name || "").trim();
    if (n) set.add(n);
  }
  for (const d of depts) {
    const n = String(d.name || "").trim();
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
