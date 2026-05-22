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
  const [rows] = await conn.execute("SELECT * FROM shift_working_days WHERE shift_id = ?", [shift_id]);
  await conn.end();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const conn = await mysql.createConnection(dbConfig);
  await conn.execute(
    `INSERT INTO shift_working_days (shift_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.shift_id,
      body.monday,
      body.tuesday,
      body.wednesday,
      body.thursday,
      body.friday,
      body.saturday,
      body.sunday
    ]
  );
  await conn.end();
  return NextResponse.json({ success: true });
}
