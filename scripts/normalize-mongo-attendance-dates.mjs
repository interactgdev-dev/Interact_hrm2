/**
 * Convert employee_attendance.date from BSON Date (MySQL DATE dump)
 * to YYYY-MM-DD strings in Asia/Karachi so range filters match.
 *
 *   MONGO_URI=mongodb://127.0.0.1:27017 MONGO_DB=interact_hrm node scripts/normalize-mongo-attendance-dates.mjs
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.MONGO_DB || process.env.DB_NAME || "interact_hrm";

function karachiYmd(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

const client = new MongoClient(uri);
await client.connect();
const col = client.db(dbName).collection("employee_attendance");
const cursor = col.find({ date: { $type: "date" } });
let n = 0;
for await (const doc of cursor) {
  const ymd = karachiYmd(doc.date);
  if (!ymd) continue;
  await col.updateOne({ _id: doc._id }, { $set: { date: ymd } });
  n += 1;
}
console.log(`[normalize-mongo-dates] converted ${n} attendance.date values in ${dbName}`);
await client.close();
