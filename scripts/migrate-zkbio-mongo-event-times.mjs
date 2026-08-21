/**
 * One-time: ZKBio event_time was stored as Karachi wall digits in UTC BSON Date.
 * Convert to true UTC instants (subtract 5h). Safe to re-run (marker file).
 *
 * Usage on 10.98 (from app dir):
 *   node scripts/migrate-zkbio-mongo-event-times.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = path.join(ROOT, ".zkbio-event-time-utc-migrated");

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

function legacyUtcWallToInstant(d) {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours() - 5,
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

loadEnv();

if (fs.existsSync(MARKER)) {
  console.log("Already migrated (marker exists):", MARKER);
  process.exit(0);
}

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
let updated = 0;
const cursor = col.find({
  $or: [
    { event_time: { $type: "date" } },
    { imported_at: { $type: "date" } },
  ],
});

while (await cursor.hasNext()) {
  const doc = await cursor.next();
  scanned += 1;
  const $set = {};
  if (doc.event_time instanceof Date && !Number.isNaN(doc.event_time.getTime())) {
    $set.event_time = legacyUtcWallToInstant(doc.event_time);
  }
  if (doc.imported_at instanceof Date && !Number.isNaN(doc.imported_at.getTime())) {
    $set.imported_at = legacyUtcWallToInstant(doc.imported_at);
  }
  if (Object.keys($set).length) {
    await col.updateOne({ _id: doc._id }, { $set });
    updated += 1;
  }
  if (scanned % 2000 === 0) console.log(`… scanned ${scanned}, updated ${updated}`);
}

await client.close();
fs.writeFileSync(
  MARKER,
  `migrated ${new Date().toISOString()} scanned=${scanned} updated=${updated}\n`,
  "utf8",
);
console.log(`Done. scanned=${scanned} updated=${updated}`);
console.log("Marker:", MARKER);
