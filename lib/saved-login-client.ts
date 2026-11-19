import {
  loadSavedLoginsLocal,
  upsertSavedLoginLocal,
  type SavedLogin,
} from "@/lib/saved-login-local";
import { getStableDeviceFingerprint } from "@/lib/device-fingerprint";

export type { SavedLogin };

async function fetchSavedLoginsFromApi(deviceKey: string): Promise<SavedLogin[]> {
  try {
    const params = new URLSearchParams({ deviceKey });
    const res = await fetch(`/api/auth/saved-login?${params.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json()) as {
      success?: boolean;
      logins?: { loginId: string; password: string }[];
      loginId?: string | null;
      password?: string | null;
      error?: string;
    };
    if (!data.success) return [];

    if (Array.isArray(data.logins) && data.logins.length > 0) {
      return data.logins.filter((l) => l.loginId && l.password);
    }

    if (data.loginId && data.password) {
      return [{ loginId: data.loginId, password: data.password }];
    }
    return [];
  } catch {
    return [];
  }
}

/** DB first (survives cache clear), then localStorage fallback. */
export async function loadSavedLogins(): Promise<SavedLogin[]> {
  const deviceKey = await getStableDeviceFingerprint();
  if (deviceKey) {
    const fromDb = await fetchSavedLoginsFromApi(deviceKey);
    if (fromDb.length > 0) {
      for (const entry of fromDb) {
        upsertSavedLoginLocal(entry.loginId, entry.password);
      }
      return fromDb;
    }
  }

  return loadSavedLoginsLocal();
}

/** @deprecated Use loadSavedLogins */
export async function loadSavedLogin(): Promise<SavedLogin | null> {
  const list = await loadSavedLogins();
  return list[0] ?? null;
}

/** Save to database + localStorage (Remember me). */
export async function persistSavedLogin(loginId: string, password: string): Promise<boolean> {
  const deviceKey = await getStableDeviceFingerprint();
  if (!deviceKey) return false;

  try {
    const res = await fetch("/api/auth/saved-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ loginId, password, deviceKey }),
    });
    const data = (await res.json()) as { success?: boolean };
    if (data.success === true) {
      upsertSavedLoginLocal(loginId, password);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
