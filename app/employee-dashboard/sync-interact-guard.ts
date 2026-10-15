/**
 * Push logged-in employee identity to Interact Guard desktop agent (localhost).
 * No-op if agent is not installed / not running.
 */

const GUARD_BIND_URL = "http://127.0.0.1:19501/bind";

export type GuardBindPayload = {
  employeeId: string;
  employeeName?: string | null;
  pseudonym?: string | null;
};

export async function syncInteractGuardBind(
  payload: GuardBindPayload,
): Promise<boolean> {
  const id = String(payload.employeeId || "").trim();
  if (!id || !/^\d+$/.test(id)) return false;
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(GUARD_BIND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: id,
        employee_name: String(payload.employeeName || "").trim() || undefined,
        pseudonym: String(payload.pseudonym || "").trim() || undefined,
      }),
      signal: ctrl.signal,
      mode: "cors",
      cache: "no-store",
    });
    window.clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
