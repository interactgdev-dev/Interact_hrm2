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
  const [rows] = await conn.execute("SELECT * FROM shift_late_early_relaxation WHERE shift_id = ?", [shift_id]);
  await conn.end();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const conn = await mysql.createConnection(dbConfig);
  await conn.execute(
    `INSERT INTO shift_late_early_relaxation (shift_id, daily_late_minutes, daily_early_minutes, monthly_late_minutes, monthly_early_minutes, monthly_special_late_relax, minutes_one_time_late, no_late_without_special, day_to_deduct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.shift_id,
      body.daily_late_minutes,
      body.daily_early_minutes,
      body.monthly_late_minutes,
      body.monthly_early_minutes,
      body.monthly_special_late_relax,
      body.minutes_one_time_late,
      body.no_late_without_special,
      body.day_to_deduct
    ]
  );
  await conn.end();
  return NextResponse.json({ success: true });
}
