import { NextRequest, NextResponse } from "next/server";
import { formatDateOnly, monthStartFromDate } from "@/lib/attendance-display";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "@/lib/timezone";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

const ATTENDANCE_TABLE = "employee_attendance";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ReportRow = {
  source: "H" | "T";
  sortAt: string;
  date: string;
  time: string;
  employeeName: string;
  department: string;
  detail: string;
};

type AttendanceSummaryRow = {
  employee_name: string;
  department_name: string;
  clock_in: string | null;
  clock_out: string | null;
  date: string | null;
};

function rowFromIso(
  source: "H" | "T",
  iso: string,
  employeeName: string,
  department: string,
  detail: string,
): ReportRow | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return {
    source,
    sortAt: at.toISOString(),
    date: getDateStringInTimeZone(at, SERVER_TIMEZONE),
    time: getTimeStringInTimeZone(at, SERVER_TIMEZONE),
    employeeName,
    department: department || "-",
    detail,
  };
}

/** Attendance Summary GET query + ISO formatting (same as /api/attendance) */
async function fetchAttendanceSummaryRows(fromDate: string, toDate: string) {
  const baseQuery = `
    SELECT
      ea.*,
      CONCAT(e.first_name, ' ', e.last_name) as employee_name,
      e.pseudonym AS pseudonym,
      d.name AS department_name
    FROM ${ATTENDANCE_TABLE} ea
    LEFT JOIN hrm_employees e ON ea.employee_id = e.id
    LEFT JOIN employee_jobs j ON e.id = j.employee_id
    LEFT JOIN departments d ON j.department_id = d.id
    LEFT JOIN shift_assignments sa
      ON sa.employee_id = ea.employee_id
     AND sa.assigned_date = (
       SELECT MAX(sa2.assigned_date)
       FROM shift_assignments sa2
       WHERE sa2.employee_id = ea.employee_id
         AND sa2.assigned_date <= ea.date
     )
    WHERE DATE(ea.date) BETWEEN ? AND ?
    ORDER BY ea.clock_in ASC
  `;
  const [rows] = await pool.query(baseQuery, [fromDate, toDate]);
  return (rows as Record<string, unknown>[]).map((row): AttendanceSummaryRow => {
    let formattedClockIn: string | null = null;
    if (row.clock_in) {
      const d = new Date(String(row.clock_in) + "Z");
      if (!Number.isNaN(d.getTime())) formattedClockIn = d.toISOString();
    }
    let formattedClockOut: string | null = null;
    if (row.clock_out) {
      const d = new Date(String(row.clock_out) + "Z");
      if (!Number.isNaN(d.getTime())) formattedClockOut = d.toISOString();
    }
    return {
      employee_name: String(row.employee_name || "").trim(),
      department_name: String(row.department_name || ""),
      clock_in: formattedClockIn,
      clock_out: formattedClockOut,
      date: row.date != null ? String(row.date) : null,
    };
  });
}

/**
 * GET /api/employee-report-day?date=2026-05-22&name=&dept=
 * H = Attendance Summary source; T = zkbio punch log.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const nameRaw = (searchParams.get("name") || "").trim();
    const date = (searchParams.get("date") || "").trim();
    const dept = (searchParams.get("dept") || "").trim();

    if (!date || !DATE_RE.test(date)) {
      return NextResponse.json(
        { success: false, error: "Valid date is required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const merged: ReportRow[] = [];
    const term = nameRaw.toLowerCase();
    const monthStart = monthStartFromDate(date);

    const attendance = await fetchAttendanceSummaryRows(monthStart, date);
    for (const a of attendance) {
      const visibleDate = formatDateOnly(a.clock_in || a.clock_out || a.date);
      if (visibleDate !== date) continue;

      const employeeName = a.employee_name || "—";
      const department = a.department_name || "";

      if (term && !employeeName.toLowerCase().includes(term)) continue;
      if (dept && department !== dept) continue;

      if (a.clock_in) {
        const r = rowFromIso("H", a.clock_in, employeeName, department, "Clock In");
        if (r && r.date === date) merged.push(r);
      }
      if (a.clock_out) {
        const r = rowFromIso("H", a.clock_out, employeeName, department, "Clock Out");
        if (r && r.date === date) merged.push(r);
      }
    }

    const zkConditions = ["DATE(COALESCE(z.event_time, z.imported_at)) = ?"];
    const zkParams: (string | number)[] = [date];
    if (nameRaw) {
      const nameLike = `%${nameRaw.replace(/[%_\\]/g, " ").trim()}%`;
      zkConditions.push(
        `(CONCAT(IFNULL(z.first_name,''), ' ', IFNULL(z.last_name,'')) LIKE ? OR z.first_name LIKE ? OR z.last_name LIKE ?)`,
      );
      zkParams.push(nameLike, nameLike, nameLike);
    }
    if (dept) {
      zkConditions.push("z.dept_name = ?");
      zkParams.push(dept);
    }

    const groupCols = `COALESCE(NULLIF(TRIM(z2.log_id), ''), CONCAT(IFNULL(z2.pin,''), '|', DATE_FORMAT(COALESCE(z2.event_time, z2.imported_at), '%Y-%m-%d %H:%i:%s')))`;
    const zkWhere = zkConditions.map((c) => c.replace(/\bz\./g, "z2.")).join(" AND ");
    const zkSql = `
      SELECT z.first_name, z.last_name, z.dept_name, z.reader_name, z.event_name,
             COALESCE(z.event_time, z.imported_at) AS punch_at
      FROM zkbio_punch_log z
      INNER JOIN (
        SELECT MIN(z2.id) AS mid FROM zkbio_punch_log z2
        WHERE ${zkWhere} GROUP BY ${groupCols}
      ) k ON z.id = k.mid
      ORDER BY punch_at ASC
    `;
    const [zkRows] = await pool.query(zkSql, zkParams);
    for (const row of zkRows as Record<string, unknown>[]) {
      const first = String(row.first_name || "").trim();
      const last = String(row.last_name || "").trim();
      const employeeName = `${first} ${last}`.trim() || "—";
      const department = String(row.dept_name || "");
      const raw = row.punch_at;
      if (!raw) continue;
      const s = String(raw);
      const at = new Date(s.includes("T") ? s : s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2"));
      if (Number.isNaN(at.getTime())) continue;
      const reader = String(row.reader_name || "").trim() || "-";
      const event = String(row.event_name || "").trim() || "Punch";
      merged.push({
        source: "T",
        sortAt: at.toISOString(),
        date: getDateStringInTimeZone(at, SERVER_TIMEZONE),
        time: getTimeStringInTimeZone(at, SERVER_TIMEZONE),
        employeeName,
        department: department || "-",
        detail: `${reader} — ${event}`,
      });
    }

    merged.sort((a, b) => {
      const nc = a.employeeName.localeCompare(b.employeeName, undefined, { sensitivity: "base" });
      if (nc !== 0) return nc;
      return a.sortAt.localeCompare(b.sortAt);
    });

    const [deptRows] = await pool.query(
      `SELECT DISTINCT TRIM(dept_name) AS d FROM zkbio_punch_log
       WHERE dept_name IS NOT NULL AND TRIM(dept_name) <> ''
       UNION
       SELECT DISTINCT TRIM(d.name) AS d FROM departments d
       WHERE d.name IS NOT NULL AND TRIM(d.name) <> ''
       ORDER BY d ASC`,
    );
    const departments = (deptRows as { d: string }[]).map((r) => r.d).filter(Boolean);

    return NextResponse.json({
      success: true,
      date,
      name: nameRaw,
      rows: merged,
      total: merged.length,
      hCount: merged.filter((r) => r.source === "H").length,
      tCount: merged.filter((r) => r.source === "T").length,
      departments,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
