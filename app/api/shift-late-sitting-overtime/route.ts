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
  const [rows] = await conn.execute("SELECT * FROM shift_late_sitting_overtime WHERE shift_id = ?", [shift_id]);
  await conn.end();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const conn = await mysql.createConnection(dbConfig);
  await conn.execute(
    `INSERT INTO shift_late_sitting_overtime (shift_id, late_sitting_time, late_sitting_minutes, overtime_per_month, overtime_per_day) VALUES (?, ?, ?, ?, ?)`,
    [
      body.shift_id,
      body.late_sitting_time,
      body.late_sitting_minutes,
      body.overtime_per_month,
      body.overtime_per_day
    ]
  );
  await conn.end();
  return NextResponse.json({ success: true });
}
