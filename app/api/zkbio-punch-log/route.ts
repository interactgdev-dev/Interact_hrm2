import { NextRequest, NextResponse } from "next/server";
import { getDbDriver, pool } from "@/lib/db";
import {
  listZkbioPunchesNative,
  loadZkbioDepartmentNamesFast,
} from "@/lib/mongo-zkbio-punch-log";
import { loadZkbioDepartmentNames } from "@/lib/zkbio-departments";

export const runtime = "nodejs";

const COLUMNS = [
  "id",
  "log_id",
  "event_time",
  "pin",
  "first_name",
  "last_name",
  "event_name",
  "verify_mode",
  "device_name",
  "reader_name",
  "dept_name",
  "raw_json",
  "imported_at",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * GET /api/zkbio-punch-log?page=1&pageSize=100
 * Default: current calendar month.
 * Optional: dateFrom, dateTo, name, dept, timeFrom, timeTo.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const employeeReport = searchParams.get("employeeReport") === "1";
    const requestedSize = parseInt(searchParams.get("pageSize") || "100", 10) || 100;
    const pageSize = employeeReport
      ? Math.min(2000, Math.max(10, requestedSize))
      : Math.min(500, Math.max(10, requestedSize));

    const nameRaw = (searchParams.get("name") || searchParams.get("q") || "").trim();
    const dept = (searchParams.get("dept") || "").trim();
    let dateFrom = (searchParams.get("dateFrom") || "").trim();
    let dateTo = (searchParams.get("dateTo") || "").trim();
    const timeFrom = (searchParams.get("timeFrom") || "").trim();
    const timeTo = (searchParams.get("timeTo") || "").trim();

    // Always prefer an explicit month window — YEAR()/MONTH() scans hang on Mongo.
    if (!dateFrom && !dateTo) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
      dateFrom = `${y}-${m}-01`;
      dateTo = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
    }

    if (dateFrom && !DATE_RE.test(dateFrom)) {
      return NextResponse.json({ success: false, error: "Invalid dateFrom (use YYYY-MM-DD)" }, { status: 400 });
    }
    if (dateTo && !DATE_RE.test(dateTo)) {
      return NextResponse.json({ success: false, error: "Invalid dateTo (use YYYY-MM-DD)" }, { status: 400 });
    }
    if (timeFrom && !TIME_RE.test(timeFrom)) {
      return NextResponse.json({ success: false, error: "Invalid timeFrom (use HH:MM)" }, { status: 400 });
    }
    if (timeTo && !TIME_RE.test(timeTo)) {
      return NextResponse.json({ success: false, error: "Invalid timeTo (use HH:MM)" }, { status: 400 });
    }

    if (getDbDriver() === "mongo") {
      const { rows, total } = await listZkbioPunchesNative({
        page,
        pageSize,
        name: nameRaw || undefined,
        dept: dept || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        timeFrom: timeFrom || undefined,
        timeTo: timeTo || undefined,
      });
      const departments = await loadZkbioDepartmentNamesFast();
      return NextResponse.json({
        success: true,
        columns: [...COLUMNS],
        rows,
        total,
        page,
        pageSize,
        departments,
      });
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (dateFrom) {
      conditions.push(`DATE(COALESCE(event_time, imported_at)) >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`DATE(COALESCE(event_time, imported_at)) <= ?`);
      params.push(dateTo);
    }
    if (nameRaw) {
      const core = nameRaw.replace(/[%_\\]/g, " ").trim();
      if (core) {
        const like = `%${core}%`;
        conditions.push(
          `(CONCAT(IFNULL(first_name,''), ' ', IFNULL(last_name,'')) LIKE ? OR first_name LIKE ? OR last_name LIKE ?)`,
        );
        params.push(like, like, like);
      }
    }
    if (dept) {
      conditions.push(`dept_name = ?`);
      params.push(dept);
    }
    if (timeFrom) {
      const t = timeFrom.length === 5 ? `${timeFrom}:00` : timeFrom;
      conditions.push(`TIME(COALESCE(event_time, imported_at)) >= ?`);
      params.push(t);
    }
    if (timeTo) {
      const t = timeTo.length === 5 ? `${timeTo}:59` : timeTo;
      conditions.push(`TIME(COALESCE(event_time, imported_at)) <= ?`);
      params.push(t);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const colListZ = COLUMNS.map((c) => `z.${c}`).join(", ");
    const groupCols = `COALESCE(NULLIF(TRIM(z.log_id), ''), CONCAT(IFNULL(z.pin,''), '|', DATE_FORMAT(COALESCE(z.event_time, z.imported_at), '%Y-%m-%d %H:%i:%s')))`;
    const dedupInnerFixed = `SELECT MIN(z.id) AS mid FROM zkbio_punch_log z ${whereSql} GROUP BY ${groupCols}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM (${dedupInnerFixed}) AS deduped`,
      params,
    );
    const total = Number((countRows as { c: number }[])[0]?.c ?? 0);

    const offset = (page - 1) * pageSize;
    const [rows] = await pool.query(
      `SELECT ${colListZ} FROM zkbio_punch_log z
       INNER JOIN (${dedupInnerFixed}) k ON z.id = k.mid
       ORDER BY COALESCE(z.event_time, z.imported_at) DESC, z.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const departments = await loadZkbioDepartmentNamesFast().catch(() =>
      loadZkbioDepartmentNames(),
    );

    return NextResponse.json({
      success: true,
      columns: [...COLUMNS],
      rows: rows as Record<string, unknown>[],
      total,
      page,
      pageSize,
      departments,
    });
  } catch (e) {
    const msg = String(e);
    return NextResponse.json(
      {
        success: false,
        error: msg,
        hint:
          msg.includes("doesn't exist") || msg.includes("Unknown table")
            ? "Create table zkbio_punch_log or run your DB migration."
            : undefined,
      },
      { status: 500 },
    );
  }
}
