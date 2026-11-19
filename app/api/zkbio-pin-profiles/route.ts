import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/zkbio-pin-profiles
 * Latest punch row per PIN that has a name or department (for Tungsten identity backfill).
 */
export async function GET() {
  try {
    const [rows] = await pool.query(
      `SELECT z.pin, z.first_name, z.last_name, z.dept_name
       FROM zkbio_punch_log z
       INNER JOIN (
         SELECT pin, MAX(id) AS max_id
         FROM zkbio_punch_log
         WHERE TRIM(COALESCE(pin, '')) <> ''
           AND (
             TRIM(COALESCE(first_name, '')) <> ''
             OR TRIM(COALESCE(last_name, '')) <> ''
             OR TRIM(COALESCE(dept_name, '')) <> ''
           )
         GROUP BY pin
       ) latest ON z.id = latest.max_id`,
    );

    return NextResponse.json({
      success: true,
      profiles: (rows as Record<string, unknown>[]).map((r) => ({
        pin: String(r.pin || "").trim(),
        first_name: r.first_name,
        last_name: r.last_name,
        dept_name: r.dept_name,
      })),
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
