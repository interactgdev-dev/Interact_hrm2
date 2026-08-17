import type { Document } from "mongodb";
import { getMongoDb } from "./mongo";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "./timezone";

export function employeeIdValues(employeeId: string | number): Array<string | number> {
  const s = String(employeeId ?? "").trim();
  const vals: Array<string | number> = [s];
  if (/^\d+$/.test(s)) vals.push(Number(s));
  return vals;
}

export function idKey(v: unknown): string {
  return String(v ?? "").trim();
}

export function isBlank(v: unknown): boolean {
  return v == null || v === "";
}

export function exclusiveEndDate(value: string): string {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return dt.toISOString().slice(0, 10);
}

/** mongoimport EJSON `{ $date: "..." }` or BSON Date or SQL datetime string. */
export function unwrapMongoDate(v: unknown): unknown {
  if (v == null || v === "") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "$date" in (v as object)) {
    const raw = (v as { $date: unknown }).$date;
    if (typeof raw === "string" || typeof raw === "number") return new Date(raw);
    if (raw && typeof raw === "object" && "$numberLong" in (raw as object)) {
      return new Date(Number((raw as { $numberLong: string }).$numberLong));
    }
  }
  return v;
}

export function formatSqlDateTime(isoOrDate: string | Date): string {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function ymd(v: unknown): string {
  const u = unwrapMongoDate(v);
  if (u == null || u === "") return "";
  if (u instanceof Date && !Number.isNaN(u.getTime())) return u.toISOString().slice(0, 10);
  return String(u).slice(0, 10);
}

/** Calendar day in Asia/Karachi — imported MySQL DATE often lands as BSON Date. */
export function calendarDay(v: unknown): string {
  const u = unwrapMongoDate(v);
  if (u == null || u === "") return "";
  if (typeof u === "string" && /^\d{4}-\d{2}-\d{2}/.test(u) && !u.includes("T")) {
    return u.slice(0, 10);
  }
  return getDateStringInTimeZone(u as string | Date | number, SERVER_TIMEZONE) || ymd(u);
}

/**
 * Match YYYY-MM-DD strings and BSON Date / ISO datetimes for the same calendar range.
 */
export function flexibleDayRangeFilter(
  fromYmd: string,
  toYmdInclusive: string,
  fields: string[] = ["date", "clock_in"],
): Document {
  const next = exclusiveEndDate(toYmdInclusive);
  const startDt = new Date(`${fromYmd}T00:00:00+05:00`);
  const endDt = new Date(`${next}T00:00:00+05:00`);
  const padStart = new Date(startDt.getTime() - 36 * 3600000);
  const padEnd = new Date(endDt.getTime() + 36 * 3600000);
  const or: Document[] = [];
  for (const field of fields) {
    or.push({ [field]: { $gte: fromYmd, $lte: toYmdInclusive } });
    or.push({ [field]: { $gte: fromYmd, $lt: next } });
    or.push({ [field]: { $gte: padStart, $lt: padEnd } });
  }
  return { $or: or };
}

export function toMs(v: unknown): number | null {
  const u = unwrapMongoDate(v);
  if (u == null || u === "") return null;
  if (u instanceof Date) {
    const t = u.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const s = String(u);
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

export function sqlDateToIso(v: unknown): string | null {
  const u = unwrapMongoDate(v);
  if (isBlank(u)) return null;
  if (u instanceof Date) return Number.isNaN(u.getTime()) ? null : u.toISOString();
  const s = String(u);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:/.test(s) && !s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s.replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function mongoNextId(collection: string): Promise<number> {
  const db = await getMongoDb();
  const last = await db
    .collection(collection)
    .find({ id: { $type: ["int", "long", "double", "decimal"] } })
    .sort({ id: -1 })
    .limit(1)
    .toArray();
  const max = last[0]?.id;
  return typeof max === "number" ? max + 1 : 1;
}

export function idFilter(id: string | number): { id: { $in: Array<string | number> } } {
  const s = String(id).trim();
  const vals: Array<string | number> = [s];
  if (/^\d+$/.test(s)) vals.push(Number(s));
  return { id: { $in: vals } };
}

export function indexById<T extends Document>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(idKey(r.id), r);
  return m;
}

export function indexFirstByEmployee<T extends Document>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = idKey(r.employee_id);
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
}

export async function loadEmployeeLookups(employeeIds: Array<string | number>) {
  const db = await getMongoDb();
  const ids = [...new Set(employeeIds.flatMap((id) => employeeIdValues(id)))];
  if (!ids.length) {
    return {
      employees: new Map<string, Document>(),
      contacts: new Map<string, Document>(),
      jobs: new Map<string, Document>(),
      departments: new Map<string, Document>(),
      assignments: [] as Document[],
    };
  }
  const [employees, contacts, jobs, assignments] = await Promise.all([
    db.collection("hrm_employees").find({ id: { $in: ids } }).toArray(),
    db.collection("employee_contacts").find({ employee_id: { $in: ids } }).toArray(),
    db.collection("employee_jobs").find({ employee_id: { $in: ids } }).toArray(),
    db.collection("shift_assignments").find({ employee_id: { $in: ids } }).toArray(),
  ]);
  const deptIds = [
    ...new Set(jobs.map((j) => j.department_id).filter((v) => v != null && v !== "")),
  ];
  const departments = deptIds.length
    ? await db.collection("departments").find({ id: { $in: deptIds } }).toArray()
    : [];
  return {
    employees: indexById(employees),
    contacts: indexFirstByEmployee(contacts),
    jobs: indexFirstByEmployee(jobs),
    departments: indexById(departments),
    assignments,
  };
}

export function pickLatestShift(
  assignments: Document[],
  employeeId: unknown,
  onOrBefore: string,
): Document | null {
  const day = ymd(onOrBefore);
  if (!day) return null;
  const allowed = new Set(employeeIdValues(employeeId as string | number).map(String));
  const eligible = assignments.filter((a) => {
    if (!allowed.has(String(a.employee_id))) return false;
    const assigned = ymd(a.assigned_date);
    return assigned !== "" && assigned <= day;
  });
  eligible.sort((a, b) => {
    const dd = ymd(b.assigned_date).localeCompare(ymd(a.assigned_date));
    if (dd) return dd;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  return eligible[0] || null;
}

export function employeeDisplayName(emp: Document | undefined, fallback: unknown): string {
  const fromHrm = [emp?.first_name, emp?.last_name].filter(Boolean).join(" ").trim();
  return fromHrm || String(fallback || "");
}
