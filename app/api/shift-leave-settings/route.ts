import { NextResponse, NextRequest } from "next/server";
import mysql from "mysql2/promise";

const dbConfig = {
  host: "localhost",
  user: "root",
  password: "",
  database: "interact_hrm"
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shift_id = searchParams.get("shift_id");
  const conn = await mysql.createConnection(dbConfig);
  const [rows] = await conn.execute("SELECT * FROM shift_leave_settings WHERE shift_id = ?", [shift_id]);
  await conn.end();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const conn = await mysql.createConnection(dbConfig);
  await conn.execute(
    `INSERT INTO shift_leave_settings (shift_id, auto_calculate, full_day_minutes, half_day_minutes, short_day_minutes, full_day_value, half_day_value, short_day_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.shift_id,
      body.auto_calculate,
      body.full_day_minutes,
      body.half_day_minutes,
      body.short_day_minutes,
      body.full_day_value,
      body.half_day_value,
      body.short_day_value
    ]
  );
  await conn.end();
  return NextResponse.json({ success: true });
}
