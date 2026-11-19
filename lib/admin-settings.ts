import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";

const TABLE = "hrm_admin_settings";
const PASSWORD_KEY = "admin_password_hash";
const DEFAULT_ADMIN_PASSWORD = "interact123";

export async function ensureAdminSettingsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function getAdminPasswordHash(): Promise<string | null> {
  await ensureAdminSettingsTable();
  const [rows] = await pool.execute(
    `SELECT setting_value FROM ${TABLE} WHERE setting_key = ? LIMIT 1`,
    [PASSWORD_KEY]
  );
  const list = rows as { setting_value: string }[];
  return list[0]?.setting_value ?? null;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const hash = await getAdminPasswordHash();
  if (!hash) return password === DEFAULT_ADMIN_PASSWORD;
  if (hash.startsWith("$2")) return bcrypt.compare(password, hash);
  return password === hash;
}

export async function setAdminPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = await verifyAdminPassword(currentPassword);
  if (!valid) return { ok: false, error: "Current password is incorrect." };
  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: "New password must be at least 4 characters." };
  }
  await ensureAdminSettingsTable();
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.execute(
    `INSERT INTO ${TABLE} (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [PASSWORD_KEY, hash]
  );
  return { ok: true };
}

export function isAdminLoginId(loginId: string): boolean {
  const id = loginId.trim().toLowerCase();
  return id === "admin" || id === "interactadmin" || id === "admin@interact.com";
}
