/**
 * Restore punch-only Admin Staff on staging 10.6 (Mongo DB_DRIVER).
 * Run ON 10.6 from /root/interact-hrm2:
 *   node scripts/restore-punch-only-staging.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

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
    if (!(key in target)) target[key] = val;
  }
}

const cwd = process.cwd();
const env = { ...process.env };
loadEnvFile(path.join(cwd, ".env.local"), env);
loadEnvFile(path.join(cwd, ".env"), env);

const ROSTER = [
  { id: 83, first: "Zahid", last: "Ali", pin: "140001" },
  { id: 84, first: "Muhammad Pervaiz", last: "Sharif", pin: "140004" },
  { id: 153, first: "Mehdi", last: "Hussain", pin: "140005" },
  { id: 154, first: "Waqas", last: "Ahmad", pin: "140003" },
  { id: 155, first: "Muhammad", last: "Khalid", pin: "140014" },
  { id: 156, first: "Javaid", last: "Sunny", pin: "140010" },
];

const SHIFT = {
  shift_name: "Admin Staff",
  start_time: "13:00:00",
  end_time: "00:00:00",
  assigned_date: "2025-01-01",
  allow_overtime: 0,
};

async function main() {
  const uri = env.MONGO_URI;
  const dbName = env.MONGO_DB || env.DB_NAME || "interact_hrm";
  if (!uri) throw new Error("MONGO_URI missing");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const emp = db.collection("hrm_employees");
  const shifts = db.collection("shift_assignments");

  for (const e of ROSTER) {
    const existing = await emp.findOne({ id: e.id });
    if (!existing) {
      await emp.insertOne({
        id: e.id,
        first_name: e.first,
        last_name: e.last,
        employee_code: e.pin,
        status: "active",
        department_name: "Admin",
        gender: "male",
        pseudonym: "NA",
      });
      console.log("[restore] inserted employee", e.id, e.first, e.last, e.pin);
    } else {
      await emp.updateOne(
        { id: e.id },
        {
          $set: {
            first_name: e.first,
            last_name: e.last,
            employee_code: e.pin,
            status: "active",
            department_name: "Admin",
          },
        },
      );
      console.log(
        "[restore] updated employee",
        e.id,
        "code",
        e.pin,
        "was",
        existing.employee_code,
      );
    }

    const shiftExisting = await shifts
      .find({ employee_id: e.id })
      .sort({ assigned_date: -1, id: -1 })
      .limit(1)
      .next();

    if (!shiftExisting) {
      const maxId = await shifts
        .find({})
        .sort({ id: -1 })
        .limit(1)
        .next();
      const nextId = Number(maxId?.id || 0) + 1;
      await shifts.insertOne({
        id: nextId,
        employee_id: e.id,
        ...SHIFT,
      });
      console.log("[restore] inserted shift", e.id, nextId, SHIFT.start_time, "->", SHIFT.end_time);
    } else {
      await shifts.updateOne(
        { _id: shiftExisting._id },
        {
          $set: {
            shift_name: SHIFT.shift_name,
            start_time: SHIFT.start_time,
            end_time: SHIFT.end_time,
            allow_overtime: 0,
          },
        },
      );
      console.log("[restore] updated shift", e.id, "row", shiftExisting.id);
    }
  }

  const verify = await emp
    .find({ id: { $in: ROSTER.map((r) => r.id) } })
    .project({ id: 1, first_name: 1, last_name: 1, employee_code: 1, status: 1 })
    .sort({ id: 1 })
    .toArray();
  console.log("[restore] verify", JSON.stringify(verify, null, 2));
  await client.close();
}

main().catch((err) => {
  console.error("[restore] FAILED", err);
  process.exit(1);
});
