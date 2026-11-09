import { pool } from "@/lib/db";

export type AppActivityRow = {
  id: number;
  employeeId: string;
  employeeName: string | null;
  pseudonym: string | null;
  machineId: string | null;
  hostname: string | null;
  windowsUser: string | null;
  appName: string;
  appPath: string | null;
  caption: string | null;
  startedAt: string;
  lastSeenAt: string;
};

export type IngestAppActivityInput = {
  employeeId: string;
  employeeName?: string | null;
  pseudonym?: string | null;
  machineId?: string | null;
  hostname?: string | null;
  windowsUser?: string | null;
  appName: string;
  appPath?: string | null;
  caption?: string | null;
  at?: Date;
};

function trim(v: unknown, max: number): string {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v ?? ""));
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function mapRow(r: Record<string, unknown>): AppActivityRow {
  return {
    id: Number(r.id),
    employeeId: String(r.employee_id ?? ""),
    employeeName: r.employee_name != null ? String(r.employee_name) : null,
    pseudonym: r.pseudonym != null ? String(r.pseudonym) : null,
    machineId: r.machine_id != null ? String(r.machine_id) : null,
    hostname: r.hostname != null ? String(r.hostname) : null,
    windowsUser: r.windows_user != null ? String(r.windows_user) : null,
    appName: String(r.app_name ?? ""),
    appPath: r.app_path != null ? String(r.app_path) : null,
    caption: r.caption != null ? String(r.caption) : null,
    startedAt: toIso(r.started_at),
    lastSeenAt: toIso(r.last_seen_at),
  };
}

/**
 * Upsert open session: same employee+app+caption within last 2 min → extend last_seen.
 * Otherwise insert a new row (app/window switch).
 */
export async function ingestAppActivity(
  input: IngestAppActivityInput
): Promise<AppActivityRow> {
  const employeeId = trim(input.employeeId, 64);
  const appName = trim(input.appName, 255) || "Unknown";
  if (!employeeId) throw new Error("employee_id required");

  // Store caption as "" not NULL — IFNULL() breaks Mongo SQL adapter WHERE parsing.
  const caption = trim(input.caption, 512) || "";
  const at = input.at && Number.isFinite(input.at.getTime()) ? input.at : new Date();
  const employeeName = trim(input.employeeName, 255) || null;
  const pseudonym = trim(input.pseudonym, 255) || null;
  const machineId = trim(input.machineId, 128) || null;
  const hostname = trim(input.hostname, 255) || null;
  const windowsUser = trim(input.windowsUser, 255) || null;
  const appPath = trim(input.appPath, 512) || null;

  const windowStart = new Date(at.getTime() - 2 * 60 * 1000);
  const [openRows] = await pool.execute(
    `SELECT id FROM guard_app_activity
     WHERE employee_id = ?
       AND app_name = ?
       AND caption = ?
       AND last_seen_at >= ?
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [employeeId, appName, caption, windowStart]
  );
  const openId = (openRows as { id: number }[])[0]?.id;

  if (openId) {
    await pool.execute(
      `UPDATE guard_app_activity
       SET last_seen_at = ?,
           employee_name = COALESCE(?, employee_name),
           pseudonym = COALESCE(?, pseudonym),
           machine_id = COALESCE(?, machine_id),
           hostname = COALESCE(?, hostname),
           windows_user = COALESCE(?, windows_user),
           app_path = COALESCE(?, app_path)
       WHERE id = ?`,
      [
        at,
        employeeName,
        pseudonym,
        machineId,
        hostname,
        windowsUser,
        appPath,
        openId,
      ]
    );
    const [rows] = await pool.execute(
      `SELECT * FROM guard_app_activity WHERE id = ? LIMIT 1`,
      [openId]
    );
    return mapRow((rows as Record<string, unknown>[])[0] || { id: openId });
  }

  const [result] = await pool.execute(
    `INSERT INTO guard_app_activity
      (employee_id, employee_name, pseudonym, machine_id, hostname, windows_user,
       app_name, app_path, caption, started_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employeeId,
      employeeName,
      pseudonym,
      machineId,
      hostname,
      windowsUser,
      appName,
      appPath,
      caption,
      at,
      at,
    ]
  );
  const insertId = Number((result as { insertId?: number }).insertId || 0);
  const [rows] = await pool.execute(
    `SELECT * FROM guard_app_activity WHERE id = ? LIMIT 1`,
    [insertId]
  );
  return mapRow((rows as Record<string, unknown>[])[0] || { id: insertId });
}

export type ListAppActivityOpts = {
  employeeId?: string;
  appQuery?: string;
  search?: string;
  dateFrom?: string; // yyyy-MM-dd
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

/** Latest foreground app/window for an employee (for policy ticket context). */
export async function getLatestAppActivity(
  employeeId: string
): Promise<AppActivityRow | null> {
  const id = trim(employeeId, 64);
  if (!id) return null;
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM guard_app_activity
       WHERE employee_id = ?
       ORDER BY last_seen_at DESC, id DESC
       LIMIT 1`,
      [id]
    );
    const row = (rows as Record<string, unknown>[])[0];
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

export async function listAppActivity(
  opts: ListAppActivityOpts = {}
): Promise<{ rows: AppActivityRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(opts.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize || 50)));
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.employeeId?.trim()) {
    where.push("employee_id = ?");
    params.push(opts.employeeId.trim());
  }
  if (opts.appQuery?.trim()) {
    where.push("app_name LIKE ?");
    params.push(`%${opts.appQuery.trim()}%`);
  }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    where.push(
      "(employee_name LIKE ? OR pseudonym LIKE ? OR caption LIKE ? OR app_name LIKE ? OR hostname LIKE ?)"
    );
    params.push(q, q, q, q, q);
  }
  // Use Date objects — Mongo stores Date; string bounds match nothing.
  if (opts.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateFrom)) {
    where.push("started_at >= ?");
    params.push(new Date(`${opts.dateFrom}T00:00:00.000`));
  }
  if (opts.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateTo)) {
    where.push("started_at <= ?");
    params.push(new Date(`${opts.dateTo}T23:59:59.999`));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS c FROM guard_app_activity ${whereSql}`,
    params
  );
  const total = Number((countRows as { c: number }[])[0]?.c || 0);
  const offset = (page - 1) * pageSize;
  const [rows] = await pool.execute(
    `SELECT * FROM guard_app_activity ${whereSql}
     ORDER BY last_seen_at DESC, id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );
  return {
    rows: (rows as Record<string, unknown>[]).map(mapRow),
    total,
    page,
    pageSize,
  };
}
