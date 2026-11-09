import fs from "fs/promises";
import path from "path";
import { safeSegment } from "@/lib/guard-screenshots";

/**
 * Optional mirror of guard screenshots onto a Windows CIFS share (staging winshare).
 * Never blocks or fails the HRM upload path — fire-and-forget with a small queue.
 *
 * Layout on share:
 *   {GUARD_SCREENSHOT_WINSHARE_DIR}/{employeeId}_{EmployeeName}/{YYYY-MM-DD}/{file}.jpg
 *
 * Env:
 *   GUARD_SCREENSHOT_WINSHARE_DIR=/root/winshare/guard-screenshots
 */

const MAX_QUEUE = 40;
const MAX_INFLIGHT = 1;
const COPY_TIMEOUT_MS = 20_000;

type MirrorJob = {
  absolutePath: string;
  /** Path under winshare root, e.g. 97_Waqas_Rafique/2026-10-27/file.jpg */
  shareRelativePath: string;
};

let inflight = 0;
const queue: MirrorJob[] = [];

export function winshareMirrorRoot(): string {
  return String(process.env.GUARD_SCREENSHOT_WINSHARE_DIR || "").trim();
}

export function isWinshareMirrorEnabled(): boolean {
  return Boolean(winshareMirrorRoot());
}

/** One folder per employee: `97_Waqas_Rafique` (never append placeholder NA). */
export function employeeWinshareFolder(
  employeeId: string,
  employeeName?: string | null,
): string {
  const id = safeSegment(employeeId, "unknown");
  let name = safeSegment(employeeName || "", "Employee");
  name = name.replace(/_NA$/i, "");
  if (!name || name.toUpperCase() === "NA") name = "Employee";
  return `${id}_${name}`;
}

export function buildWinshareRelativePath(opts: {
  employeeId: string;
  employeeName?: string | null;
  dateFolder: string;
  fileName: string;
}): string {
  const folder = employeeWinshareFolder(opts.employeeId, opts.employeeName);
  const day = safeSegment(opts.dateFolder, "unknown-date");
  const file = String(opts.fileName || "")
    .replace(/[\\/]+/g, "_")
    .trim();
  return [folder, day, file].filter(Boolean).join("/");
}

/**
 * Schedule a best-effort copy to winshare. Safe to call from upload handler —
 * returns immediately; failures are swallowed.
 */
export function enqueueScreenshotWinshareMirror(opts: {
  absolutePath: string;
  employeeId: string;
  employeeName?: string | null;
  /** HRM relative path employeeId/date/file — used to derive date + fileName */
  relativePath?: string;
  dateFolder?: string;
  fileName?: string;
}): void {
  const root = winshareMirrorRoot();
  if (!root) return;
  const abs = String(opts.absolutePath || "").trim();
  if (!abs) return;

  let dateFolder = String(opts.dateFolder || "").trim();
  let fileName = String(opts.fileName || "").trim();
  const rel = String(opts.relativePath || "")
    .trim()
    .replace(/\\/g, "/");
  if ((!dateFolder || !fileName) && rel) {
    const parts = rel.split("/").filter(Boolean);
    // expected: employeeId / date / file
    if (parts.length >= 3) {
      dateFolder = dateFolder || parts[parts.length - 2];
      fileName = fileName || parts[parts.length - 1];
    } else if (parts.length === 1) {
      fileName = fileName || parts[0];
    }
  }
  if (!fileName) return;
  if (!dateFolder) {
    const m = fileName.match(/(\d{4}-\d{2}-\d{2})_/);
    dateFolder = m?.[1] || "undated";
  }

  const shareRelativePath = buildWinshareRelativePath({
    employeeId: opts.employeeId,
    employeeName: opts.employeeName,
    dateFolder,
    fileName,
  });
  if (shareRelativePath.includes("..")) return;

  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ absolutePath: abs, shareRelativePath });
  void pump();
}

async function pump(): Promise<void> {
  if (inflight >= MAX_INFLIGHT) return;
  const next = queue.shift();
  if (!next) return;
  inflight += 1;
  try {
    await copyOne(next.absolutePath, next.shareRelativePath);
  } catch {
    /* never surface to HRM */
  } finally {
    inflight -= 1;
    if (queue.length > 0) {
      setImmediate(() => {
        void pump();
      });
    }
  }
}

async function copyOne(
  absolutePath: string,
  shareRelativePath: string,
): Promise<void> {
  const root = winshareMirrorRoot();
  if (!root) return;

  const dest = path.join(root, ...shareRelativePath.split("/").filter(Boolean));
  const destDir = path.dirname(dest);

  const work = (async () => {
    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(absolutePath, dest);
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("winshare copy timeout")),
          COPY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Name from HRM file `Abdul_Wahab_NA_2026-10-27_01-54-27.jpg` → Abdul_Wahab
 * (drop placeholder pseudo `NA` so we don't create duplicate *_NA folders)
 */
function nameFromScreenshotFile(fileName: string): string {
  const base = fileName.replace(/\.(jpe?g|png)$/i, "");
  const m = base.match(/^(.*)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  if (!m) return "Employee";
  let head = m[1];
  // Filename is Name_Pseudo_stamp — drop trailing _NA placeholder pseudonym
  head = head.replace(/_NA$/i, "");
  return safeSegment(head, "Employee");
}

/** One-shot backfill: {id}_{name}/{date}/file.jpg */
export async function backfillScreenshotsToWinshare(opts?: {
  limit?: number;
}): Promise<{ copied: number; skipped: number; failed: number }> {
  const root = winshareMirrorRoot();
  if (!root) return { copied: 0, skipped: 0, failed: 0 };

  const { GUARD_SCREENSHOTS_ROOT } = await import("@/lib/guard-screenshots");
  const limit = Math.max(1, Math.min(opts?.limit ?? 5000, 20000));
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  async function walk(dir: string, relParts: string[]): Promise<void> {
    if (copied + failed + skipped >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (copied + failed + skipped >= limit) return;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, [...relParts, ent.name]);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!/\.(jpe?g|png)$/i.test(ent.name)) continue;

      // relParts: [employeeId, dateFolder]
      const employeeId = relParts[0] || "unknown";
      const dateFolder = relParts[1] || "undated";
      const employeeName = nameFromScreenshotFile(ent.name);
      const shareRel = buildWinshareRelativePath({
        employeeId,
        employeeName,
        dateFolder,
        fileName: ent.name,
      });

      try {
        const dest = path.join(root, ...shareRel.split("/"));
        try {
          await fs.access(dest);
          skipped += 1;
          continue;
        } catch {
          /* copy */
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(abs, dest);
        copied += 1;
        if (copied % 5 === 0) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch {
        failed += 1;
      }
    }
  }

  await walk(GUARD_SCREENSHOTS_ROOT, []);
  return { copied, skipped, failed };
}
