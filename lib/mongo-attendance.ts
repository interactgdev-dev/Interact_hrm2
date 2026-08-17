import type { Document } from "mongodb";
import { getMongoDb } from "./mongo";

function employeeIdValues(employeeId: string | number): Array<string | number> {
  const s = String(employeeId ?? "").trim();
  const vals: Array<string | number> = [s];
  if (/^\d+$/.test(s)) vals.push(Number(s));
  return vals;
}

function isEmptyClockOut(v: unknown): boolean {
  return v == null || v === "";
}

function hoursBetween(clockIn: unknown, clockOut: unknown): number {
  const a =
    clockIn instanceof Date
      ? clockIn.getTime()
      : new Date(String(clockIn).replace(" ", "T")).getTime();
  const b =
    clockOut instanceof Date
      ? clockOut.getTime()
      : new Date(String(clockOut).replace(" ", "T")).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.min(999.99, Math.round(((b - a) / 3600000) * 100) / 100);
}

function formatSqlDateTime(isoOrDate: string | Date): string {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function mongoHasActiveBreak(employeeId: string | number): Promise<{
  hasActiveBreak: boolean;
  breakType: "break" | "prayer_break" | null;
}> {
  const db = await getMongoDb();
  const ids = employeeIdValues(employeeId);
  const openEnd = {
    $or: [{ break_end: null }, { break_end: { $exists: false } }, { break_end: "" }],
  };
  const br = await db.collection("breaks").findOne({
    employee_id: { $in: ids },
    ...openEnd,
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
  const ids = employeeIdValues(employeeId);
  const docs = await db
    .collection("employee_attendance")
    .find({
      employee_id: { $in: ids },
      $or: [
        { clock_out: null },
        { clock_out: { $exists: false } },
        { clock_out: "" },
      ],
    })
    .sort({ clock_in: -1, id: -1 })
    .limit(20)
    .toArray();
  return docs.find((d) => isEmptyClockOut(d.clock_out)) ?? null;
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
        ...(opts.employeeName
          ? { employee_name: opts.employeeName }
          : {}),
      },
    },
  );
  return true;
}
