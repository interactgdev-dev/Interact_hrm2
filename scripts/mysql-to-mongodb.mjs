/**
 * Copy every MySQL table (schema + rows) into MongoDB collections.
 *
 * Uses the live MySQL database from .env.local (same as the HRM app),
 * not by parsing interact_hrm.sql. If you only have the dump file:
 *   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS interact_hrm;"
 *   mysql -u root -p interact_hrm < interact_hrm.sql
 * then run this script.
 *
 * Usage:
 *   npm run migrate:mongo
 *   npm run migrate:mongo -- --replace
 *
 * Env (optional, defaults shown):
 *   MONGO_URI=mongodb://127.0.0.1:27017
 *   MONGO_DB=interact_hrm
 *
 * --replace  drop each Mongo collection before insert (clean re-run)
 * --skip=a,b skip table names
 *
 * This copies DATA only. The Next.js app still talks to MySQL until
 * APIs are rewritten to Mongo.
 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { MongoClient, Binary, Decimal128, Long } from "mongodb";

function loadEnvFile(file, target) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
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
    if (!(key in target)) target[key] = val;
  }
}

const cwd = process.cwd();
const env = { ...process.env };
loadEnvFile(path.join(cwd, ".env.local"), env);
loadEnvFile(path.join(cwd, ".env"), env);

const args = process.argv.slice(2);
const REPLACE = args.includes("--replace");
const skipArg = args.find((a) => a.startsWith("--skip="));
const SKIP = new Set(
  (skipArg ? skipArg.slice("--skip=".length) : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const BATCH = 500;
const MONGO_URI = env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = env.MONGO_DB || env.DB_NAME || "interact_hrm";

function mysqlConfig() {
  const host = env.MYSQL_HOST || env.DB_HOST;
  const cfg = {
    user: env.MYSQL_USER || env.DB_USER || "root",
    password: Object.prototype.hasOwnProperty.call(env, "MYSQL_PASSWORD")
      ? env.MYSQL_PASSWORD
      : env.DB_PASSWORD || "",
    database: env.MYSQL_DATABASE || env.DB_NAME || "interact_hrm",
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectTimeout: 20000,
  };
  if (host) {
    cfg.host = host;
    cfg.port = parseInt(env.MYSQL_PORT || env.DB_PORT || "3306", 10);
  } else if (process.platform === "win32") {
    cfg.host = "localhost";
    cfg.port = parseInt(env.DB_PORT || "3306", 10);
  } else {
    cfg.socketPath = "/var/run/mysqld/mysqld.sock";
  }
  return cfg;
}

function convertValue(value) {
  if (value == null) return null;
  if (typeof value === "bigint") {
    if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
      return Number(value);
    }
    return Long.fromString(value.toString());
  }
  if (Buffer.isBuffer(value)) {
    return new Binary(value);
  }
  if (value instanceof Date) return value;
  if (typeof value === "object" && value.constructor?.name === "Decimal") {
    try {
      return Decimal128.fromString(String(value));
    } catch {
      return String(value);
    }
  }
  return value;
}

function convertRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = convertValue(value);
  }
  return out;
}

async function copyTable(mysqlConn, mongoDb, table) {
  const [countRows] = await mysqlConn.query(
    `SELECT COUNT(*) AS n FROM \`${table}\``,
  );
  const total = Number(countRows[0]?.n || 0);
  const col = mongoDb.collection(table);

  if (REPLACE) {
    await col.drop().catch(() => {});
  }

  let copied = 0;
  let offset = 0;
  while (offset < total || (total === 0 && offset === 0)) {
    if (total === 0) break;
    const [rows] = await mysqlConn.query(
      `SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`,
      [BATCH, offset],
    );
    if (!rows.length) break;
    const docs = rows.map(convertRow);
    await col.insertMany(docs, { ordered: false });
    copied += docs.length;
    offset += BATCH;
    process.stdout.write(`\r  ${table}: ${copied}/${total}`);
  }
  if (total === 0) {
    process.stdout.write(`\r  ${table}: 0/0 (empty)`);
  }
  process.stdout.write("\n");

  const [idCols] = await mysqlConn.query(
    `SHOW COLUMNS FROM \`${table}\` WHERE Field = 'id'`,
  );
  if (idCols.length) {
    await col.createIndex({ id: 1 }, { unique: false }).catch(() => {});
  }
  return copied;
}

async function main() {
  console.log("[mysql→mongo] MySQL db:", env.DB_NAME || "interact_hrm");
  console.log("[mysql→mongo] Mongo URI:", MONGO_URI);
  console.log("[mysql→mongo] Mongo db:", MONGO_DB);
  console.log("[mysql→mongo] Mode:", REPLACE ? "replace collections" : "append");

  const mysqlConn = await mysql.createConnection(mysqlConfig());
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
      const n = await copyTable(mysqlConn, mongoDb, table);
      summary.push({ table, rows: n });
    }

    console.log("\n[mysql→mongo] Done.");
    for (const s of summary) {
      console.log(`  ${s.table.padEnd(36)} ${s.rows} docs`);
    }
    console.log(`  collections: ${summary.length}`);
  } finally {
    await mysqlConn.end();
    await mongo.close();
  }
}

main().catch((err) => {
  console.error("[mysql→mongo] FAILED:", err.message || err);
  process.exit(1);
});
