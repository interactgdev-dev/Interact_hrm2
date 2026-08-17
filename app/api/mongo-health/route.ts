import { NextRequest, NextResponse } from "next/server";
import { getDbDriver } from "@/lib/db";
import { getMongoDb, getMongoDbName, getMongoUri } from "@/lib/mongo";

const COLLECTION = "hrm_mongo_health";

function publicUri() {
  try {
    const u = new URL(getMongoUri());
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return getMongoUri();
  }
}

export async function GET() {
  if (getDbDriver() !== "mongo") {
    return NextResponse.json({
      ok: false,
      driver: getDbDriver(),
      error: "This page is for Mongo (10.98). Current driver is MySQL.",
    });
  }
  try {
    const db = await getMongoDb();
    const col = db.collection(COLLECTION);
    const ping = await db.command({ ping: 1 });
    const total = await col.countDocuments();
    const rows = await col.find({}).sort({ created_at: -1 }).limit(20).toArray();
    return NextResponse.json({
      ok: true,
      driver: "mongo",
      db: getMongoDbName(),
      collection: COLLECTION,
      uri: publicUri(),
      ping: ping?.ok === 1,
      total,
      rows: rows.map(({ _id, ...rest }) => ({
        ...rest,
        _id: String(_id),
      })),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, driver: "mongo", error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (getDbDriver() !== "mongo") {
    return NextResponse.json(
      { ok: false, error: "Mongo driver is not enabled." },
      { status: 400 },
    );
  }
  try {
    const body = await req.json().catch(() => ({}));
    const db = await getMongoDb();
    const col = db.collection(COLLECTION);
    const doc = {
      employee_id: String(body.employee_id || ""),
      employee_name: String(body.employee_name || "Employee"),
      note: String(body.note || "Mongo write OK"),
      created_at: new Date().toISOString(),
    };
    const result = await col.insertOne(doc);
    return NextResponse.json({
      ok: true,
      insertedId: String(result.insertedId),
      row: { ...doc, _id: String(result.insertedId) },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
  }
}
