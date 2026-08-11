import { NextRequest, NextResponse } from "next/server";
import { registerAutoPresenceCron } from "@/lib/register-auto-presence-cron";
import { enforceBiometricOrRespond } from "@/lib/require-biometric";
import { isGraceExpiredForEmployee } from "@/lib/attendance-presence";
import { closeActiveBreaksForEmployee } from "@/lib/auto-clock-out";

registerAutoPresenceCron();
import { pool } from "../../../lib/db";
import { ATTENDANCE_TABLE, ensureAttendanceTable } from "../../../lib/attendance-table";
import {
  getDateStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
import { computeClockInLateStatus } from "../../../lib/monthly-attendance-status";

// GET: Fetch all attendance records or by employeeId, now with department name
export async function GET(req: NextRequest) {
  let conn;
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const date = searchParams.get("date");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const activeBreakCheck = searchParams.get("activeBreakCheck");
    /** Any open session for employee (all dates) — matches POST clock-in guard */
    const openOnly = searchParams.get("openOnly") === "1";
    /** Lighter payload for summary pages — skips shift subquery + contacts */
    const summaryOnly = searchParams.get("summary") === "1";
    
    conn = await pool.getConnection();
    if (!conn) {
      throw new Error("Failed to get database connection from pool");
    }
    await ensureAttendanceTable(conn);

    if (activeBreakCheck && employeeId) {
      const breakStatus = await checkActiveBreaks(conn, employeeId);
      return NextResponse.json({ success: true, ...breakStatus });
    }
    let rows;
    // Join with hrm_employees for employee name and pseudonym, and departments for department name
    const baseQuery = summaryOnly
      ? `
      SELECT 
        ea.*,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))), ''),
          NULLIF(TRIM(ea.employee_name), ''),
          ea.employee_name
        ) as employee_name,
        e.pseudonym AS pseudonym,
        e.gender AS gender,
        d.name AS department_name,
        sa.start_time AS shift_start_time
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
    `
      : `
      SELECT 
        ea.*,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))), ''),
          NULLIF(TRIM(ea.employee_name), ''),
          ea.employee_name
        ) as employee_name,
        e.pseudonym AS pseudonym,
        e.gender AS gender,
        d.name AS department_name,
        ec.email_work,
        ec.email_other,
        sa.shift_name AS shift_name,
        sa.start_time AS shift_start_time,
        sa.end_time AS shift_end_time,
        sa.assigned_date AS shift_assigned_date
      FROM ${ATTENDANCE_TABLE} ea
      LEFT JOIN hrm_employees e ON ea.employee_id = e.id
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
      LEFT JOIN shift_assignments sa
        ON sa.employee_id = ea.employee_id
       AND sa.assigned_date = (
         SELECT MAX(sa2.assigned_date)
         FROM shift_assignments sa2
         WHERE sa2.employee_id = ea.employee_id
           AND sa2.assigned_date <= ea.date
       )
    `;
    if (employeeId) {
      if (openOnly) {
        [rows] = await conn.execute(
          `${baseQuery} WHERE ea.employee_id = ? AND ea.clock_out IS NULL ORDER BY ea.clock_in DESC`,
          [employeeId]
        );
      } else if (date) {
        [rows] = await conn.execute(
          `${baseQuery} WHERE ea.employee_id = ? AND ea.date = ? ORDER BY ea.clock_in DESC`,
          [employeeId, date]
        );
      } else if (fromDate && toDate) {
        [rows] = await conn.execute(
          `${baseQuery} WHERE ea.employee_id = ? AND ea.date BETWEEN ? AND ? ORDER BY ea.clock_in DESC`,
          [employeeId, fromDate, toDate]
        );
      } else {
        [rows] = await conn.execute(
          `${baseQuery} WHERE ea.employee_id = ? ORDER BY ea.clock_in DESC`,
          [employeeId]
        );
      }
    } else if (fromDate && toDate) {
      [rows] = await conn.execute(
        `${baseQuery} WHERE ea.date BETWEEN ? AND ? ORDER BY ea.clock_in DESC`,
        [fromDate, toDate]
      );
    } else if (date) {
      [rows] = await conn.execute(
        `${baseQuery} WHERE ea.date = ? ORDER BY ea.clock_in DESC`,
        [date]
      );
    } else {
      [rows] = await conn.execute(
        `${baseQuery} ORDER BY ea.clock_in DESC LIMIT 1000`
      );
    }

    // Simply return the rows as is; frontend will handle date parsing.
    
    const formattedAttendance = (rows as any[]).map((row) => {
      let formattedClockIn = null;
      let clockInDate: Date | null = null;
      
      if (row.clock_in) {
        // Add 'Z' to assume UTC and ensure proper parsing by new Date()
        clockInDate = new Date(String(row.clock_in) + 'Z');
        if (!isNaN(clockInDate.getTime())) {
            formattedClockIn = clockInDate.toISOString();
        }
      }

      let formattedClockOut = null;
      if (row.clock_out) {
        // Add 'Z' to assume UTC and ensure proper parsing by new Date()
        const clockOutDate = new Date(String(row.clock_out) + 'Z');
        if (!isNaN(clockOutDate.getTime())) {
            formattedClockOut = clockOutDate.toISOString();
        }
      }

      // Prefer persisted late_minutes when present; else compute from shift + grace
      const computedLate = computeClockInLateStatus(
        row.clock_in,
        row.shift_start_time,
        row.gender
      );
      const storedLate =
        row.late_minutes != null && row.late_minutes !== ""
          ? Number(row.late_minutes)
          : null;
      const late_minutes =
        storedLate != null && Number.isFinite(storedLate)
          ? storedLate
          : computedLate.lateMinutes;
      const is_late =
        storedLate != null && Number.isFinite(storedLate)
          ? storedLate > 0
          : computedLate.isLate;

      return {
        ...row,
        clock_in: formattedClockIn,
        clock_out: formattedClockOut,
        is_late,
        late_minutes,
        pseudonym: row.pseudonym || null,
        gender: row.gender || null,
        email: row.email_work || row.email_other || null,
      };
    });
    
    return NextResponse.json({ success: true, attendance: formattedAttendance });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('GET attendance error:', error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// Helper function to check if employee has active breaks
async function checkActiveBreaks(conn: any, employee_id: string) {
  try {
    // Check for active regular break (not ended yet)
    const [breakRecords] = await conn.execute(
      `SELECT * FROM breaks 
       WHERE employee_id = ? AND break_end IS NULL
       ORDER BY break_start DESC LIMIT 1`,
      [Number(employee_id)]
    );
    
    const breakRecord = (breakRecords as any[])[0];
    
    // Check if regular break is active (started but not ended)
    if (breakRecord?.break_start && !breakRecord.break_end) {
      return { hasActiveBreak: true, breakType: 'break' };
    }

    // Also check prayer_breaks table for active prayer breaks
    try {
      const [prayerRows] = await conn.execute(
        `SELECT prayer_break_start, prayer_break_end
         FROM prayer_breaks
         WHERE employee_id = ? AND prayer_break_end IS NULL
         ORDER BY prayer_break_start DESC LIMIT 1`,
        [Number(employee_id)]
      );
      const prayerRecord = (prayerRows as any[])[0];
      if (prayerRecord?.prayer_break_start && !prayerRecord.prayer_break_end) {
        return { hasActiveBreak: true, breakType: 'prayer_break' };
      }
    } catch (error) {
      console.error('Error checking prayer_breaks table:', error);
    }

    return { hasActiveBreak: false, breakType: null };
  } catch (error) {
    console.error('Error checking breaks:', error);
    // If there's an error checking breaks, allow clock out to proceed
    // but log the error for debugging
    return { hasActiveBreak: false, breakType: null };
  }
}

// POST: Add or update attendance record
export async function POST(req: NextRequest) {
  let conn;
  let lockName: string | null = null;
  try {
    const data = await req.json();
    const {
      employee_id,
      employee_name,
      date,
      clock_in,
      clock_out,
      auto_clock_out,
      biometric_token,
    } = data || {};
    
    console.log("Attendance API POST Data:", { employee_id, employee_name, date, clock_in, clock_out });
    
    // Restrict attendance date to server timezone (Asia/Karachi)
    const eventTimestamp = clock_in ?? clock_out ?? null;
    const formattedDate = eventTimestamp
      ? getDateStringInTimeZone(eventTimestamp, SERVER_TIMEZONE)
      : date
      ? String(date).slice(0, 10)
      : "";

    if (!employee_id || !formattedDate) {
      return NextResponse.json({ success: false, error: "Missing required fields: employee_id or date" }, { status: 400 });
    }

    conn = await pool.getConnection();
    await ensureAttendanceTable(conn);

    if (clock_in !== undefined && clock_in !== null) {
      const bioBlock = await enforceBiometricOrRespond(
        biometric_token,
        String(employee_id),
        "clock_in",
        employee_name
      );
      if (bioBlock) return bioBlock;

      lockName = `attendance_clock_in_emp_${String(employee_id).trim()}`;
      const [lockRows] = await conn.execute("SELECT GET_LOCK(?, 5) AS got_lock", [lockName]);
      const gotLock = Number((lockRows as any[])[0]?.got_lock || 0);
      if (gotLock !== 1) {
        return NextResponse.json(
          { success: false, error: "Could not acquire clock-in lock. Please try again." },
          { status: 409 }
        );
      }

      // Prevent duplicate clock-ins when multiple taps/concurrent requests happen.
      const [openRows] = await conn.execute(
        `SELECT id FROM ${ATTENDANCE_TABLE} WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
        [employee_id]
      );
      if ((openRows as any[]).length > 0) {
        const openId = (openRows as any[])[0]?.id;
        return NextResponse.json(
          {
            success: false,
            error: "You are already clocked in. Please clock out first.",
            openAttendanceId: openId,
          },
          { status: 400 },
        );
      }

      // Clock In: Always INSERT a new row (persist late_minutes for monthly attendance)
      const clockInIso = new Date(clock_in).toISOString();
      const clockInDb = clockInIso.slice(0, 19).replace("T", " ");
      let lateMinutesToStore: number | null = null;
      try {
        const [shiftRows] = await conn.execute(
          `SELECT sa.start_time, e.gender
           FROM shift_assignments sa
           LEFT JOIN hrm_employees e ON e.id = sa.employee_id
           WHERE sa.employee_id = ?
             AND sa.assigned_date <= ?
           ORDER BY sa.assigned_date DESC, sa.id DESC
           LIMIT 1`,
          [employee_id, formattedDate],
        );
        const shift = (shiftRows as { start_time?: string; gender?: string }[])[0];
        if (shift?.start_time) {
          lateMinutesToStore = computeClockInLateStatus(
            clockInDb,
            shift.start_time,
            shift.gender,
          ).lateMinutes;
        } else {
          lateMinutesToStore = 0;
        }
      } catch (err) {
        console.warn("Could not compute late_minutes on clock-in:", err);
      }

      console.log("Inserting new clock-in record:", {
        employee_id,
        employee_name,
        formattedDate,
        clock_in,
        late_minutes: lateMinutesToStore,
      });
      await conn.execute(
        `INSERT INTO ${ATTENDANCE_TABLE}
           (employee_id, employee_name, date, clock_in, clock_out, total_hours, late_minutes, auto_clock_out, last_presence_ack_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, NULL)`,
        [
          employee_id,
          employee_name || "",
          formattedDate,
          clockInDb,
          lateMinutesToStore,
        ],
      );
      console.log("Clock-in record inserted successfully");
    } else if (clock_out !== undefined && clock_out !== null) {
      let isAutoClockOut = Boolean(auto_clock_out);

      if (!isAutoClockOut) {
        const graceExpired = await isGraceExpiredForEmployee(conn, String(employee_id));
        if (graceExpired) {
          isAutoClockOut = true;
        }
      }

      if (!isAutoClockOut) {
        const bioBlock = await enforceBiometricOrRespond(
          biometric_token,
          String(employee_id),
          "clock_out",
          employee_name
        );
        if (bioBlock) return bioBlock;
      }

      if (!isAutoClockOut) {
      // Check for active breaks before allowing clock out
      const { hasActiveBreak, breakType } = await checkActiveBreaks(conn, employee_id);
      
      if (hasActiveBreak) {
        const breakName = breakType === 'prayer_break' ? 'Prayer Break' : 'Break';
        console.warn(`Clock-out prevented: ${breakName} is active for employee ${employee_id}`);
        return NextResponse.json(
          { 
            success: false, 
            error: `Cannot clock out. ${breakName} is still active. Please end your ${breakName.toLowerCase()} first.`,
            errorCode: 'ACTIVE_BREAK'
          }, 
          { status: 400 }
        );
      }
      }

      // Clock Out: find the most recent row without clock_out for this employee (regardless of date) and UPDATE it
      const [pendingRows] = await conn.execute(
        `SELECT id FROM ${ATTENDANCE_TABLE} WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
        [employee_id]
      );
      const pending = (pendingRows as any[])[0];
      if (pending) {
        const formattedClockOut = new Date(clock_out).toISOString().slice(0, 19).replace('T', ' ');
        if (isAutoClockOut) {
          await closeActiveBreaksForEmployee(
            conn,
            String(employee_id),
            formattedClockOut,
            new Date(clock_out).toISOString(),
          );
        }
        await conn.execute(
          `UPDATE ${ATTENDANCE_TABLE}
           SET clock_out = ?,
               auto_clock_out = ?,
               last_presence_ack_at = NULL,
               total_hours = LEAST(999.99, ROUND(TIMESTAMPDIFF(MINUTE, clock_in, ?)/60, 2)),
               employee_name = ?
           WHERE id = ?`,
          [formattedClockOut, isAutoClockOut ? 1 : 0, formattedClockOut, employee_name || null, pending.id]
        );
        console.log("Clock-out record updated successfully");
      } else {
        console.warn("No pending clock-in found for clock-out");
      }
    }

    return NextResponse.json({ success: true, message: clock_in ? 'inserted' : 'updated' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('POST attendance error:', error);
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

// PUT: Update existing attendance record (Admin manual edit) or auto-close old open records
export async function PUT(req: NextRequest) {
  let conn;
  try {
    const data = await req.json();
    const { id, employee_id, employee_name, date, clock_in, clock_out, autoCloseOldRecords } = data || {};

    conn = await pool.getConnection();
    await ensureAttendanceTable(conn);

    // If autoCloseOldRecords flag is set, close any old open records for this employee
    if (autoCloseOldRecords && employee_id) {
      await conn.execute(
        `UPDATE ${ATTENDANCE_TABLE}
         SET clock_out = DATE_ADD(clock_in, INTERVAL 8 HOUR),
             total_hours = 8.00
         WHERE employee_id = ? AND clock_out IS NULL AND DATE(clock_in) < CURDATE()`,
        [employee_id]
      );
      return NextResponse.json({ success: true, message: 'Old open records closed' });
    }

    if (!id || !employee_id || !date) {
      return NextResponse.json({ success: false, error: "Missing required fields: id, employee_id or date" }, { status: 400 });
    }

    const formattedClockIn = clock_in ? new Date(clock_in).toISOString().slice(0, 19).replace('T', ' ') : null;
    const formattedClockOut = clock_out ? new Date(clock_out).toISOString().slice(0, 19).replace('T', ' ') : null;
    const formattedDate = date
      ? /^\d{4}-\d{2}-\d{2}$/.test(String(date))
        ? String(date)
        : getDateStringInTimeZone(date, SERVER_TIMEZONE)
      : null;

    let lateMinutesToStore: number | null = null;
    if (formattedClockIn && formattedDate) {
      try {
        const [shiftRows] = await conn.execute(
          `SELECT sa.start_time, e.gender
           FROM shift_assignments sa
           LEFT JOIN hrm_employees e ON e.id = sa.employee_id
           WHERE sa.employee_id = ?
             AND sa.assigned_date <= ?
           ORDER BY sa.assigned_date DESC, sa.id DESC
           LIMIT 1`,
          [employee_id, formattedDate],
        );
        const shift = (shiftRows as { start_time?: string; gender?: string }[])[0];
        lateMinutesToStore = shift?.start_time
          ? computeClockInLateStatus(formattedClockIn, shift.start_time, shift.gender)
              .lateMinutes
          : 0;
      } catch (err) {
        console.warn("Could not compute late_minutes on attendance update:", err);
      }
    }

    await conn.execute(
      `UPDATE ${ATTENDANCE_TABLE} 
       SET employee_name = ?, date = ?, clock_in = ?, clock_out = ?, 
           late_minutes = ?,
           total_hours = CASE 
             WHEN ? IS NOT NULL AND ? IS NOT NULL 
             THEN ROUND(TIMESTAMPDIFF(MINUTE, ?, ?)/60, 2) 
             ELSE NULL 
           END
       WHERE id = ?`,
      [
        employee_name || "",
        formattedDate,
        formattedClockIn,
        formattedClockOut,
        lateMinutesToStore,
        formattedClockIn,
        formattedClockOut,
        formattedClockIn,
        formattedClockOut,
        id,
      ],
    );

    return NextResponse.json({ success: true, message: 'Attendance updated successfully' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('PUT attendance error:', error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// DELETE: Delete attendance record
export async function DELETE(req: NextRequest) {
  let conn;
  try {
    const data = await req.json();
    const { id } = data || {};

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing required field: id" }, { status: 400 });
    }

    conn = await pool.getConnection();
    await ensureAttendanceTable(conn);

    await conn.execute(`DELETE FROM ${ATTENDANCE_TABLE} WHERE id = ?`, [id]);

    return NextResponse.json({ success: true, message: 'Attendance deleted successfully' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('DELETE attendance error:', error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
