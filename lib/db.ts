/**
 * Dual DB entrypoint for Interact HRM.
 *
 * DB_DRIVER=mysql  (default) — existing MySQL pool (10.6 / 10.40)
 * DB_DRIVER=mongo            — MongoDB via SQL adapter (10.98)
 *
 * Same API surface: pool.execute / pool.query / pool.getConnection / query()
 */
import mysql from "mysql2/promise";
import { getMongoDb } from "./mongo";
import { mongoExecute } from "./mongo-sql-adapter";

export type DbDriver = "mysql" | "mongo";

export function getDbDriver(): DbDriver {
  const raw = String(
    process.env.DB_DRIVER || process.env.DATABASE_DRIVER || "mysql",
  )
    .trim()
    .toLowerCase();
  if (raw === "mongo" || raw === "mongodb") return "mongo";
  return "mysql";
}

function createMysqlPool() {
  const isWindows = process.platform === "win32";
  const connectionConfig: any = {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "interact_hrm",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    maxIdle: 10,
    idleTimeout: 60000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };

  if (!isWindows) {
    connectionConfig.socketPath = "/var/run/mysqld/mysqld.sock";
    delete connectionConfig.host;
    delete connectionConfig.port;
  }

  return mysql.createPool(connectionConfig);
}

function createMongoPool() {
  const run = async (sql: string, params?: any[]) => {
    const text = typeof sql === "string" ? sql : String(sql ?? "");
    if (/\bGET_LOCK\b/i.test(text)) return [[{ got_lock: 1 }], []];
    if (/\bRELEASE_LOCK\b/i.test(text)) return [[{}], []];
    const db = await getMongoDb();
    return mongoExecute(db, sql, params);
  };

  const conn = {
    execute: run,
    query: run,
    release() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async ping() {
      await getMongoDb();
    },
  };

  return {
    execute: run,
    query: run,
    async getConnection() {
      return conn;
    },
    async end() {},
  };
}

const driver = getDbDriver();

/** Cast so existing `pool.execute<Row[]>()` call sites typecheck under both drivers. */
export const pool = (
  driver === "mongo" ? createMongoPool() : createMysqlPool()
) as unknown as mysql.Pool;

if (typeof window === "undefined") {
  console.log(`[db] driver=${driver}`);
  void import("./register-auto-presence-cron").then((mod) =>
    mod.registerAutoPresenceCron(),
  );
}

export async function query(sql: string, params?: any[]) {
  return await pool.query(sql, params);
}

export async function execute(sql: string, params?: any[]) {
  return await pool.execute(sql, params);
}
