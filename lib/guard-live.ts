import fs from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { isGalleryUnlocked } from "@/lib/guard-screenshots";

/** Latest live JPEG frames (overwrite) — not archived screenshots. */
export const GUARD_LIVE_ROOT = path.join(process.cwd(), "uploads", "guard-live");

const SESSION_FILE = path.join(GUARD_LIVE_ROOT, "_session.json");

/** Admin must poll within this window or agents stop streaming. */
export const LIVE_SESSION_TTL_MS = 20_000;

export type GuardLiveSession = {
  active: boolean;
  /** Employee currently opened in large popup — faster/higher quality stream. */
  focusEmployeeId: string | null;
  lastTouchMs: number;
};

export type LiveFrameMeta = {
  employeeId: string;
  updatedAt: string;
  size: number;
  name: string | null;
  pseudonym: string | null;
};

const DEFAULT_SESSION: GuardLiveSession = {
  active: false,
  focusEmployeeId: null,
  lastTouchMs: 0,
};

function safeId(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

async function ensureRoot() {
  await fs.mkdir(GUARD_LIVE_ROOT, { recursive: true });
}

export async function readLiveSession(): Promise<GuardLiveSession> {
  try {
    await ensureRoot();
    const raw = await fs.readFile(SESSION_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<GuardLiveSession>;
    const lastTouchMs = Number(parsed.lastTouchMs) || 0;
    const fresh = Date.now() - lastTouchMs <= LIVE_SESSION_TTL_MS;
    return {
      active: !!parsed.active && fresh,
      focusEmployeeId: parsed.focusEmployeeId
        ? safeId(String(parsed.focusEmployeeId))
        : null,
      lastTouchMs,
    };
  } catch {
    return { ...DEFAULT_SESSION };
  }
}

async function writeLiveSession(s: GuardLiveSession): Promise<void> {
  await ensureRoot();
  await fs.writeFile(SESSION_FILE, JSON.stringify(s), "utf8");
}

export async function startLiveSession(): Promise<GuardLiveSession> {
  const next: GuardLiveSession = {
    active: true,
    focusEmployeeId: null,
    lastTouchMs: Date.now(),
  };
  await writeLiveSession(next);
  return next;
}

export async function stopLiveSession(): Promise<GuardLiveSession> {
  const next: GuardLiveSession = {
    active: false,
    focusEmployeeId: null,
    lastTouchMs: 0,
  };
  await writeLiveSession(next);
  return next;
}

export async function touchLiveSession(opts?: {
  focusEmployeeId?: string | null;
}): Promise<GuardLiveSession> {
  const cur = await readLiveSession();
  if (!cur.active) {
    return cur;
  }
  const focus =
    opts && "focusEmployeeId" in opts
      ? opts.focusEmployeeId
        ? safeId(opts.focusEmployeeId)
        : null
      : cur.focusEmployeeId;
  const next: GuardLiveSession = {
    active: true,
    focusEmployeeId: focus,
    lastTouchMs: Date.now(),
  };
  await writeLiveSession(next);
  return next;
}

export function requireGallery(req: NextRequest): boolean {
  return isGalleryUnlocked(req);
}

export async function saveLiveFrame(input: {
  employeeId: string;
  bytes: Buffer;
  name?: string;
  pseudonym?: string;
}): Promise<LiveFrameMeta> {
  const employeeId = safeId(input.employeeId);
  if (!employeeId) throw new Error("employee_id required");
  if (!input.bytes?.length) throw new Error("empty frame");
  if (input.bytes.length > 4 * 1024 * 1024) throw new Error("frame too large");

  await ensureRoot();
  const jpgPath = path.join(GUARD_LIVE_ROOT, `${employeeId}.jpg`);
  const tmpPath = path.join(GUARD_LIVE_ROOT, `${employeeId}.${Date.now()}.jpg.tmp`);
  const metaPath = path.join(GUARD_LIVE_ROOT, `${employeeId}.json`);
  // Write temp then replace — Windows-safe (rename-over-existing often fails).
  await fs.writeFile(tmpPath, input.bytes);
  try {
    await fs.copyFile(tmpPath, jpgPath);
  } finally {
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* ignore */
    }
  }
  const meta: LiveFrameMeta = {
    employeeId,
    updatedAt: new Date().toISOString(),
    size: input.bytes.length,
    name: (input.name || "").trim() || null,
    pseudonym: (input.pseudonym || "").trim() || null,
  };
  await fs.writeFile(metaPath, JSON.stringify(meta), "utf8");
  return meta;
}

export async function listLiveFrames(): Promise<LiveFrameMeta[]> {
  try {
    await ensureRoot();
    const ents = await fs.readdir(GUARD_LIVE_ROOT, { withFileTypes: true });
    const out: LiveFrameMeta[] = [];
    for (const e of ents) {
      if (!e.isFile() || !e.name.endsWith(".json") || e.name.startsWith("_")) {
        continue;
      }
      try {
        const raw = await fs.readFile(path.join(GUARD_LIVE_ROOT, e.name), "utf8");
        const meta = JSON.parse(raw) as LiveFrameMeta;
        if (!meta?.employeeId) continue;
        const age = Date.now() - new Date(meta.updatedAt).getTime();
        if (!Number.isFinite(age) || age > 30_000) continue;
        out.push(meta);
      } catch {
        /* skip */
      }
    }
    out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return out;
  } catch {
    return [];
  }
}

export async function resolveLiveFramePath(employeeIdRaw: string): Promise<string> {
  const employeeId = safeId(employeeIdRaw);
  if (!employeeId) throw new Error("Invalid path");
  await ensureRoot();
  const abs = path.join(GUARD_LIVE_ROOT, `${employeeId}.jpg`);
  const realRoot = await fs.realpath(GUARD_LIVE_ROOT);
  let realFile: string;
  try {
    realFile = await fs.realpath(abs);
  } catch {
    throw new Error("Not found");
  }
  if (!realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
    throw new Error("Invalid path");
  }
  return realFile;
}

/** Values agents use while admin live session is open. */
export function liveStreamParamsForEmployee(
  session: GuardLiveSession,
  employeeId: string | null
): {
  livePreviewActive: boolean;
  liveIntervalMs: number;
  liveJpegQuality: number;
  liveScalePercent: number;
} {
  if (!session.active) {
    return {
      livePreviewActive: false,
      liveIntervalMs: 2000,
      liveJpegQuality: 45,
      liveScalePercent: 45,
    };
  }
  const id = employeeId ? safeId(employeeId) : "";
  const focused = !!id && session.focusEmployeeId === id;
  // Keep quality/scale identical for grid vs popup — changing scale mid-stream
  // causes a visible resolution "jerk". Only refresh rate differs when focused.
  return {
    livePreviewActive: true,
    liveIntervalMs: focused ? 350 : 600,
    liveJpegQuality: 50,
    liveScalePercent: 55,
  };
}
