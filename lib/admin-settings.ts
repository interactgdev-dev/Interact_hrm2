import { pool } from "@/lib/db";

const TABLE = "hrm_admin_settings";
const DEFAULT_ADMIN_PASSWORD = "interact123g";

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
  // Password is file-based only — never read from DB.
  return null;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  // Admin password lives in code only — never use DB-stored hash/password.
  return password === DEFAULT_ADMIN_PASSWORD;
}

export async function setAdminPassword(
  _currentPassword: string,
  _newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return {
    ok: false,
    error: "Admin password is configured in application settings only, not in the database.",
  };
}

export function isAdminLoginId(loginId: string): boolean {
  const id = loginId.trim().toLowerCase();
  return id === "admin" || id === "interactadmin" || id === "admin@interact.com";
}
