import type { Document } from "mongodb";
import { getMongoDb } from "./mongo";
import {
  calendarDay,
  employeeDisplayName,
  employeeIdValues,
  flexibleDayRangeFilter,
  formatSqlDateTime,
  idFilter,
  idKey,
  loadEmployeeLookups,
  mongoNextId,
  pickLatestShift,
  sqlDateToIso,
  toMs,
  ymd,
} from "./mongo-helpers";

type ListOpts = {
  employeeId?: string | null;
  date?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
};

function pickAttendanceSession(
  rows: Document[],
  employeeId: unknown,
  startAt: unknown,
): Document | null {
  const t = toMs(startAt);
  if (t == null) return null;
  const allowed = new Set(employeeIdValues(employeeId as string | number).map(String));
  const matches = rows.filter((a) => {
    if (!allowed.has(String(a.employee_id))) return false;
    const cin = toMs(a.clock_in);
    if (cin == null || t < cin) return false;
    const cout = toMs(a.clock_out);
    if (cout != null && t > cout) return false;
    return true;
  });
  matches.sort(
    (a, b) =>
      (toMs(b.clock_in) || 0) - (toMs(a.clock_in) || 0) || Number(b.id || 0) - Number(a.id || 0),
  );
  return matches[0] || null;
}

async function enrichBreakRows(
  rows: Document[],
  startField: string,
): Promise<Array<Record<string, unknown>>> {
  const empIds = rows.map((r) => r.employee_id).filter((v) => v != null && v !== "");
  const lookups = await loadEmployeeLookups(empIds as Array<string | number>);
  const db = await getMongoDb();
  const attendance = empIds.length
    ? await db
        .collection("employee_attendance")
        .find({
          employee_id: { $in: [...new Set(empIds.flatMap((id) => employeeIdValues(id as string | number)))] },
        })
        .toArray()
    : [];

  return rows.map((row) => {
    const emp = lookups.employees.get(idKey(row.employee_id));
    const contact = lookups.contacts.get(idKey(row.employee_id));
    const job = lookups.jobs.get(idKey(row.employee_id));
    const dept = job ? lookups.departments.get(idKey(job.department_id)) : undefined;
    const sa =
      row.shift_assignment_id != null && row.shift_assignment_id !== ""
        ? lookups.assignments.find((a) => idKey(a.id) === idKey(row.shift_assignment_id))
        : pickLatestShift(lookups.assignments, row.employee_id, ymd(row.date) || ymd(row[startField]));
    const sess = pickAttendanceSession(attendance, row.employee_id, row[startField]);
    const { _id, ...rest } = row;
    return {
      ...rest,
      employee_name: employeeDisplayName(emp, row.employee_name),
      pseudonym: emp?.pseudonym || "",
      department_name: dept?.name || null,
      email_work: contact?.email_work || null,
      email_other: contact?.email_other || null,
      email: contact?.email_work || contact?.email_other || "",
      shift_name: sa?.shift_name || null,
      start_time: sa?.start_time || null,
      end_time: sa?.end_time || null,
      assigned_date: sa?.assigned_date || null,
      attendance_session_id: sess?.id != null ? Number(sess.id) : null,
      session_clock_in: sqlDateToIso(sess?.clock_in),
    };
  });
}

function inCalendarRange(from: string, to: string, dateVal: unknown, startVal: unknown) {
  const key = calendarDay(dateVal) || calendarDay(startVal);
  return Boolean(key) && key >= from && key <= to;
}

export async function mongoListBreaks(opts: ListOpts) {
  const db = await getMongoDb();
  const filter: Document = {};
  if (opts.employeeId) filter.employee_id = { $in: employeeIdValues(opts.employeeId) };
  const from = opts.date || opts.fromDate;
  const to = opts.date || opts.toDate;
  // Date range must be in the query: imported rows are BSON Date, new rows are
  // SQL strings. Sorting mixed types + limit(8000) dropped today's breaks from admin lists.
  if (from && to) Object.assign(filter, flexibleDayRangeFilter(from, to, ["date", "break_start"]));
  let rows = await db.collection("breaks").find(filter).sort({ id: -1 }).limit(8000).toArray();
  if (from && to) {
    rows = rows.filter((row) => inCalendarRange(from, to, row.date, row.break_start));
  }
  const enriched = await enrichBreakRows(rows, "break_start");
  return enriched.map((row) => ({
    ...row,
    break_start: sqlDateToIso(row.break_start),
    break_end: sqlDateToIso(row.break_end),
    break_duration: row.break_duration != null && row.break_duration !== "" ? Number(row.break_duration) : null,
  }));
}

export async function mongoListPrayerBreaks(opts: ListOpts) {
  const db = await getMongoDb();
  const filter: Document = {};
  if (opts.employeeId) filter.employee_id = { $in: employeeIdValues(opts.employeeId) };
  const from = opts.date || opts.fromDate;
  const to = opts.date || opts.toDate;
  if (from && to) {
    Object.assign(filter, flexibleDayRangeFilter(from, to, ["date", "prayer_break_start"]));
  }
  let rows = await db.collection("prayer_breaks").find(filter).sort({ id: -1 }).limit(8000).toArray();
  if (from && to) {
    rows = rows.filter((row) => inCalendarRange(from, to, row.date, row.prayer_break_start));
  }
  const enriched = await enrichBreakRows(rows, "prayer_break_start");
  return enriched.map((row) => ({
    ...row,
    prayer_break_start: sqlDateToIso(row.prayer_break_start),
    prayer_break_end: sqlDateToIso(row.prayer_break_end),
    prayer_break_duration:
      row.prayer_break_duration != null && row.prayer_break_duration !== ""
        ? Number(row.prayer_break_duration)
        : null,
  }));
}

export async function mongoStartBreak(opts: {
  employeeId: string | number;
  employeeName?: string | null;
  date: string;
  breakStart: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getMongoDb();
  const ids = employeeIdValues(opts.employeeId);
  const open = await db.collection("breaks").findOne({
    employee_id: { $in: ids },
    $or: [{ break_end: null }, { break_end: { $exists: false } }, { break_end: "" }],
  });
  if (open) return { ok: false, error: "An ongoing lunch break already exists for this employee." };
  const shift = (await loadEmployeeLookups(ids)).assignments;
  const sa = pickLatestShift(shift, opts.employeeId, opts.date);
  await db.collection("breaks").insertOne({
    id: await mongoNextId("breaks"),
    employee_id: /^\d+$/.test(String(opts.employeeId)) ? Number(opts.employeeId) : opts.employeeId,
    employee_name: opts.employeeName || "",
    shift_assignment_id: sa?.id ?? null,
    date: opts.date,
    break_start: formatSqlDateTime(opts.breakStart),
    break_end: null,
    break_duration: null,
  });
  return { ok: true };
}

export async function mongoEndBreak(opts: {
  employeeId: string | number;
  breakEnd: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getMongoDb();
  const open = await db.collection("breaks").findOne(
    {
      employee_id: { $in: employeeIdValues(opts.employeeId) },
      $or: [{ break_end: null }, { break_end: { $exists: false } }, { break_end: "" }],
    },
    { sort: { break_start: -1 } },
  );
  if (!open?._id) return { ok: false, error: "No ongoing lunch break found for this employee." };
  const startMs = toMs(open.break_start);
  const endMs = toMs(opts.breakEnd);
  const duration = startMs != null && endMs != null ? (endMs - startMs) / 1000 : null;
  await db.collection("breaks").updateOne(
    { _id: open._id },
    { $set: { break_end: formatSqlDateTime(opts.breakEnd), break_duration: duration } },
  );
  return { ok: true };
}

export async function mongoUpdateBreak(opts: {
  id: string | number;
  employeeName?: string | null;
  date?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
  duration?: number | null;
}) {
  const db = await getMongoDb();
  await db.collection("breaks").updateOne(idFilter(opts.id), {
    $set: {
      employee_name: opts.employeeName || "",
      date: opts.date,
      break_start: opts.breakStart,
      break_end: opts.breakEnd,
      break_duration: opts.duration,
    },
  });
}

export async function mongoDeleteBreak(id: string | number) {
  const db = await getMongoDb();
  await db.collection("breaks").deleteOne(idFilter(id));
}

export async function mongoStartPrayerBreak(opts: {
  employeeId: string | number;
  employeeName?: string | null;
  date: string;
  prayerBreakStart: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getMongoDb();
  const ids = employeeIdValues(opts.employeeId);
  const open = await db.collection("prayer_breaks").findOne({
    employee_id: { $in: ids },
    $or: [{ prayer_break_end: null }, { prayer_break_end: { $exists: false } }, { prayer_break_end: "" }],
  });
  if (open) return { ok: false, error: "An ongoing prayer break already exists for this employee." };
  const shift = (await loadEmployeeLookups(ids)).assignments;
  const sa = pickLatestShift(shift, opts.employeeId, opts.date);
  await db.collection("prayer_breaks").insertOne({
    id: await mongoNextId("prayer_breaks"),
    employee_id: /^\d+$/.test(String(opts.employeeId)) ? Number(opts.employeeId) : opts.employeeId,
    employee_name: opts.employeeName || "",
    shift_assignment_id: sa?.id ?? null,
    date: opts.date,
    prayer_break_start: formatSqlDateTime(opts.prayerBreakStart),
    prayer_break_end: null,
    prayer_break_duration: null,
  });
  return { ok: true };
}

export async function mongoEndPrayerBreak(opts: {
  employeeId: string | number;
  prayerBreakEnd: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getMongoDb();
  const open = await db.collection("prayer_breaks").findOne(
    {
      employee_id: { $in: employeeIdValues(opts.employeeId) },
      $or: [{ prayer_break_end: null }, { prayer_break_end: { $exists: false } }, { prayer_break_end: "" }],
    },
    { sort: { prayer_break_start: -1 } },
  );
  if (!open?._id) return { ok: false, error: "No ongoing prayer break found for this employee." };
  const startMs = toMs(open.prayer_break_start);
  const endMs = toMs(opts.prayerBreakEnd);
  const duration = startMs != null && endMs != null ? (endMs - startMs) / 1000 : null;
  await db.collection("prayer_breaks").updateOne(
    { _id: open._id },
    {
      $set: {
        prayer_break_end: formatSqlDateTime(opts.prayerBreakEnd),
        prayer_break_duration: duration,
      },
    },
  );
  return { ok: true };
}

export async function mongoUpdatePrayerBreak(opts: {
  id: string | number;
  employeeName?: string | null;
  date?: string | null;
  prayerBreakStart?: string | null;
  prayerBreakEnd?: string | null;
  duration?: number | null;
}) {
  const db = await getMongoDb();
  await db.collection("prayer_breaks").updateOne(idFilter(opts.id), {
    $set: {
      employee_name: opts.employeeName || "",
      date: opts.date,
      prayer_break_start: opts.prayerBreakStart,
      prayer_break_end: opts.prayerBreakEnd,
      prayer_break_duration: opts.duration,
    },
  });
}

export async function mongoDeletePrayerBreak(id: string | number) {
  const db = await getMongoDb();
  await db.collection("prayer_breaks").deleteOne(idFilter(id));
}
