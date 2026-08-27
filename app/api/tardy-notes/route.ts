import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { ATTENDANCE_TABLE } from "@/lib/attendance-table";
import { fetchShiftForEmployee } from "@/lib/attendance-presence";
import { computeClockInLateStatus } from "@/lib/monthly-attendance-status";
import { clockInDateKey } from "@/lib/shift-timing";
import {
  isValidTardyNoteCode,
  TARDY_NOTE_OPTIONS,
  TARDY_NOTE_OTHER_CODE,
  tardyNoteLabelForCode,
  validateTardyOtherText,
} from "@/lib/tardy-note-options";
import {
  getTardyNoteByAttendanceId,
  listTardyNotesInRange,
  upsertTardyNote,
} from "@/lib/tardy-notes-table";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

type OpenAttendanceRow = {
  attendance_id: number | null;
  clock_in: string | null;
  attendance_date: string | Date | null;
  late_minutes?: number | null;
};

function dateKeyFromRow(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return getDateStringInTimeZone(value, SERVER_TIMEZONE);
  const s = String(value).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  return getDateStringInTimeZone(new Date(s), SERVER_TIMEZONE);
}

/** Active open session only — widget shows after late clock-in and hides after clock-out. */
async function getActiveTardyContext(employeeId: string) {
  // Simple open-session query (no JOIN) — Mongo adapter JOIN+IS NULL was matching
  // closed rows and returning yesterday's attendance_id (blocking the late popup).
  const [rows] = await pool.execute(
    `SELECT id AS attendance_id, clock_in, date AS attendance_date, late_minutes
     FROM ${ATTENDANCE_TABLE}
     WHERE employee_id = ? AND clock_in IS NOT NULL AND clock_out IS NULL
     ORDER BY clock_in DESC
     LIMIT 1`,
    [employeeId]
  );
  const row = (rows as OpenAttendanceRow[])[0];
  if (!row?.clock_in) {
    return { isLate: false, isClockedIn: false, attendanceDate: "", attendanceId: 0 };
  }

  const attendanceId = Number(row.attendance_id) || 0;
  const attendanceDate =
    dateKeyFromRow(row.attendance_date) || clockInDateKey(row.clock_in) || "";

  // Trust stored late_minutes when present (including 0 = on time). Recomputing from
  // Mongo BSON Date clock_in can falsely flip on-time → late after re-login.
  const rawLate = row.late_minutes as number | string | null | undefined;
  const storedLate =
    rawLate != null && String(rawLate).trim() !== "" ? Number(rawLate) : null;
  if (storedLate != null && Number.isFinite(storedLate)) {
    return {
      isLate: storedLate > 0,
      isClockedIn: true,
      attendanceDate,
      attendanceId,
    };
  }

  const [empRows] = await pool.execute(
    `SELECT gender FROM hrm_employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const gender = (empRows as { gender?: string | null }[])[0]?.gender ?? null;
  const shift = attendanceDate
    ? await fetchShiftForEmployee(pool, employeeId, attendanceDate)
    : null;
  const lateStatus = computeClockInLateStatus(
    row.clock_in,
    shift?.start_time ?? null,
    gender
  );

  return {
    isLate: lateStatus.isLate,
    isClockedIn: true,
    attendanceDate,
    attendanceId,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId")?.trim() || "";
    const date = searchParams.get("date")?.trim() || "";
    const fromDate = searchParams.get("fromDate")?.trim() || "";
    const toDate = searchParams.get("toDate")?.trim() || "";

    if (fromDate && toDate) {
      const notes = await listTardyNotesInRange(fromDate, toDate, employeeId || undefined);
      return NextResponse.json({ success: true, notes });
    }

    if (!employeeId || !date) {
      return NextResponse.json(
        { success: false, error: "employeeId and date are required" },
        { status: 400 }
      );
    }

    const ctx = await getActiveTardyContext(employeeId);
    const note =
      ctx.attendanceId > 0 ? await getTardyNoteByAttendanceId(ctx.attendanceId) : null;

    return NextResponse.json({
      success: true,
      isLate: ctx.isLate,
      isClockedIn: ctx.isClockedIn,
      canAddNote: ctx.isLate && ctx.isClockedIn && !note,
      attendanceDate: ctx.attendanceDate,
      attendanceId: ctx.attendanceId,
      note,
      options: TARDY_NOTE_OPTIONS,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load tardy note";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const employeeId = String(body?.employeeId || "").trim();
    const attendanceDate =
      String(body?.attendanceDate || body?.date || "").trim() ||
      getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    const noteCode = String(body?.noteCode || "").trim();
    const noteText = String(body?.noteText || "");

    if (!employeeId || !noteCode) {
      return NextResponse.json(
        { success: false, error: "employeeId and noteCode are required" },
        { status: 400 }
      );
    }
    if (!isValidTardyNoteCode(noteCode)) {
      return NextResponse.json({ success: false, error: "Invalid note option" }, { status: 400 });
    }

    const ctx = await getActiveTardyContext(employeeId);
    if (!ctx.isClockedIn) {
      return NextResponse.json(
        { success: false, error: "Tardy note can only be added while you are clocked in" },
        { status: 400 }
      );
    }
    if (!ctx.isLate) {
      return NextResponse.json(
        { success: false, error: "Tardy note is only allowed after a late clock-in" },
        { status: 400 }
      );
    }
    if (!ctx.attendanceId) {
      return NextResponse.json(
        { success: false, error: "Active attendance session not found" },
        { status: 400 }
      );
    }

    const saveDate = ctx.attendanceDate || attendanceDate;
    let noteLabel = tardyNoteLabelForCode(noteCode);
    if (noteCode === TARDY_NOTE_OTHER_CODE) {
      const otherCheck = validateTardyOtherText(noteText);
      if (!otherCheck.ok) {
        return NextResponse.json({ success: false, error: otherCheck.error }, { status: 400 });
      }
      noteLabel = otherCheck.value;
    }

    const saved = await upsertTardyNote(
      employeeId,
      saveDate,
      noteCode,
      ctx.attendanceId,
      noteLabel
    );
    return NextResponse.json({ success: true, note: saved });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to save tardy note";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
