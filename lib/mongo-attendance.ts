import type { Document } from "mongodb";
import { getMongoDb } from "./mongo";
import { computeClockInLateStatus } from "./monthly-attendance-status";
import {
  calendarDay,
  employeeDisplayName,
  employeeIdValues,
  formatSqlDateTime,
  idFilter,
  idKey,
  isBlank,
  loadEmployeeLookups,
  mongoNextId,
  pickLatestShift,
  sqlDateToIso,
  toMs,
  ymd,
} from "./mongo-helpers";

function hoursBetween(clockIn: unknown, clockOut: unknown): number {
  const a = toMs(clockIn);
  const b = toMs(clockOut);
  if (a == null || b == null || b <= a) return 0;
  return Math.min(999.99, Math.round(((b - a) / 3600000) * 100) / 100);
}

export async function mongoHasActiveBreak(employeeId: string | number): Promise<{
  hasActiveBreak: boolean;
  breakType: "break" | "prayer_break" | null;
}> {
  const db = await getMongoDb();
  const ids = employeeIdValues(employeeId);
  const br = await db.collection("breaks").findOne({
    employee_id: { $in: ids },
    $or: [{ break_end: null }, { break_end: { $exists: false } }, { break_end: "" }],
  });
  if (br) return { hasActiveBreak: true, breakType: "break" };

  const pr = await db.collection("prayer_breaks").findOne({
    employee_id: { $in: ids },
    $or: [
      { prayer_break_end: null },
      { prayer_break_end: { $exists: false } },
      { prayer_break_end: "" },
    ],
  });
  if (pr) return { hasActiveBreak: true, breakType: "prayer_break" };
  return { hasActiveBreak: false, breakType: null };
}

export async function mongoFindOpenAttendance(
  employeeId: string | number,
): Promise<Document | null> {
  const db = await getMongoDb();
  const docs = await db
    .collection("employee_attendance")
    .find({
      employee_id: { $in: employeeIdValues(employeeId) },
      $or: [{ clock_out: null }, { clock_out: { $exists: false } }, { clock_out: "" }],
    })
    .sort({ clock_in: -1, id: -1 })
    .limit(20)
    .toArray();
  return docs.find((d) => isBlank(d.clock_out)) ?? null;
}

export async function mongoClockOut(opts: {
  employeeId: string | number;
  clockOut: string;
  employeeName?: string | null;
  autoClockOut?: boolean;
}): Promise<boolean> {
  const open = await mongoFindOpenAttendance(opts.employeeId);
  if (!open?._id) return false;
  const formatted = formatSqlDateTime(opts.clockOut);
  const db = await getMongoDb();
  await db.collection("employee_attendance").updateOne(
    { _id: open._id },
    {
      $set: {
        clock_out: formatted,
        auto_clock_out: opts.autoClockOut ? 1 : 0,
        last_presence_ack_at: null,
        total_hours: hoursBetween(open.clock_in, formatted),
        ...(opts.employeeName ? { employee_name: opts.employeeName } : {}),
      },
    },
  );
  return true;
}

export async function mongoClockIn(opts: {
  employeeId: string | number;
  employeeName?: string | null;
  date: string;
  clockIn: string;
}): Promise<{ ok: true } | { ok: false; error: string; openAttendanceId?: unknown }> {
  const open = await mongoFindOpenAttendance(opts.employeeId);
  if (open) {
    return {
      ok: false,
      error: "You are already clocked in. Please clock out first.",
      openAttendanceId: open.id,
    };
  }
  const lookups = await loadEmployeeLookups(employeeIdValues(opts.employeeId));
  const emp = lookups.employees.get(idKey(opts.employeeId));
  const shift = pickLatestShift(lookups.assignments, opts.employeeId, opts.date);
  const clockInDb = formatSqlDateTime(opts.clockIn);
  const lateMinutes = shift?.start_time
    ? computeClockInLateStatus(clockInDb, String(shift.start_time), emp?.gender as string | undefined)
        .lateMinutes
    : 0;
  const db = await getMongoDb();
  await db.collection("employee_attendance").insertOne({
    id: await mongoNextId("employee_attendance"),
    employee_id: /^\d+$/.test(String(opts.employeeId)) ? Number(opts.employeeId) : opts.employeeId,
    employee_name: opts.employeeName || employeeDisplayName(emp, ""),
    date: opts.date,
    clock_in: clockInDb,
    clock_out: null,
    total_hours: null,
    late_minutes: lateMinutes,
    auto_clock_out: 0,
    last_presence_ack_at: null,
  });
  return { ok: true };
}

export async function mongoListAttendance(opts: {
  employeeId?: string | null;
  date?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  openOnly?: boolean;
  summaryOnly?: boolean;
}) {
  const db = await getMongoDb();
  const filter: Document = {};
  if (opts.employeeId) filter.employee_id = { $in: employeeIdValues(opts.employeeId) };
  if (opts.openOnly) {
    filter.$or = [{ clock_out: null }, { clock_out: { $exists: false } }, { clock_out: "" }];
  }
  // Do not filter `date` in Mongo — import stores BSON Date, new rows store YYYY-MM-DD strings.
  let rows = await db.collection("employee_attendance").find(filter).sort({ clock_in: -1 }).toArray();
  if (!opts.openOnly && (opts.date || (opts.fromDate && opts.toDate))) {
    const from = opts.date || opts.fromDate!;
    const to = opts.date || opts.toDate!;
    rows = rows.filter((row) => {
      const key = calendarDay(row.date) || calendarDay(row.clock_in);
      return key >= from && key <= to;
    });
  } else if (!opts.employeeId && !opts.openOnly) {
    rows = rows.slice(0, 1000);
  }
  const lookups = await loadEmployeeLookups(rows.map((r) => r.employee_id).filter(Boolean));

  return rows.map((row) => {
    const day = calendarDay(row.date) || calendarDay(row.clock_in);
    const emp = lookups.employees.get(idKey(row.employee_id));
    const contact = lookups.contacts.get(idKey(row.employee_id));
    const job = lookups.jobs.get(idKey(row.employee_id));
    const dept = job ? lookups.departments.get(idKey(job.department_id)) : undefined;
    const sa = pickLatestShift(lookups.assignments, row.employee_id, day);
    const computedLate = computeClockInLateStatus(
      row.clock_in,
      sa?.start_time as string | undefined,
      emp?.gender as string | undefined,
    );
    const storedLate =
      row.late_minutes != null && row.late_minutes !== "" ? Number(row.late_minutes) : null;
    const late_minutes =
      storedLate != null && Number.isFinite(storedLate) ? storedLate : computedLate.lateMinutes;
    const is_late =
      storedLate != null && Number.isFinite(storedLate) ? storedLate > 0 : computedLate.isLate;
    const { _id, ...rest } = row;
    return {
      ...rest,
      date: day || rest.date,
      employee_name: employeeDisplayName(emp, row.employee_name),
      pseudonym: emp?.pseudonym || null,
      gender: emp?.gender || null,
      department_name: dept?.name || null,
      email_work: opts.summaryOnly ? undefined : contact?.email_work || null,
      email_other: opts.summaryOnly ? undefined : contact?.email_other || null,
      email: contact?.email_work || contact?.email_other || null,
      shift_name: opts.summaryOnly ? undefined : sa?.shift_name || null,
      shift_start_time: sa?.start_time || null,
      shift_end_time: opts.summaryOnly ? undefined : sa?.end_time || null,
      shift_assigned_date: opts.summaryOnly ? undefined : sa?.assigned_date || null,
      clock_in: sqlDateToIso(row.clock_in),
      clock_out: sqlDateToIso(row.clock_out),
      is_late,
      late_minutes,
    };
  });
}

export async function mongoUpdateAttendance(opts: {
  id: string | number;
  employeeName?: string | null;
  date: string;
  clockIn?: string | null;
  clockOut?: string | null;
}) {
  const db = await getMongoDb();
  const existing = await db.collection("employee_attendance").findOne(idFilter(opts.id));
  const employeeId = existing?.employee_id;
  const lookups = employeeId != null ? await loadEmployeeLookups(employeeIdValues(employeeId)) : null;
  const emp = lookups?.employees.get(idKey(employeeId));
  const shift = lookups ? pickLatestShift(lookups.assignments, employeeId, opts.date) : null;
  const clockInDb = opts.clockIn ? formatSqlDateTime(opts.clockIn) : null;
  const clockOutDb = opts.clockOut ? formatSqlDateTime(opts.clockOut) : null;
  const lateMinutes = clockInDb
    ? shift?.start_time
      ? computeClockInLateStatus(clockInDb, String(shift.start_time), emp?.gender as string | undefined)
          .lateMinutes
      : 0
    : null;
  await db.collection("employee_attendance").updateOne(idFilter(opts.id), {
    $set: {
      employee_name: opts.employeeName || "",
      date: opts.date,
      clock_in: clockInDb,
      clock_out: clockOutDb,
      late_minutes: lateMinutes,
      total_hours: clockInDb && clockOutDb ? hoursBetween(clockInDb, clockOutDb) : null,
    },
  });
}

export async function mongoDeleteAttendance(id: string | number) {
  const db = await getMongoDb();
  await db.collection("employee_attendance").deleteOne(idFilter(id));
}

export async function mongoAutoCloseOldOpen(employeeId: string | number) {
  const db = await getMongoDb();
  const today = new Date().toISOString().slice(0, 10);
  const open = await db
    .collection("employee_attendance")
    .find({
      employee_id: { $in: employeeIdValues(employeeId) },
      $or: [{ clock_out: null }, { clock_out: { $exists: false } }, { clock_out: "" }],
    })
    .toArray();
  for (const row of open) {
    const day = ymd(row.date) || ymd(row.clock_in);
    if (!day || day >= today) continue;
    const cin = toMs(row.clock_in);
    if (cin == null || !row._id) continue;
    const clockOut = new Date(cin + 8 * 3600000);
    await db.collection("employee_attendance").updateOne(
      { _id: row._id },
      {
        $set: {
          clock_out: formatSqlDateTime(clockOut),
          total_hours: 8,
        },
      },
    );
  }
}
