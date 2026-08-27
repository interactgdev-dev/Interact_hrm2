/**
 * Fix Mongo zkbio_punch_log.event_time when Karachi wall was stored as UTC digits.
 * Only rewrites rows where raw_json.eventTime matches event_time UTC wall
 * (safe if some rows were already correct via live ZKBio sync).
 *
 *   node scripts/fix-zkbio-event-times-from-raw.mjs
 *   node scripts/fix-zkbio-event-times-from-raw.mjs --dry-run
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}

function parseRaw(doc) {
  let raw = doc.raw_json;
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const wall = raw?.eventTime || raw?.event_time;
  if (!wall || typeof wall !== "string") return null;
  const m = wall
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  return { wallNorm: `${m[1]}T${m[2]}`, iso: `${m[1]}T${m[2]}+05:00` };
}

loadEnv();
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGO_DB || "interact_hrm");
const col = db.collection("zkbio_punch_log");

let scanned = 0;
let needsFix = 0;
let updated = 0;
const cursor = col.find({ event_time: { $type: "date" } });

while (await cursor.hasNext()) {
  const doc = await cursor.next();
  scanned += 1;
  const parsed = parseRaw(doc);
  if (!parsed || !(doc.event_time instanceof Date)) continue;
  const storedNorm = doc.event_time.toISOString().slice(0, 19);
  // Wrong sync: UTC ISO digits == Karachi wall digits
  if (storedNorm !== parsed.wallNorm) continue;
  needsFix += 1;
  const fixed = new Date(parsed.iso);
  if (Number.isNaN(fixed.getTime())) continue;
  if (!DRY) {
    await col.updateOne({ _id: doc._id }, { $set: { event_time: fixed } });
    updated += 1;
  }
  if (needsFix <= 3) {
    console.log(
      `example ${doc.log_id}: ${storedNorm}Z → ${fixed.toISOString()}`,
    );
  }
  if (scanned % 5000 === 0) {
    console.log(`… scanned ${scanned}, needsFix ${needsFix}, updated ${updated}`);
  }
}

await client.close();
console.log(
  `${DRY ? "DRY " : ""}Done. scanned=${scanned} needsFix=${needsFix} updated=${updated}`,
);
