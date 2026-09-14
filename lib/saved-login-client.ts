/**
 * Saved logins — THIS DEVICE ONLY (localStorage).
 * Never read/write server DB (avoids cross-device credential leaks).
 */
import {
  clearSavedLoginLocal,
  loadSavedLoginsLocal,
  upsertSavedLoginLocal,
  type SavedLogin,
} from "@/lib/saved-login-local";

export type { SavedLogin };

/** Load saved logins from this browser only. */
export async function loadSavedLogins(): Promise<SavedLogin[]> {
  return loadSavedLoginsLocal();
}

/** @deprecated Use loadSavedLogins */
export async function loadSavedLogin(): Promise<SavedLogin | null> {
  const list = await loadSavedLogins();
  return list[0] ?? null;
}

/** Save to localStorage only (Remember me). */
export async function persistSavedLogin(
  loginId: string,
  password: string,
): Promise<boolean> {
  const id = String(loginId || "").trim();
  if (!id || !password) return false;
  try {
    upsertSavedLoginLocal(id, password);
    return true;
  } catch {
    return false;
  }
}

export function clearSavedLoginsOnThisDevice(): void {
  clearSavedLoginLocal();
}
