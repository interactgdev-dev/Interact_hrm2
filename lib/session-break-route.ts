import { NextRequest, NextResponse } from "next/server";
import { enforceBiometricOrRespond } from "@/lib/require-biometric";
import { pool } from "@/lib/db";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";
import { getActiveShiftAssignment } from "@/lib/get-active-shift";
import { ensureLegacyEmployeeRow } from "@/lib/ensure-legacy-employee-row";
import type { SessionBreakConfig } from "@/lib/session-break-config";

const ATTENDANCE_TABLE = "employee_attendance";

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

export function createSessionBreakRouteHandlers(config: SessionBreakConfig) {
  const table = config.kind === "refreshment" ? "refreshment_breaks" : "meeting_breaks";
  const startCol = config.startField;
  const endCol = config.endField;
  const durationCol = config.durationField;

  async function GET(req: NextRequest) {
    let conn;
    try {
      const { searchParams } = new URL(req.url);
      const employeeId = searchParams.get("employeeId");
      const date = searchParams.get("date");
      const fromDate = searchParams.get("fromDate");
      const toDate = searchParams.get("toDate");
      conn = await pool.getConnection();
      if (!conn) throw new Error("Failed to get database connection from pool");
      await ensureAttendanceTable(conn);

      let query = `SELECT pb.*, e.pseudonym, d.name AS department_name,
      ec.email_work, ec.email_other,
      sa.shift_name, sa.start_time, sa.end_time, sa.assigned_date,
      ea_sess.id AS attendance_session_id,
      ea_sess.clock_in AS session_clock_in
      FROM ${table} pb
      LEFT JOIN hrm_employees e ON pb.employee_id = e.id
      LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN shift_assignments sa ON pb.shift_assignment_id = sa.id
      LEFT JOIN ${ATTENDANCE_TABLE} ea_sess ON ea_sess.id = (
        SELECT ea.id
        FROM ${ATTENDANCE_TABLE} ea
        WHERE ea.employee_id = pb.employee_id
          AND ea.clock_in IS NOT NULL
          AND pb.${startCol} >= ea.clock_in
          AND (ea.clock_out IS NULL OR pb.${startCol} <= ea.clock_out)
        ORDER BY ea.clock_in DESC, ea.id DESC
        LIMIT 1
      )
      WHERE 1=1`;
      const params: (string | number)[] = [];
      if (employeeId) {
        query += " AND pb.employee_id = ?";
        params.push(Number(employeeId));
      }
      if (date) {
        query += ` AND pb.${startCol} >= ? AND pb.${startCol} < DATE_ADD(?, INTERVAL 1 DAY)`;
        params.push(date, date);
      }
      if (fromDate && toDate) {
        query += ` AND pb.${startCol} >= ? AND pb.${startCol} < DATE_ADD(?, INTERVAL 1 DAY)`;
        params.push(fromDate, toDate);
      } else if (fromDate) {
        query += ` AND pb.${startCol} >= ?`;
        params.push(fromDate);
      } else if (toDate) {
        query += ` AND pb.${startCol} < DATE_ADD(?, INTERVAL 1 DAY)`;
        params.push(toDate);
      }
      query += ` ORDER BY pb.${startCol} DESC`;
      const [rows] = await conn.execute(query, params);
      const formattedRows = (rows as any[]).map((row) => ({
        ...row,
        employee_name: row.employee_name || "",
        pseudonym: row.pseudonym || "",
        email: row.email_work || row.email_other || "",
        attendance_session_id: row.attendance_session_id ? Number(row.attendance_session_id) : null,
        session_clock_in: row.session_clock_in ? new Date(row.session_clock_in + "Z").toISOString() : null,
        [startCol]: row[startCol] ? new Date(row[startCol] + "Z").toISOString() : null,
        [endCol]: row[endCol] ? new Date(row[endCol] + "Z").toISOString() : null,
        [durationCol]: row[durationCol] ? Number(row[durationCol]) : null,
      }));
      return NextResponse.json({ success: true, [config.responseKey]: formattedRows });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`GET ${table} error:`, error);
      return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
    } finally {
      if (conn) conn.release();
    }
  }

  async function POST(req: NextRequest) {
    let conn;
    let lockName: string | null = null;
    try {
      const data = await req.json();
      const {
        employee_id,
        employee_name,
        date,
        biometric_token,
        [startCol]: breakStart,
        [endCol]: breakEnd,
      } = data || {};
      if (!employee_id) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      const eventTimestamp = breakStart ?? breakEnd ?? date;
      const formattedDate = eventTimestamp
        ? getDateStringInTimeZone(eventTimestamp, SERVER_TIMEZONE)
        : "";
      if (!formattedDate) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      conn = await pool.getConnection();
      const canonicalEmployeeId = await ensureLegacyEmployeeRow(conn, String(employee_id), employee_name);

      if (breakStart) {
        const bioBlock = await enforceBiometricOrRespond(
          biometric_token,
          String(employee_id),
          config.startAction,
          employee_name
        );
        if (bioBlock) return bioBlock;

        lockName = `${config.lockPrefix}${canonicalEmployeeId}`;
        const [lockRows] = await conn.execute("SELECT GET_LOCK(?, 5) AS got_lock", [lockName]);
        const gotLock = Number((lockRows as any[])[0]?.got_lock || 0);
        if (gotLock !== 1) {
          return NextResponse.json(
            { success: false, error: `Could not acquire ${config.shortLabel.toLowerCase()} lock. Please try again.` },
            { status: 409 }
          );
        }

        const shiftAssignmentId = await getActiveShiftAssignment(employee_id, breakStart);
        const [ongoingRows] = await conn.execute(
          `SELECT id FROM ${table} WHERE employee_id = ? AND ${endCol} IS NULL ORDER BY ${startCol} DESC LIMIT 1`,
          [canonicalEmployeeId]
        );
        if ((ongoingRows as any[]).length > 0) {
          return NextResponse.json(
            { success: false, error: `An ongoing ${config.shortLabel.toLowerCase()} already exists for this employee.` },
            { status: 400 }
          );
        }
        await conn.execute(
          `INSERT INTO ${table} (employee_id, employee_name, shift_assignment_id, date, ${startCol}, ${endCol}, ${durationCol}) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
          [
            canonicalEmployeeId,
            employee_name || "",
            shiftAssignmentId,
            formattedDate,
            new Date(breakStart).toISOString().slice(0, 19).replace("T", " "),
          ]
        );
      } else if (breakEnd) {
        const bioBlock = await enforceBiometricOrRespond(
          biometric_token,
          String(employee_id),
          config.endAction,
          employee_name
        );
        if (bioBlock) return bioBlock;

        const [latestRows] = await conn.execute(
          `SELECT id, ${startCol} FROM ${table} WHERE employee_id = ? AND ${endCol} IS NULL ORDER BY ${startCol} DESC LIMIT 1`,
          [canonicalEmployeeId]
        );
        const latest = (latestRows as any[])[0];
        if (!latest) {
          return NextResponse.json(
            { success: false, error: `No ongoing ${config.shortLabel.toLowerCase()} found for this employee.` },
            { status: 400 }
          );
        }
        const startTime = new Date(latest[startCol] + "Z").getTime();
        const endTime = new Date(breakEnd).getTime();
        const durationInSeconds = (endTime - startTime) / 1000;
        await conn.execute(
          `UPDATE ${table} SET ${endCol} = ?, ${durationCol} = ? WHERE id = ?`,
          [
            new Date(breakEnd).toISOString().slice(0, 19).replace("T", " "),
            durationInSeconds,
            latest.id,
          ]
        );
      } else {
        return NextResponse.json({ success: false, error: "Invalid action." }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`POST ${table} error:`, error);
      return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
    } finally {
      if (conn && lockName) {
        try {
          await conn.execute("SELECT RELEASE_LOCK(?)", [lockName]);
        } catch (_) {
          // ignore
        }
      }
      if (conn) conn.release();
    }
  }

  async function PUT(req: NextRequest) {
    let conn;
    try {
      const data = await req.json();
      const { id, employee_id, employee_name, date, [startCol]: breakStart, [endCol]: breakEnd } = data || {};
      if (!id || !employee_id) {
        return NextResponse.json({ success: false, error: "Missing required fields: id or employee_id" }, { status: 400 });
      }
      conn = await pool.getConnection();
      const formattedDate = date
        ? /^\d{4}-\d{2}-\d{2}$/.test(String(date))
          ? String(date)
          : getDateStringInTimeZone(date, SERVER_TIMEZONE)
        : null;
      const formattedStart = breakStart ? new Date(breakStart).toISOString().slice(0, 19).replace("T", " ") : null;
      const formattedEnd = breakEnd ? new Date(breakEnd).toISOString().slice(0, 19).replace("T", " ") : null;
      let duration = null;
      if (formattedStart && formattedEnd) {
        duration = Math.floor((new Date(breakEnd).getTime() - new Date(breakStart).getTime()) / 1000);
      }
      await conn.execute(
        `UPDATE ${table}
         SET employee_name = ?, date = ?, ${startCol} = ?, ${endCol} = ?, ${durationCol} = ?
         WHERE id = ?`,
        [employee_name || "", formattedDate, formattedStart, formattedEnd, duration, id]
      );
      return NextResponse.json({ success: true, message: `${config.label} updated successfully` });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`PUT ${table} error:`, error);
      return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
    } finally {
      if (conn) conn.release();
    }
  }

  async function DELETE(req: NextRequest) {
    let conn;
    try {
      const data = await req.json();
      const { id } = data || {};
      if (!id) {
        return NextResponse.json({ success: false, error: "Missing required field: id" }, { status: 400 });
      }
      conn = await pool.getConnection();
      await conn.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
      return NextResponse.json({ success: true, message: `${config.label} deleted successfully` });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`DELETE ${table} error:`, error);
      return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
    } finally {
      if (conn) conn.release();
    }
  }

  return { GET, POST, PUT, DELETE };
}
