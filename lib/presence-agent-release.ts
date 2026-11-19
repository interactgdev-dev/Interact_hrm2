import { ensureAdminSettingsTable } from "@/lib/admin-settings";
import { pool } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

const KEY = "presence_agent_version";
const REL_DIR = path.join("uploads", "presence-agent");
const EXE_NAME = "InteractPresence.exe";

export type PresenceAgentRelease = {
  version: string;
  hasBinary: boolean;
  updatedAt: string | null;
};

function uploadDirAbs(): string {
  return path.join(process.cwd(), "public", REL_DIR);
}

export function agentExeAbsPath(): string {
  return path.join(uploadDirAbs(), EXE_NAME);
}

async function getRaw(key: string): Promise<string | null> {
  await ensureAdminSettingsTable();
  const [rows] = await pool.execute(
    `SELECT setting_value FROM hrm_admin_settings WHERE setting_key = ? LIMIT 1`,
    [key]
  );
  const list = rows as { setting_value: string }[];
  return list[0]?.setting_value ?? null;
}

async function setRaw(key: string, value: string): Promise<void> {
  await ensureAdminSettingsTable();
  await pool.execute(
    `INSERT INTO hrm_admin_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

function sanitizeVersion(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!/^\d+\.\d+(\.\d+)?(\.\d+)?$/.test(v)) return "0.0.0";
  return v;
}

function parseVersionParts(raw: string): number[] {
  const parts = sanitizeVersion(raw).split(".").map((p) => parseInt(p, 10) || 0);
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4);
}

/** True when remote published version is newer than the agent's reported version. */
export function isRemoteVersionNewer(
  remote: string,
  local: string | null | undefined
): boolean {
  const r = parseVersionParts(remote);
  const l = parseVersionParts(local ?? "0.0.0");
  for (let i = 0; i < 4; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

export async function getPresenceAgentRelease(): Promise<PresenceAgentRelease> {
  const version = sanitizeVersion(await getRaw(KEY));
  let hasBinary = false;
  let updatedAt: string | null = null;
  try {
    const st = await fs.stat(agentExeAbsPath());
    hasBinary = st.isFile() && st.size > 0;
    updatedAt = st.mtime.toISOString();
  } catch {
    hasBinary = false;
  }
  return { version, hasBinary, updatedAt };
}

export async function setPresenceAgentVersion(version: string): Promise<string> {
  const raw = String(version ?? "").trim();
  if (!/^\d+\.\d+(\.\d+)?(\.\d+)?$/.test(raw)) {
    throw new Error("Invalid version (use e.g. 0.4.0 or 0.4.1)");
  }
  const parts = raw.split(".").map((p) => parseInt(p, 10));
  if (parts.every((n) => n === 0)) {
    throw new Error("Version cannot be 0.0.0 — use e.g. 0.4.0");
  }
  await setRaw(KEY, raw);
  return raw;
}

export async function savePresenceAgentBinary(buffer: Buffer): Promise<void> {
  if (!buffer || buffer.length < 1024) {
    throw new Error("Invalid agent binary (file too small)");
  }
  // MZ header — basic sanity for .exe
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    throw new Error("File does not look like a Windows .exe");
  }
  const dir = uploadDirAbs();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(agentExeAbsPath(), buffer);
}
