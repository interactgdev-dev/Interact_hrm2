import { NextRequest, NextResponse } from "next/server";
import { enforceBiometricOrRespond } from "@/lib/require-biometric";
import { pool, getDbDriver } from "../../../lib/db";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "../../../lib/timezone";
import { getActiveShiftAssignment } from "../../../lib/get-active-shift";
import { ensureLegacyEmployeeRow } from "@/lib/ensure-legacy-employee-row";

const ATTENDANCE_TABLE = "employee_attendance";

/** YYYY-MM-DD exclusive end bound (same as DATE_ADD(date, INTERVAL 1 DAY)). */
function exclusiveEndDate(value: string): string {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return dt.toISOString().slice(0, 10);
}

async function ensureAttendanceTable(conn: any) {
  const createSql = `
    CREATE TABLE IF NOT EXISTS ${ATTENDANCE_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id VARCHAR(50) NOT NULL,
      employee_name VARCHAR(150) NULL,
      date DATE NOT NULL,
      clock_in DATETIME NULL,
      clock_out DATETIME NULL,
      total_hours DECIMAL(5,2) NULL,
      INDEX (employee_id),
      INDEX (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await conn.execute(createSql);
}

// GET: Fetch all breaks or by employeeId/date
export async function GET(req: NextRequest) {
  let conn;
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const date = searchParams.get("date"); // YYYY-MM-DD format from frontend
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    conn = await pool.getConnection();
    if (!conn) {
      throw new Error("Failed to get database connection from pool");
    }
    await ensureAttendanceTable(conn);
    let rows;
    // One attendance lookup (not two identical subqueries). Datetime range keeps break_start index usable.
    let query = `SELECT b.*, e.pseudonym, d.name AS department_name,
      ec.email_work, ec.email_other,
      sa.shift_name, sa.start_time, sa.end_time, sa.assigned_date,
      ea_sess.id AS attendance_session_id,
      ea_sess.clock_in AS session_clock_in
      FROM breaks b
      LEFT JOIN hrm_employees e ON b.employee_id = e.id
      LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN shift_assignments sa ON b.shift_assignment_id = sa.id
      LEFT JOIN ${ATTENDANCE_TABLE} ea_sess ON ea_sess.id = (
        SELECT ea.id
        FROM ${ATTENDANCE_TABLE} ea
        WHERE ea.employee_id = b.employee_id
          AND ea.clock_in IS NOT NULL
          AND b.break_start >= ea.clock_in
          AND (ea.clock_out IS NULL OR b.break_start <= ea.clock_out)
        ORDER BY ea.clock_in DESC, ea.id DESC
        LIMIT 1
      )
      WHERE 1=1`;
    const params: (string|number)[] = [];
    if (employeeId) {
      query += " AND b.employee_id = ?";
      params.push(Number(employeeId));
    }
    if (date) {
      query += " AND b.break_start >= ? AND b.break_start < ?";
      params.push(date, exclusiveEndDate(date));
    }
    if (fromDate && toDate) {
      query += " AND b.break_start >= ? AND b.break_start < ?";
      params.push(fromDate, exclusiveEndDate(toDate));
    } else if (fromDate) {
      query += " AND b.break_start >= ?";
      params.push(fromDate);
    } else if (toDate) {
      query += " AND b.break_start < ?";
      params.push(exclusiveEndDate(toDate));
    }
    query += " ORDER BY b.break_start DESC";
    [rows] = await conn.execute(query, params);
    const formattedBreaks = (rows as any[]).map(row => ({
      ...row,
      employee_name: row.employee_name || "",
      pseudonym: row.pseudonym || "",
      email: row.email_work || row.email_other || "",
      attendance_session_id: row.attendance_session_id ? Number(row.attendance_session_id) : null,
      session_clock_in: row.session_clock_in ? new Date(row.session_clock_in + 'Z').toISOString() : null,
      break_start: row.break_start ? new Date(row.break_start + 'Z').toISOString() : null,
      break_end: row.break_end ? new Date(row.break_end + 'Z').toISOString() : null,
      break_duration: row.break_duration ? Number(row.break_duration) : null,
    }));
    return NextResponse.json({ success: true, breaks: formattedBreaks });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('GET breaks error:', error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// POST: Add or update break record
export async function POST(req: NextRequest) {
  let conn;
  let lockName: string | null = null;
  try {
    const data = await req.json();
    const { employee_id, employee_name, date, break_start, break_end, biometric_token } =
      data || {};
    if (!employee_id) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }
    const eventTimestamp = break_start ?? break_end ?? date;
    const formattedDate = eventTimestamp
      ? getDateStringInTimeZone(eventTimestamp, SERVER_TIMEZONE)
      : "";

    if (!formattedDate) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    conn = await pool.getConnection();
    const canonicalEmployeeId = await ensureLegacyEmployeeRow(
      conn,
      String(employee_id),
      employee_name
    );

    // Lunch break logic only
    if (break_start) {
      const bioBlock = await enforceBiometricOrRespond(
        biometric_token,
        String(employee_id),
        "break_start",
        employee_name
      );
      if (bioBlock) return bioBlock;

      if (getDbDriver() === "mysql") {
        lockName = `break_start_emp_${canonicalEmployeeId}`;
        const [lockRows] = await conn.execute("SELECT GET_LOCK(?, 5) AS got_lock", [lockName]);
        const gotLock = Number((lockRows as any[])[0]?.got_lock || 0);
        if (gotLock !== 1) {
          return NextResponse.json(
            { success: false, error: "Could not acquire break lock. Please try again." },
            { status: 409 }
          );
        }
      }

      // Get active shift assignment for this employee at break start time
      const shiftAssignmentId = await getActiveShiftAssignment(employee_id, break_start);

      // Prevent duplicate starts regardless of shift assignment.
      // This also protects when shift_assignment_id is NULL.
      const [ongoingBreaks] = await conn.execute(
        "SELECT id FROM breaks WHERE employee_id = ? AND break_end IS NULL ORDER BY break_start DESC LIMIT 1",
        [canonicalEmployeeId]
      );
      if ((ongoingBreaks as any[]).length > 0) {
        return NextResponse.json(
          { success: false, error: "An ongoing lunch break already exists for this employee." },
          { status: 400 }
        );
      }
      await conn.execute(
        "INSERT INTO breaks (employee_id, employee_name, shift_assignment_id, date, break_start, break_end, break_duration) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
        [canonicalEmployeeId, employee_name || "", shiftAssignmentId, formattedDate, new Date(break_start).toISOString().slice(0, 19).replace('T', ' ')]
      );
    } else if (break_end) {
      const bioBlock = await enforceBiometricOrRespond(
        biometric_token,
        String(employee_id),
        "break_end",
        employee_name
      );
      if (bioBlock) return bioBlock;

      // Ending an existing lunch break - find ANY open break (not just today)
      const [latestBreakRows] = await conn.execute(
        "SELECT id, break_start FROM breaks WHERE employee_id = ? AND break_end IS NULL ORDER BY break_start DESC LIMIT 1",
        [canonicalEmployeeId]
      );
      const latestBreak = (latestBreakRows as any[])[0];
      if (!latestBreak) {
        return NextResponse.json({ success: false, error: "No ongoing lunch break found for this employee." }, { status: 400 });
      }
      const breakStartTime = new Date(latestBreak.break_start + 'Z').getTime();
      const breakEndTime = new Date(break_end).getTime();
      const breakDurationInSeconds = (breakEndTime - breakStartTime) / 1000;
      await conn.execute(
        "UPDATE breaks SET break_end = ?, break_duration = ? WHERE id = ?",
        [new Date(break_end).toISOString().slice(0, 19).replace('T', ' '), breakDurationInSeconds, latestBreak.id]
      );
    } else {
      return NextResponse.json({ success: false, error: "Invalid break action." }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('POST breaks error:', error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn && lockName) {
      try {
        await conn.execute("SELECT RELEASE_LOCK(?)", [lockName]);
      } catch (_) {
        // ignore lock release errors
      }
    }
    if (conn) conn.release();
  }
}
// PUT: Update existing break record (Admin manual edit)
export async function PUT(req: NextRequest) {
  let conn;
  try {
    const data = await req.json();
    const { id, employee_id, employee_name, date, break_start, break_end } = data || {};

    if (!id || !employee_id) {
      return NextResponse.json({ success: false, error: "Missing required fields: id or employee_id" }, { status: 400 });
    }

    conn = await pool.getConnection();

    const formattedDate = date
      ? /^\d{4}-\d{2}-\d{2}$/.test(String(date))
        ? String(date)
        : getDateStringInTimeZone(date, SERVER_TIMEZONE)
      : null;
    const formattedBreakStart = break_start ? new Date(break_start).toISOString().slice(0, 19).replace('T', ' ') : null;
    const formattedBreakEnd = break_end ? new Date(break_end).toISOString().slice(0, 19).replace('T', ' ') : null;

    // Calculate duration if both start and end are provided
    let breakDuration = null;
    if (formattedBreakStart && formattedBreakEnd) {
      const startTime = new Date(break_start).getTime();
      const endTime = new Date(break_end).getTime();
      breakDuration = Math.floor((endTime - startTime) / 1000); // Duration in seconds
    }

    await conn.execute(
      `UPDATE breaks 
       SET employee_name = ?, date = ?, break_start = ?, break_end = ?, 
           break_duration = ?
       WHERE id = ?`,
      [employee_name || '', formattedDate, formattedBreakStart, formattedBreakEnd, breakDuration, id]
    );

    return NextResponse.json({ success: true, message: 'Break updated successfully' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('PUT breaks error:', error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// DELETE: Delete break record
export async function DELETE(req: NextRequest) {
  let conn;
  try {
    const data = await req.json();
    const { id } = data || {};

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing required field: id" }, { status: 400 });
    }

    conn = await pool.getConnection();
    await conn.execute(`DELETE FROM breaks WHERE id = ?`, [id]);

    return NextResponse.json({ success: true, message: 'Break deleted successfully' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('DELETE breaks error:', error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}