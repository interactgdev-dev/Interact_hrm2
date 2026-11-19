import fs from "fs/promises";
import path from "path";
import { query } from "@/lib/db";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

export const ADMIN_ACTOR_COOKIE = "hrm_admin_actor";

const ROOT = path.join(process.cwd(), "logs", "admin-activity");

export type ActivityActorProfile = {
  employee_id: string | null;
  employee_name: string | null;
  pseudonym: string | null;
  employee_code: string | null;
};

function dayStamp(d = new Date()) {
  return getDateStringInTimeZone(d, SERVER_TIMEZONE);
}

function safeName(name: string) {
  return String(name || "file")
    .replace(/[^\w.\-()+ ]+/g, "_")
    .slice(0, 120);
}

/** Resolve employee id / name / pseudonym / code for backlog rows. */
export async function resolveActivityActor(opts: {
  employeeId?: string | null;
  loginId?: string | null;
}): Promise<ActivityActorProfile> {
  const empty: ActivityActorProfile = {
    employee_id: null,
    employee_name: null,
    pseudonym: null,
    employee_code: null,
  };
  const eid = String(opts.employeeId || "").trim();
  const login = String(opts.loginId || "").trim();
  const keys = [eid, login].filter(Boolean);
  if (!keys.length) return empty;

  try {
    for (const key of keys) {
      const keyLower = key.toLowerCase();
      const [rows]: any = await query(
        `SELECT e.id, e.first_name, e.last_name, TRIM(e.pseudonym) AS pseudonym, e.employee_code
         FROM hrm_employees e
         LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
         WHERE CAST(e.id AS CHAR) = ?
            OR e.employee_code = ?
            OR LOWER(TRIM(e.username)) = ?
            OR LOWER(TRIM(ec.email_work)) = ?
         LIMIT 1`,
        [key, key, keyLower, keyLower],
      );
      const r = Array.isArray(rows) ? rows[0] : null;
      if (!r) continue;
      const name = `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;
      return {
        employee_id: String(r.id),
        employee_name: name,
        pseudonym:
          typeof r.pseudonym === "string" && r.pseudonym.trim()
            ? r.pseudonym.trim()
            : null,
        employee_code: r.employee_code != null ? String(r.employee_code) : null,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    ...empty,
    employee_id: eid || null,
    employee_name: login || null,
    employee_code: login || null,
  };
}

async function lookupHostnameByIp(ip: string | null | undefined): Promise<string | null> {
  const addr = String(ip || "").trim();
  if (!addr || addr === "127.0.0.1" || addr === "::1") return null;
  try {
    const [rows]: any = await query(
      `SELECT hostname FROM presence_agents
       WHERE last_ip = ? AND hostname IS NOT NULL AND TRIM(hostname) <> ''
       ORDER BY last_seen_at DESC LIMIT 1`,
      [addr],
    );
    const host = rows?.[0]?.hostname;
    return typeof host === "string" && host.trim() ? host.trim() : null;
  } catch {
    return null;
  }
}

async function insertBacklogRow(row: Record<string, unknown>) {
  try {
    await query(
      `INSERT INTO hrm_activity_backlog
        (event_ts, day_key, event_type, employee_id, employee_name, pseudonym, employee_code, hostname,
         login_id, page_path, detail, method, url, file_name, file_bytes, saved_path, ip, user_agent, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.event_ts,
        row.day_key,
        row.event_type,
        row.employee_id,
        row.employee_name,
        row.pseudonym,
        row.employee_code,
        row.hostname,
        row.login_id,
        row.page_path,
        row.detail,
        row.method,
        row.url,
        row.file_name,
        row.file_bytes,
        row.saved_path,
        row.ip,
        row.user_agent,
        row.payload_json,
      ],
    );
  } catch {
    /* table/column may not exist yet — JSONL still written */
  }
}

/** Append one JSON line + DB backlog row. */
export async function appendAdminActivity(event: Record<string, unknown>) {
  try {
    const now = new Date();
    const day = dayStamp(now);
    const loginId = String(event.loginId || event.login_id || "").trim() || null;
    const employeeIdHint = String(
      event.employeeId || event.employee_id || "",
    ).trim();
    const actor = await resolveActivityActor({
      employeeId: employeeIdHint,
      loginId,
    });
    const nameHint = String(
      event.employee_name_hint || event.employeeName || event.employee_name || "",
    ).trim();
    const employeeName =
      actor.employee_name || (nameHint ? nameHint.slice(0, 150) : null);

    const type = String(event.type || "event");
    const page = String(event.page || event.page_path || "").slice(0, 512) || null;
    const detail = String(
      event.detail || event.label || event.description || "",
    ).slice(0, 2000) || null;
    const method = event.method != null ? String(event.method).slice(0, 16) : null;
    const url = event.url != null ? String(event.url).slice(0, 512) : null;
    const fileName =
      event.original_name != null
        ? String(event.original_name).slice(0, 255)
        : event.file_name != null
          ? String(event.file_name).slice(0, 255)
          : Array.isArray(event.files) &&
              (event.files as { name?: string }[])[0]?.name
            ? String((event.files as { name?: string }[])[0].name).slice(0, 255)
            : null;
    const fileBytes =
      typeof event.bytes === "number"
        ? event.bytes
        : typeof event.file_bytes === "number"
          ? event.file_bytes
          : null;
    const savedPath =
      event.saved_path != null
        ? String(event.saved_path).slice(0, 512)
        : event.saved_as != null
          ? String(event.saved_as).slice(0, 512)
          : null;

    const ip =
      event.ip != null ? String(event.ip).trim().slice(0, 64) || null : null;
    let hostname =
      String(event.hostname || event.machine_name || event.pc_name || "")
        .trim()
        .slice(0, 255) || null;
    if (!hostname) {
      hostname = await lookupHostnameByIp(ip);
    }

    const row = {
      ts: now.toISOString(),
      day,
      tz: SERVER_TIMEZONE,
      ...event,
      loginId,
      employee_id: actor.employee_id,
      employee_name: employeeName,
      pseudonym: actor.pseudonym,
      employee_code: actor.employee_code,
      hostname,
    };

    await fs.mkdir(ROOT, { recursive: true });
    await fs.appendFile(
      path.join(ROOT, `${day}.jsonl`),
      `${JSON.stringify(row)}\n`,
      "utf8",
    );

    let payloadJson: string | null = null;
    try {
      payloadJson = JSON.stringify(event);
    } catch {
      payloadJson = null;
    }

    await insertBacklogRow({
      event_ts: now.toISOString().slice(0, 23).replace("T", " "),
      day_key: day,
      event_type: type.slice(0, 64),
      employee_id: actor.employee_id,
      employee_name: employeeName,
      pseudonym: actor.pseudonym,
      employee_code: actor.employee_code,
      hostname,
      login_id: loginId,
      page_path: page,
      detail,
      method,
      url,
      file_name: fileName,
      file_bytes: fileBytes,
      saved_path: savedPath,
      ip,
      user_agent: event.ua != null ? String(event.ua).slice(0, 512) : null,
      payload_json: payloadJson,
    });
  } catch {
    // never break the app for logging
  }
}

export const ACTIVITY_FILES_ROOT = path.join(ROOT, "files");

/** Resolve a stored backlog file path safely (must stay under logs/admin-activity/files). */
export function resolveActivitySavedFile(
  savedPath: string,
): { abs: string; fileName: string } | null {
  const raw = String(savedPath || "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  const prefix = "logs/admin-activity/files/";
  if (!raw.startsWith(prefix) || raw.includes("..")) return null;
  const rel = raw.slice(prefix.length);
  const abs = path.resolve(ACTIVITY_FILES_ROOT, rel);
  const rootAbs = path.resolve(ACTIVITY_FILES_ROOT);
  if (!abs.startsWith(rootAbs + path.sep) && abs !== rootAbs) return null;
  return { abs, fileName: path.basename(abs) };
}

/** Copy an uploaded/downloaded buffer under logs/admin-activity/files/YYYY-MM-DD/ */
export async function backupAdminActivityFile(
  originalName: string,
  data: Buffer,
  meta?: Record<string, unknown>,
): Promise<string | null> {
  try {
    const day = dayStamp();
    const dir = path.join(ROOT, "files", day);
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const stored = `${stamp}_${safeName(originalName)}`;
    const abs = path.join(dir, stored);
    await fs.writeFile(abs, data);
    const relative = `logs/admin-activity/files/${day}/${stored}`;
    const type = String(meta?.type || "file_backup").slice(0, 64);
    await appendAdminActivity({
      ...meta,
      type,
      original_name: originalName,
      file_name: originalName,
      saved_as: relative,
      saved_path: relative,
      bytes: data.length,
      file_bytes: data.length,
      detail:
        String(meta?.detail || meta?.label || "").trim() ||
        `${type === "download" ? "Downloaded" : "Uploaded"} file "${originalName}" (${data.length} B)`,
    });
    return relative;
  } catch {
    return null;
  }
}

export type BacklogListOpts = {
  search?: string;
  eventType?: string;
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export async function listActivityBacklog(opts: BacklogListOpts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 50));
  const offset = (page - 1) * pageSize;
  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (opts.dateFrom) {
    where.push("day_key >= ?");
    params.push(opts.dateFrom.slice(0, 10));
  }
  if (opts.dateTo) {
    where.push("day_key <= ?");
    params.push(opts.dateTo.slice(0, 10));
  }
  if (opts.eventType) {
    where.push("event_type = ?");
    params.push(opts.eventType);
  }
  if (opts.employeeId) {
    where.push("(employee_id = ? OR employee_code = ?)");
    params.push(opts.employeeId, opts.employeeId);
  }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    where.push(
      `(employee_name LIKE ? OR pseudonym LIKE ? OR employee_code LIKE ? OR employee_id LIKE ? OR hostname LIKE ? OR detail LIKE ? OR page_path LIKE ? OR url LIKE ? OR file_name LIKE ?)`,
    );
    params.push(q, q, q, q, q, q, q, q, q);
  }

  const whereSql = where.join(" AND ");
  const [countRows]: any = await query(
    `SELECT COUNT(*) AS c FROM hrm_activity_backlog WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows?.[0]?.c || 0);

  const [rows]: any = await query(
    `SELECT id, event_ts, day_key, event_type, employee_id, employee_name, pseudonym,
            employee_code, hostname, login_id, page_path, detail, method, url,
            file_name, file_bytes, saved_path, ip
     FROM hrm_activity_backlog
     WHERE ${whereSql}
     ORDER BY event_ts DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  return {
    rows: Array.isArray(rows) ? rows : [],
    total,
    page,
    pageSize,
  };
}

export async function getActivityBacklogById(id: number) {
  const [rows]: any = await query(
    `SELECT id, event_type, file_name, saved_path, file_bytes
     FROM hrm_activity_backlog WHERE id = ? LIMIT 1`,
    [id],
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

type RequestLike = {
  headers: { get(name: string): string | null };
  cookies?: { get(name: string): { value: string } | undefined };
};

/**
 * Server-side backlog row for attendance / break mutations.
 * Client probe can miss events (old tabs, WebView, sendBeacon drops) — this is authoritative.
 */
export async function logServerEmployeeActivity(
  req: RequestLike | null | undefined,
  opts: {
    type: string;
    employeeId?: string | number | null;
    employeeName?: string | null;
    loginId?: string | null;
    detail: string;
    page?: string | null;
    method?: string | null;
    url?: string | null;
  },
) {
  try {
    const ip =
      req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req?.headers.get("x-real-ip") ||
      null;
    const ua = req?.headers.get("user-agent") || null;
    const cookieLogin =
      req?.cookies?.get?.(ADMIN_ACTOR_COOKIE)?.value?.trim() || "";
    const headerLogin = req?.headers.get("x-login-id")?.trim() || "";
    const headerEmp =
      req?.headers.get("x-hrm-employee-id")?.trim() ||
      req?.headers.get("x-employee-id")?.trim() ||
      "";

    await appendAdminActivity({
      type: opts.type,
      employeeId: String(opts.employeeId ?? headerEmp ?? "").trim(),
      loginId: String(
        opts.loginId || cookieLogin || headerLogin || "",
      ).trim(),
      detail: opts.detail,
      label: opts.detail,
      page: opts.page || undefined,
      method: opts.method || "POST",
      url: opts.url || undefined,
      ip,
      ua,
      source: "server",
      // Prefer explicit name when actor resolve fails (email/login lookups).
      employee_name_hint: opts.employeeName || undefined,
    });
  } catch {
    /* never break the mutation */
  }
}
