/**
 * Secure incremental MySQL (10.40) → MongoDB (10.98) sync.
 * Streams rows in batches (no dump files). Upserts by `id` when present.
 *
 * Usage:
 *   node scripts/mysql-mongo-incremental-sync.mjs --dry-run --since=2026-08-14
 *   node scripts/mysql-mongo-incremental-sync.mjs --since=2026-08-14
 *   node scripts/mysql-mongo-incremental-sync.mjs --since=2026-08-14 --daily
 *
 * Env:
 *   MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE
 *   MONGO_URI MONGO_DB
 *   Or --mysql-env=/path/to/creds.env for DB_* keys
 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { MongoClient, Binary, Decimal128, Long } from "mongodb";

function loadEnvFile(file, target) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    target[key] = val;
  }
}

const cwd = process.cwd();
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const DAILY = args.includes("--daily");
const sinceArg = args.find((a) => a.startsWith("--since="));
const mysqlEnvArg = args.find((a) => a.startsWith("--mysql-env="));
const skipArg = args.find((a) => a.startsWith("--skip="));
const onlyArg = args.find((a) => a.startsWith("--only="));

const SINCE = sinceArg ? sinceArg.slice("--since=".length) : "2026-08-14";
const SKIP = new Set(
  (skipArg ? skipArg.slice("--skip=".length) : "schema_migrations")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const ONLY = onlyArg
  ? new Set(
      onlyArg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

const env = { ...process.env };
loadEnvFile(path.join(cwd, ".env.local"), env);
loadEnvFile(path.join(cwd, ".env"), env);
if (mysqlEnvArg) {
  loadEnvFile(mysqlEnvArg.slice("--mysql-env=".length), env);
}

// Tunnel / runner overrides win over .env.local
if (process.env.SYNC_MYSQL_HOST) env.MYSQL_HOST = process.env.SYNC_MYSQL_HOST;
if (process.env.SYNC_MYSQL_PORT) env.MYSQL_PORT = process.env.SYNC_MYSQL_PORT;
if (process.env.SYNC_MYSQL_USER) env.MYSQL_USER = process.env.SYNC_MYSQL_USER;
if (Object.prototype.hasOwnProperty.call(process.env, "SYNC_MYSQL_PASSWORD")) {
  env.MYSQL_PASSWORD = process.env.SYNC_MYSQL_PASSWORD;
}
if (process.env.SYNC_MONGO_URI) env.MONGO_URI = process.env.SYNC_MONGO_URI;
if (process.env.SYNC_MONGO_DB) env.MONGO_DB = process.env.SYNC_MONGO_DB;

const UPSERT_KEYS = {
  zkbio_punch_log: ["log_id"],
  hrm_profile_pictures: ["subject_type", "subject_id"],
  hrm_org_chart_photos: ["subject_type", "subject_id"],
  hrm_saved_logins: ["device_key", "login_id"],
  hrm_tardy_notes: ["attendance_id"],
  monthly_payroll_adjustments: ["employee_id", "month"],
  employee_leave_allowances: ["employee_id"],
  loan_records: ["employee_id", "month"],
  employee_commissions: ["employee_id", "year", "month_number"],
};

const BATCH = 500;
const DATE_PRIORITY = [
  "updated_at",
  "created_at",
  "requested_at",
  "event_time",
  "punch_time",
  "attendance_date",
  "uploaded_at",
  "assigned_at",
  "assigned_date",
  "leave_date",
  "date",
];

/** Not useful for "rows changed since DATE" — personal/static dates. */
const DATE_EXCLUDE = new Set([
  "cnic_issuance_date",
  "cnic_expiry_date",
  "date_of_birth",
  "dob",
  "joined_date",
  "joining_date",
  "resignation_date",
  "start_date",
  "end_date",
  "month",
]);

function mysqlConfig() {
  return {
    host: env.MYSQL_HOST || env.DB_HOST || "127.0.0.1",
    port: parseInt(env.MYSQL_PORT || env.DB_PORT || "3306", 10),
    user: env.MYSQL_USER || env.DB_USER || "root",
    password: Object.prototype.hasOwnProperty.call(env, "MYSQL_PASSWORD")
      ? env.MYSQL_PASSWORD
      : env.DB_PASSWORD || "",
    database: env.MYSQL_DATABASE || env.DB_NAME || "interact_hrm",
    // Always strings — we attach Asia/Karachi (+05:00) ourselves so host TZ
    // (UTC on 10.98 vs PKT on 10.40/Windows) cannot shift wall-clock times.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectTimeout: 20000,
  };
}

const MONGO_URI = env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = env.MONGO_DB || env.DB_NAME || "interact_hrm";

/** MySQL DATE = calendar day string (YYYY-MM-DD).
 *  Most DATETIME/TIMESTAMP on 10.40 already store UTC wall digits (clock_in, etc.)
 *  → treat as `…Z`.
 *  Exception: zkbio_punch_log.event_time is Asia/Karachi wall in MySQL DATETIME
 *  (same digits as raw_json.eventTime) → must use +05:00 or T.Punch out breaks.
 *  DATE-only must stay a string — BSON Date at Karachi midnight becomes prior
 *  UTC day and leaves stale string-date duplicates side-by-side. */
function mysqlUtcWallToDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/,
  );
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? s : fallback;
}

/** ZKBio device time: Karachi wall string → true UTC instant. */
function mysqlKarachiWallToDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/,
  );
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}+05:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? s : fallback;
}

function convertValue(value, table, field) {
  if (value == null) return null;
  if (typeof value === "bigint") {
    if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
      return Number(value);
    }
    return Long.fromString(value.toString());
  }
  if (Buffer.isBuffer(value)) return new Binary(value);
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    // MySQL dateStrings path
    if (
      /^\d{4}-\d{2}-\d{2}/.test(value) &&
      (value.length === 10 || value.includes(":") || value.includes("T"))
    ) {
      if (table === "zkbio_punch_log" && field === "event_time") {
        return mysqlKarachiWallToDate(value);
      }
      return mysqlUtcWallToDate(value);
    }
  }
  if (typeof value === "object" && value.constructor?.name === "Decimal") {
    try {
      return Decimal128.fromString(String(value));
    } catch {
      return String(value);
    }
  }
  return value;
}

function convertRow(row, table) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = coerceKeyValue(key, convertValue(value, table, key));
  }
  return out;
}

/** Keep upsert keys numeric so 97 and "97" cannot insert as two rows. */
function coerceKeyValue(field, value) {
  if (value == null) return value;
  if (
    field === "id" ||
    field.endsWith("_id") ||
    field === "log_id" ||
    field === "subject_id"
  ) {
    if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  }
  return value;
}

function upsertFilter(table, doc) {
  const keyFields = UPSERT_KEYS[table] || ["id"];
  const filter = {};
  for (const k of keyFields) {
    filter[k] = coerceKeyValue(k, doc[k]);
  }
  return filter;
}

async function tableColumns(conn, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS dtype, COLUMN_KEY AS ckey
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table],
  );
  return rows;
}

function pickDateColumn(cols) {
  const dateTypes = new Set(["date", "datetime", "timestamp"]);
  for (const pref of DATE_PRIORITY) {
    const hit = cols.find(
      (c) =>
        c.name === pref &&
        dateTypes.has(c.dtype) &&
        !DATE_EXCLUDE.has(c.name),
    );
    if (hit) return hit.name;
  }
  const any = cols.find(
    (c) => dateTypes.has(c.dtype) && !DATE_EXCLUDE.has(c.name),
  );
  return any ? any.name : null;
}

function hasId(cols) {
  return cols.some((c) => c.name === "id");
}

async function countFiltered(conn, table, dateCol) {
  if (dateCol) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${dateCol}\` >= ?`,
      [SINCE],
    );
    return Number(rows[0]?.n || 0);
  }
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number(rows[0]?.n || 0);
}

async function syncTable(mysqlConn, mongoDb, table) {
  const cols = await tableColumns(mysqlConn, table);
  const dateCol = pickDateColumn(cols);
  const idOk = hasId(cols);
  const col = mongoDb.collection(table);

  let mode = "full-upsert";
  let whereSql = "";
  let whereParams = [];
  let total = 0;

  if (dateCol) {
    mode = `date:${dateCol}>==${SINCE}`;
    whereSql = `WHERE \`${dateCol}\` >= ?`;
    whereParams = [SINCE];
    total = await countFiltered(mysqlConn, table, dateCol);
  } else if (idOk) {
    // No reliable event-date: for small tables, full upsert by id (catches updates).
    // For large tables, only new ids after mongo max(id).
    const [allCountRows] = await mysqlConn.query(
      `SELECT COUNT(*) AS n FROM \`${table}\``,
    );
    const allCount = Number(allCountRows[0]?.n || 0);
    if (allCount <= 5000) {
      mode = "full-upsert-by-id";
      whereSql = "";
      whereParams = [];
      total = allCount;
    } else {
      const maxDoc = await col
        .find({ id: { $exists: true } })
        .sort({ id: -1 })
        .limit(1)
        .next();
      const maxId = maxDoc?.id != null ? Number(maxDoc.id) : 0;
      mode = `id>${maxId}`;
      whereSql = `WHERE \`id\` > ?`;
      whereParams = [maxId];
      const [rows] = await mysqlConn.query(
        `SELECT COUNT(*) AS n FROM \`${table}\` ${whereSql}`,
        whereParams,
      );
      total = Number(rows[0]?.n || 0);
    }
  } else {
    mode = "full-no-id";
    total = await countFiltered(mysqlConn, table, null);
  }

  const result = {
    table,
    mode,
    sourceRows: total,
    upserted: 0,
    skipped: false,
  };

  console.log(`  ${table}: ${total} rows [${mode}]${DRY ? " (dry-run)" : ""}`);
  if (DRY || total === 0) return result;

  if (idOk) {
    await col.createIndex({ id: 1 }, { unique: false }).catch(() => {});
  }

  let offset = 0;
  while (offset < total) {
    const [rows] = await mysqlConn.query(
      `SELECT * FROM \`${table}\` ${whereSql} ORDER BY ${idOk ? "`id`" : "1"} LIMIT ? OFFSET ?`,
      [...whereParams, BATCH, offset],
    );
    if (!rows.length) break;
    const docs = rows.map((row) => convertRow(row, table));

    if (idOk || UPSERT_KEYS[table]) {
      const ops = docs.map((doc) => ({
        updateOne: {
          filter: upsertFilter(table, doc),
          update: { $set: doc },
          upsert: true,
        },
      }));
      const res = await col.bulkWrite(ops, { ordered: false });
      result.upserted +=
        (res.upsertedCount || 0) +
        (res.modifiedCount || 0) +
        (res.matchedCount || 0);
    } else {
      // No stable id: insert only if collection empty-ish — use replace-by-all-fields hash skip
      await col.insertMany(docs, { ordered: false }).catch(async (err) => {
        if (err?.code !== 11000) throw err;
      });
      result.upserted += docs.length;
    }

    offset += BATCH;
    process.stdout.write(`\r    wrote ~${Math.min(offset, total)}/${total}`);
  }
  if (total > 0) process.stdout.write("\n");

  // Drop Mongo-only rows in this date window (stale Tungsten/import ghosts)
  // so monthly totals don't double-count alongside upserted MySQL ids.
  if (
    !DRY &&
    dateCol &&
    idOk &&
    total > 0 &&
    (table === "employee_attendance" ||
      table === "breaks" ||
      table === "prayer_breaks" ||
      table === "zkbio_punch_log")
  ) {
    const idField = table === "zkbio_punch_log" ? "log_id" : "id";
    const [srcIdRows] = await mysqlConn.query(
      `SELECT \`${idField}\` AS sid FROM \`${table}\` ${whereSql}`,
      whereParams,
    );
    const keep = new Set(
      srcIdRows
        .map((r) => r.sid)
        .filter((v) => v != null && v !== "")
        .map((v) => (typeof v === "number" ? v : String(v))),
    );
    const today = new Date().toISOString().slice(0, 10);
    // Inline day range (string dates + padded BSON) — same idea as flexibleDayRangeFilter
    const start = SINCE;
    const end = today;
    const padStart = new Date(new Date(`${start}T00:00:00+05:00`).getTime() - 36 * 3600000);
    const padEnd = new Date(new Date(`${end}T23:59:59+05:00`).getTime() + 36 * 3600000);
    const dateFields =
      table === "zkbio_punch_log"
        ? ["event_time"]
        : table === "employee_attendance"
          ? ["date", "clock_in"]
          : ["date"];
    const or = [];
    for (const field of dateFields) {
      or.push({ [field]: { $gte: start, $lte: end } });
      or.push({ [field]: { $gte: padStart, $lt: padEnd } });
    }
    const candidates = await col
      .find({ $or: or }, { projection: { [idField]: 1 } })
      .toArray();
    const orphanIds = [];
    for (const doc of candidates) {
      const raw = doc[idField];
      if (raw == null || raw === "") continue;
      const key = typeof raw === "number" ? raw : String(raw);
      const alt = typeof raw === "number" ? String(raw) : Number(raw);
      if (keep.has(key) || (alt !== "" && !Number.isNaN(alt) && keep.has(alt))) {
        continue;
      }
      orphanIds.push(raw);
    }
    if (orphanIds.length) {
      const del = await col.deleteMany({ [idField]: { $in: orphanIds } });
      console.log(`    pruned ${del.deletedCount} orphan ${table} row(s)`);
      result.pruned = del.deletedCount;
    }
  }

  return result;
}

async function main() {
  const cfg = mysqlConfig();
  console.log("[sync] MySQL", `${cfg.host}:${cfg.port}/${cfg.database} as ${cfg.user}`);
  console.log("[sync] Mongo", MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@"), MONGO_DB);
  console.log("[sync] since", SINCE, DRY ? "DRY-RUN" : "WRITE", DAILY ? "(daily mode flag)" : "");

  const mysqlConn = await mysql.createConnection(cfg);
  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const mongoDb = mongo.db(MONGO_DB);

  try {
    const [tables] = await mysqlConn.query(
      `SELECT TABLE_NAME AS name
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
    );

    const summary = [];
    for (const row of tables) {
      const table = row.name;
      if (SKIP.has(table)) {
        console.log(`  skip ${table}`);
        continue;
      }
      if (ONLY && !ONLY.has(table)) continue;
      summary.push(await syncTable(mysqlConn, mongoDb, table));
    }

    console.log("\n[sync] Summary");
    let src = 0;
    for (const s of summary) {
      src += s.sourceRows;
      console.log(
        `  ${s.table.padEnd(36)} src=${String(s.sourceRows).padStart(6)}  ${s.mode}`,
      );
    }
    console.log(`  tables=${summary.length}  source_rows_total=${src}  dry=${DRY}`);
  } finally {
    await mysqlConn.end();
    await mongo.close();
  }
}

main().catch((err) => {
  console.error("[sync] FAILED:", err.message || err);
  process.exit(1);
});
