import "server-only";

import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";
import { GUARD_SCREENSHOTS_ROOT } from "@/lib/guard-screenshots";

/** Days to keep archived screenshots (default 3 — staging-safe). */
export function screenshotRetentionDays(): number {
  const n = Number(process.env.GUARD_SS_RETENTION_DAYS ?? 3);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(90, Math.floor(n)));
}

/** Soft cap on total gallery size in MB (default 2 GB). */
export function screenshotMaxTotalMb(): number {
  const n = Number(process.env.GUARD_SS_MAX_TOTAL_MB ?? 2048);
  if (!Number.isFinite(n)) return 2048;
  return Math.max(256, Math.min(1024 * 100, Math.floor(n)));
}

/** Refuse new writes when free disk below this (MB). */
export function screenshotMinFreeMb(): number {
  const n = Number(process.env.GUARD_SS_MIN_FREE_MB ?? 2048);
  if (!Number.isFinite(n)) return 2048;
  return Math.max(256, Math.min(50_000, Math.floor(n)));
}

export async function getDiskFreeMb(dir = GUARD_SCREENSHOTS_ROOT): Promise<number | null> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const s = await fs.statfs(dir);
    const bavail = Number(s.bavail);
    const bsize = Number(s.bsize);
    if (!Number.isFinite(bavail) || !Number.isFinite(bsize) || bsize <= 0) {
      return null;
    }
    return Math.floor((bavail * bsize) / (1024 * 1024));
  } catch {
    return null;
  }
}

/** Linux MemAvailable (MB). null on non-Linux. */
export async function getMemAvailableMb(): Promise<number | null> {
  try {
    const raw = await fs.readFile("/proc/meminfo", "utf8");
    const m = /MemAvailable:\s+(\d+)/i.exec(raw);
    if (!m) return null;
    return Math.floor(Number(m[1]) / 1024);
  } catch {
    return null;
  }
}

export type RetentionSweepResult = {
  deletedFiles: number;
  deletedBytes: number;
  keptFiles: number;
  freeMb: number | null;
  memAvailableMb: number | null;
};

type FileEntry = { abs: string; mtimeMs: number; size: number };

async function listScreenshotFiles(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  async function walk(dir: string) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (
        !lower.endsWith(".jpg") &&
        !lower.endsWith(".jpeg") &&
        !lower.endsWith(".png")
      ) {
        continue;
      }
      try {
        const st = await fs.stat(abs);
        out.push({ abs, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        /* ignore */
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * Delete screenshots older than retention days, then trim oldest until under max total MB.
 * Also prunes Backlog Tracker archived upload/download copies (same age).
 */
export async function sweepGuardScreenshotRetention(): Promise<RetentionSweepResult> {
  const result: RetentionSweepResult = {
    deletedFiles: 0,
    deletedBytes: 0,
    keptFiles: 0,
    freeMb: await getDiskFreeMb(),
    memAvailableMb: await getMemAvailableMb(),
  };

  const cutoff =
    Date.now() - screenshotRetentionDays() * 24 * 60 * 60 * 1000;
  const maxBytes = screenshotMaxTotalMb() * 1024 * 1024;

  try {
    await fs.mkdir(GUARD_SCREENSHOTS_ROOT, { recursive: true });
  } catch {
    /* ignore */
  }

  const files = await listScreenshotFiles(GUARD_SCREENSHOTS_ROOT);
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const keep: FileEntry[] = [];
  for (const f of files) {
    if (f.mtimeMs < cutoff) {
      try {
        await fs.unlink(f.abs);
        result.deletedFiles += 1;
        result.deletedBytes += f.size;
      } catch {
        keep.push(f);
      }
    } else {
      keep.push(f);
    }
  }

  let total = keep.reduce((s, f) => s + f.size, 0);
  const stillKeep: FileEntry[] = [];
  for (const f of keep) {
    if (total > maxBytes) {
      try {
        await fs.unlink(f.abs);
        result.deletedFiles += 1;
        result.deletedBytes += f.size;
        total -= f.size;
        continue;
      } catch {
        stillKeep.push(f);
      }
    } else {
      stillKeep.push(f);
    }
  }
  result.keptFiles = stillKeep.length;

  // Empty date folders (best-effort)
  await pruneEmptyDirs(GUARD_SCREENSHOTS_ROOT, 0);

  // Backlog file copies — same retention window
  await pruneActivityBacklogFiles(cutoff, result);

  result.freeMb = await getDiskFreeMb();
  result.memAvailableMb = await getMemAvailableMb();
  return result;
}

async function pruneEmptyDirs(dir: string, depth: number): Promise<void> {
  if (depth > 6) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const child = path.join(dir, e.name);
    await pruneEmptyDirs(child, depth + 1);
    try {
      const left = await fs.readdir(child);
      if (left.length === 0 && depth >= 0) await fs.rmdir(child);
    } catch {
      /* ignore */
    }
  }
}

async function pruneActivityBacklogFiles(
  cutoffMs: number,
  result: RetentionSweepResult,
) {
  const root = path.join(process.cwd(), "logs", "admin-activity", "files");
  try {
    await fs.access(root);
  } catch {
    return;
  }
  async function walkAll(dir: string) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkAll(abs);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        const st = await fs.stat(abs);
        if (st.mtimeMs < cutoffMs) {
          await fs.unlink(abs);
          result.deletedFiles += 1;
          result.deletedBytes += st.size;
        }
      } catch {
        /* ignore */
      }
    }
  }
  await walkAll(root);
}

export async function assertScreenshotStorageWritable(): Promise<{
  ok: boolean;
  reason?: string;
  freeMb: number | null;
  memAvailableMb: number | null;
}> {
  const freeMb = await getDiskFreeMb();
  const memAvailableMb = await getMemAvailableMb();
  const minFree = screenshotMinFreeMb();
  if (freeMb != null && freeMb < minFree) {
    return {
      ok: false,
      reason: `low disk (${freeMb} MB free, need ${minFree} MB)`,
      freeMb,
      memAvailableMb,
    };
  }
  // Critical RAM — refuse ingest so Next.js stays up (staging ~2GB box).
  if (memAvailableMb != null && memAvailableMb < 180) {
    return {
      ok: false,
      reason: `low memory (${memAvailableMb} MB available)`,
      freeMb,
      memAvailableMb,
    };
  }
  return { ok: true, freeMb, memAvailableMb };
}
