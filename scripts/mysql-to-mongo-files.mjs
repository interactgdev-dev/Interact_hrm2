/**
 * Export every MySQL table to mongo-export/*.json (NDJSON / mongoimport).
 * No MongoDB needed on this machine — copy the folder to Ubuntu and import.
 *
 *   npm run export:mongo
 *
 * Ubuntu:
 *   unzip interact_hrm-mongo-export.zip
 *   cd mongo-export && bash import-to-mongo.sh
 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const OUT_DIR = path.join(cwd, "mongo-export");
const BATCH = 500;

function mysqlConfig() {
  const cfg = {
    user: env.DB_USER || "root",
    password: env.DB_PASSWORD || "",
    database: env.DB_NAME || "interact_hrm",
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  };
  if (process.platform === "win32") {
    cfg.host = env.DB_HOST || "localhost";
    cfg.port = parseInt(env.DB_PORT || "3306", 10);
  } else {
    cfg.socketPath = "/var/run/mysqld/mysqld.sock";
  }
  return cfg;
}

function toEjson(value) {
  if (value == null) return null;
  if (typeof value === "bigint") {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
    return { $numberLong: value.toString() };
  }
  if (Buffer.isBuffer(value)) {
    return {
      $binary: {
        base64: value.toString("base64"),
        subType: "00",
      },
    };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { $date: value.toISOString() };
  }
  if (typeof value === "object" && value.constructor?.name === "Decimal") {
    return { $numberDecimal: String(value) };
  }
  return value;
}

function rowToEjson(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = toEjson(value);
  }
  return out;
}

function writeImportScript() {
  const sh = `#!/usr/bin/env bash
set -euo pipefail
# Import mongo-export/*.json into MongoDB on Ubuntu.
# Usage:
#   MONGO_URI="mongodb://127.0.0.1:27017" MONGO_DB="interact_hrm" bash import-to-mongo.sh
DIR="$(cd "$(dirname "$0")" && pwd)"
URI="\${MONGO_URI:-mongodb://127.0.0.1:27017}"
DB="\${MONGO_DB:-interact_hrm}"

if ! command -v mongoimport >/dev/null 2>&1; then
  echo "mongoimport not found. Install MongoDB Database Tools:"
  echo "  https://www.mongodb.com/docs/database-tools/installation/installation-linux/"
  exit 1
fi

echo "Importing into \$URI / db=\$DB"
count=0
for f in "\$DIR"/*.json; do
  [ -e "\$f" ] || continue
  col="$(basename "\$f" .json)"
  echo "  \$col"
  mongoimport --uri="\$URI" --db="\$DB" --collection="\$col" --file="\$f" --drop
  count=$((count + 1))
done
echo "Done. collections=\$count"
`;
  fs.writeFileSync(path.join(OUT_DIR, "import-to-mongo.sh"), sh.replace(/\r\n/g, "\n"));
}

async function main() {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("[export] MySQL db:", env.DB_NAME || "interact_hrm");
  console.log("[export] Out:", OUT_DIR);

  const conn = await mysql.createConnection(mysqlConfig());
  try {
    const [tables] = await conn.query(
      `SELECT TABLE_NAME AS name
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
    );

    const manifest = [];
    for (const row of tables) {
      const table = row.name;
      const filePath = path.join(OUT_DIR, `${table}.json`);
      const [countRows] = await conn.query(
        `SELECT COUNT(*) AS n FROM \`${table}\``,
      );
      const total = Number(countRows[0]?.n || 0);
      const stream = fs.createWriteStream(filePath, { encoding: "utf8" });
      let copied = 0;
      let offset = 0;
      while (offset < total) {
        const [rows] = await conn.query(
          `SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`,
          [BATCH, offset],
        );
        if (!rows.length) break;
        for (const r of rows) {
          stream.write(`${JSON.stringify(rowToEjson(r))}\n`);
        }
        copied += rows.length;
        offset += BATCH;
        process.stdout.write(`\r  ${table}: ${copied}/${total}`);
      }
      await new Promise((resolve, reject) => {
        stream.end(() => resolve());
        stream.on("error", reject);
      });
      if (total === 0) process.stdout.write(`\r  ${table}: 0/0`);
      process.stdout.write("\n");
      manifest.push({ table, rows: copied, file: `${table}.json` });
    }

    fs.writeFileSync(
      path.join(OUT_DIR, "manifest.json"),
      `${JSON.stringify({ database: env.DB_NAME || "interact_hrm", exportedAt: new Date().toISOString(), tables: manifest }, null, 2)}\n`,
    );
    writeImportScript();

    const zipName = "interact_hrm-mongo-export.zip";
    const zipPath = path.join(cwd, zipName);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    const zip = spawnSync(
      "tar",
      ["-a", "-cf", zipName, "mongo-export"],
      { cwd, stdio: "inherit", shell: true },
    );
    if (zip.status !== 0) {
      console.log("[export] zip skipped (tar failed) — copy mongo-export/ folder as-is.");
    } else {
      console.log("[export] Zip:", zipPath);
    }

    console.log("\n[export] Done.");
    for (const s of manifest) {
      console.log(`  ${s.table.padEnd(36)} ${s.rows} docs`);
    }
    console.log(`  tables: ${manifest.length}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("[export] FAILED:", err.message || err);
  process.exit(1);
});
