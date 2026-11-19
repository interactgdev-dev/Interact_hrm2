/**
 * Presence check sessions for desktop agent ↔ Chrome bridge.
 * File-backed so Next.js HMR / multiple workers don't lose the result
 * (in-memory Map was why agent often got timeout → no success/fail toast).
 */

import fs from "fs";
import path from "path";
import os from "os";

export type PresenceSessionResult = {
  cameraOk: boolean;
  atSeat: boolean;
  code: string;
  error?: string | null;
  similarity?: number | null;
};

type Session = {
  employeeId: string;
  createdAt: number;
  result: PresenceSessionResult | null;
  /** Guard sets true after employee clicks Here — armed page then scans. */
  start: boolean;
  /**
   * When true, Interact Guard hosts FaceVerify in its own WebView2 window.
   * Dashboard must not also open a modal (avoids dual UI / blank slab).
   */
  agentHost: boolean;
};

const DIR = path.join(os.tmpdir(), "interact-hrm-presence-sessions");
/** Cover full "Are you there?" window (5 min) + a little slack */
const TTL_MS = 6 * 60 * 1000;

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function fileFor(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DIR, `${safe}.json`);
}

function readSession(id: string): Session | null {
  try {
    const raw = fs.readFileSync(fileFor(id), "utf8");
    const s = JSON.parse(raw) as Session;
    if (!s || typeof s.createdAt !== "number") return null;
    if (Date.now() - s.createdAt > TTL_MS) {
      try {
        fs.unlinkSync(fileFor(id));
      } catch {
        /* ignore */
      }
      return null;
    }
    if (typeof s.start !== "boolean") s.start = false;
    if (typeof s.agentHost !== "boolean") s.agentHost = false;
    return s;
  } catch {
    return null;
  }
}

function writeSession(id: string, s: Session) {
  ensureDir();
  fs.writeFileSync(fileFor(id), JSON.stringify(s), "utf8");
}

export function createPresenceSession(employeeId: string): string {
  ensureDir();
  const id = `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  writeSession(id, {
    employeeId: String(employeeId).trim(),
    createdAt: Date.now(),
    result: null,
    start: false,
    agentHost: false,
  });
  return id;
}

export function getPresenceSession(id: string): Session | null {
  return readSession(id);
}

export function signalPresenceStart(
  id: string,
  opts?: { agentHost?: boolean }
): boolean {
  const s = readSession(id);
  if (!s) return false;
  s.start = true;
  if (opts?.agentHost) s.agentHost = true;
  writeSession(id, s);
  return true;
}

export function completePresenceSession(
  id: string,
  result: PresenceSessionResult
): boolean {
  const s = readSession(id);
  if (!s) return false;
  s.result = result;
  writeSession(id, s);
  return true;
}

export function takePresenceSessionResult(id: string): PresenceSessionResult | null {
  const s = readSession(id);
  if (!s?.result) return null;
  const r = s.result;
  try {
    fs.unlinkSync(fileFor(id));
  } catch {
    /* ignore */
  }
  return r;
}

export function cancelPresenceSession(id: string): void {
  try {
    fs.unlinkSync(fileFor(id));
  } catch {
    /* ignore */
  }
}

/**
 * Dashboard: find an armed session for in-page FaceVerifyModal.
 * Skips agentHost sessions — Guard WebView owns those.
 */
export function findPendingPresenceForEmployee(
  employeeId: string,
): { checkId: string; employeeId: string } | null {
  const eid = String(employeeId ?? "").trim();
  if (!eid) return null;
  ensureDir();
  let files: string[] = [];
  try {
    files = fs.readdirSync(DIR);
  } catch {
    return null;
  }
  let best: { checkId: string; employeeId: string; createdAt: number } | null = null;
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const checkId = name.slice(0, -".json".length);
    const s = readSession(checkId);
    if (!s || s.result || !s.start || s.agentHost) continue;
    if (String(s.employeeId).trim() !== eid) continue;
    if (!best || s.createdAt > best.createdAt) {
      best = { checkId, employeeId: s.employeeId, createdAt: s.createdAt };
    }
  }
  return best ? { checkId: best.checkId, employeeId: best.employeeId } : null;
}
