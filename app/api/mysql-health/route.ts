import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const TABLE = "hrm_mysql_health";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    const [dbRows] = await pool.query("SELECT DATABASE() AS db");
    const dbName = String((dbRows as { db: string }[])[0]?.db || process.env.DB_NAME || "interact_hrm");

    const [countRows] = await pool.query(`SELECT COUNT(*) AS c FROM ${TABLE}`);
    const total = Number((countRows as { c: number }[])[0]?.c ?? 0);

    const [rows] = await pool.query(
      `SELECT id, employee_id, employee_name, note, created_at
       FROM ${TABLE}
       ORDER BY id DESC
       LIMIT 20`,
    );

    return NextResponse.json({
      ok: true,
      driver: "mysql",
      ping: true,
      db: dbName,
      table: TABLE,
      total,
      rows,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        driver: "mysql",
        ping: false,
        error: errMsg,
        hint:
          errMsg.includes("doesn't exist") || errMsg.includes("Unknown table")
            ? "Run migrations so table hrm_mysql_health exists (025_mysql_health_check.sql)."
            : undefined,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const employee_id = String(body.employee_id || "").slice(0, 64);
    const employee_name = String(body.employee_name || "Employee").slice(0, 255);
    const note = String(body.note || "MySQL write OK").slice(0, 500);

    const [result] = await pool.query(
      `INSERT INTO ${TABLE} (employee_id, employee_name, note) VALUES (?, ?, ?)`,
      [employee_id, employee_name, note],
    );
    const insertId = Number((result as { insertId?: number }).insertId || 0);

    return NextResponse.json({
      ok: true,
      insertedId: insertId,
      row: { id: insertId, employee_id, employee_name, note },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
  }
}
