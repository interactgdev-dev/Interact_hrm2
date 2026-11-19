import { NextRequest, NextResponse } from "next/server";
import { registerAutoPresenceCron } from "@/lib/register-auto-presence-cron";

registerAutoPresenceCron();
import { pool } from "@/lib/db";
import { ATTENDANCE_TABLE, ensureAttendanceTable } from "@/lib/attendance-table";
import { performAutoClockOut, reconcileAutoClockOutsWithTPunch } from "@/lib/auto-clock-out";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let conn;
  try {
    const body = await req.json();
    const employeeId = String(body?.employee_id || "").trim();
    const action = String(body?.action || "").trim();

    if (!employeeId || !action) {
      return NextResponse.json({ success: false, error: "employee_id and action required" }, { status: 400 });
    }

    conn = await pool.getConnection();
    await ensureAttendanceTable(conn);

    const [openRows] = await conn.execute(
      `SELECT id, employee_name FROM ${ATTENDANCE_TABLE}
       WHERE employee_id = ? AND clock_out IS NULL
       ORDER BY clock_in DESC LIMIT 1`,
      [employeeId],
    );
    const open = (openRows as { id: number; employee_name?: string | null }[])[0];
    if (!open) {
      return NextResponse.json({ success: false, error: "No open session" }, { status: 400 });
    }

    if (action === "ack") {
      const ackAt = new Date().toISOString().slice(0, 19).replace("T", " ");
      await conn.execute(
        `UPDATE ${ATTENDANCE_TABLE} SET last_presence_ack_at = ? WHERE id = ?`,
        [ackAt, open.id],
      );
      return NextResponse.json({ success: true, message: "presence_ack" });
    }

    if (action === "auto_clock_out") {
      const out = await performAutoClockOut(
        conn,
        open.id,
        body?.employee_name || open.employee_name,
        undefined,
        employeeId,
      );

      // Also fix any recent auto-outs where T.Punch Out arrived after grace close
      try {
        await reconcileAutoClockOutsWithTPunch(conn, {
          lookbackDays: 7,
          employeeId,
        });
      } catch {
        /* non-fatal */
      }

      return NextResponse.json({
        success: true,
        message: "auto_clock_out",
        clock_out: out.clock_out,
        date: getDateStringInTimeZone(new Date(out.clock_out), SERVER_TIMEZONE),
      });
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
