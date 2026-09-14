const LOGIN_ID_KEY = "interact_hrm_saved_login_id";
const PASSWORD_KEY = "interact_hrm_saved_password";
/** v3: local-only; ignore polluted v2 lists that were synced from shared DB fingerprints. */
const SAVED_LOGINS_KEY = "interact_hrm_saved_logins_v3";
const LEGACY_V2_KEY = "interact_hrm_saved_logins_v2";

export type SavedLogin = {
  loginId: string;
  password: string;
};

function normalizeLoginId(loginId: string): string {
  return String(loginId || "").trim();
}

function purgeLegacyKeys() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_V2_KEY);
    localStorage.removeItem(LOGIN_ID_KEY);
    localStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSavedLoginsLocal(): SavedLogin[] {
  if (typeof window === "undefined") return [];

  // Drop old shared/polluted lists once (v2 came from colliding server device keys).
  purgeLegacyKeys();

  const raw = localStorage.getItem(SAVED_LOGINS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SavedLogin[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e?.loginId && e?.password)
      .map((e) => ({ loginId: normalizeLoginId(e.loginId), password: e.password }));
  } catch {
    return [];
  }
}

export function upsertSavedLoginLocal(loginId: string, password: string): void {
  if (typeof window === "undefined") return;
  const id = normalizeLoginId(loginId);
  if (!id || !password) return;

  const list = loadSavedLoginsLocal().filter(
    (e) => e.loginId.trim().toLowerCase() !== id.toLowerCase(),
  );
  list.unshift({ loginId: id, password });
  localStorage.setItem(SAVED_LOGINS_KEY, JSON.stringify(list));
}

/** @deprecated Use upsertSavedLoginLocal */
export function saveSavedLoginLocal(loginId: string, password: string): void {
  upsertSavedLoginLocal(loginId, password);
}

/** @deprecated Use loadSavedLoginsLocal */
export function loadSavedLoginLocal(): SavedLogin | null {
  return loadSavedLoginsLocal()[0] ?? null;
}

export function clearSavedLoginLocal(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SAVED_LOGINS_KEY);
  purgeLegacyKeys();
}
