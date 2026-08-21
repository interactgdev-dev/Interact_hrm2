import fs from "fs/promises";
import path from "path";
import { getDateStringInTimeZone, SERVER_TIMEZONE } from "@/lib/timezone";

export const ADMIN_ACTOR_COOKIE = "hrm_admin_actor";

const ROOT = path.join(process.cwd(), "logs", "admin-activity");

function dayStamp(d = new Date()) {
  return getDateStringInTimeZone(d, SERVER_TIMEZONE);
}

function safeName(name: string) {
  return String(name || "file")
    .replace(/[^\w.\-()+ ]+/g, "_")
    .slice(0, 120);
}

/** Append one JSON line to logs/admin-activity/YYYY-MM-DD.jsonl (server-only; no UI). */
export async function appendAdminActivity(event: Record<string, unknown>) {
  try {
    const day = dayStamp();
    const dir = ROOT;
    await fs.mkdir(dir, { recursive: true });
    const row = {
      ts: new Date().toISOString(),
      day,
      tz: SERVER_TIMEZONE,
      ...event,
    };
    await fs.appendFile(
      path.join(dir, `${day}.jsonl`),
      `${JSON.stringify(row)}\n`,
      "utf8",
    );
  } catch {
    // never break the app for logging
  }
}

/** Copy an uploaded/exported buffer under logs/admin-activity/files/YYYY-MM-DD/ */
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
    await appendAdminActivity({
      type: "file_backup",
      original_name: originalName,
      saved_as: relative,
      bytes: data.length,
      ...meta,
    });
    return relative;
  } catch {
    return null;
  }
}
