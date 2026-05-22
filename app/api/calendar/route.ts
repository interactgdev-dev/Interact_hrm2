import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";

const CALENDAR_TABLE = "company_calendar_days";

async function ensureCalendarTable(conn: any) {
  const createSql = `
    CREATE TABLE IF NOT EXISTS ${CALENDAR_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL,
      note VARCHAR(255) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await conn.execute(createSql);
}

function formatLocalDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseMonthRange(month: string) {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const from = formatLocalDate(start);
  const to = formatLocalDate(end);
  return { from, to };
}

export async function GET(req: NextRequest) {
  let conn;
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    conn = await pool.getConnection();
    await ensureCalendarTable(conn);

    let rangeFrom = from;
    let rangeTo = to;

    if (!rangeFrom || !rangeTo) {
      if (!month) {
        return NextResponse.json({ success: false, error: "Missing month or date range" }, { status: 400 });
      }
      const range = parseMonthRange(month);
      rangeFrom = range.from;
      rangeTo = range.to;
    }

    const [rows] = await conn.execute(
      `SELECT date, status, note FROM ${CALENDAR_TABLE} WHERE date BETWEEN ? AND ? ORDER BY date ASC`,
      [rangeFrom, rangeTo]
    );
    const formattedDays = (rows as any[]).map((row) => ({
      ...row,
      date: row.date ? formatLocalDate(row.date) : row.date
    }));

    return NextResponse.json({ success: true, days: formattedDays });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("GET calendar error:", error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(req: NextRequest) {
  let conn;
  try {
    const data = await req.json();
    const { date, status, note } = data || {};

    if (!date || !status) {
      return NextResponse.json({ success: false, error: "Missing date or status" }, { status: 400 });
    }

    if (status !== "off" && status !== "working") {
      return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
    }

    conn = await pool.getConnection();
    await ensureCalendarTable(conn);

    await conn.execute(
      `INSERT INTO ${CALENDAR_TABLE} (date, status, note)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note)`,
      [date, status, note || null]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("POST calendar error:", error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
