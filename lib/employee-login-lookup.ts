/**
 * Employee login identifier normalization.
 * - loginId: trim + case-insensitive match for username/email
 * - HRM numeric employee id (hrm_employees.id) also accepted
 * - password: never trimmed (caller responsibility)
 */

/** Trim whitespace from login field only (not password). */
export function normalizeEmployeeLoginId(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** Parsed HRM employee id when login is digits only (e.g. "102" → 102). */
export function parseHrmEmployeeId(loginId: string): number | null {
  if (!/^\d+$/.test(loginId)) return null;
  const n = Number(loginId);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export function employeeLoginIdLower(loginId: string): string {
  return loginId.toLowerCase();
}
