import fs from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

/** Outside public/ so files are not served by static /api/uploads. */
export const GUARD_SCREENSHOTS_ROOT = path.join(
  process.cwd(),
  "uploads",
  "guard-screenshots"
);

export const GALLERY_COOKIE = "guard_ss_gallery";
export const GALLERY_COOKIE_MAX_AGE = 60 * 60 * 2; // 2 hours

export function galleryPassword(): string {
  return (
    process.env.GUARD_SCREENSHOT_GALLERY_PASSWORD?.trim() || "penPencil1122!"
  );
}

export function isGalleryUnlocked(req: NextRequest): boolean {
  return req.cookies.get(GALLERY_COOKIE)?.value === "1";
}

export function safeSegment(raw: string, fallback = "unknown"): string {
  const s = String(raw || "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Local wall-clock parts (server TZ / host clock). */
export function formatCaptureParts(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const HH = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return {
    dateFolder: `${yyyy}-${mm}-${dd}`,
    stamp: `${yyyy}-${mm}-${dd}_${HH}-${mi}-${ss}`,
  };
}

export type SaveScreenshotInput = {
  /** Image bytes (PNG or JPEG). */
  png: Buffer;
  employeeId: string;
  employeeName?: string;
  pseudonym?: string;
  capturedAt?: Date;
  /** File extension without dot — png | jpg */
  ext?: "png" | "jpg";
  /** Caller already checked disk/RAM — skip second gate (upload hot path). */
  skipStorageGate?: boolean;
};

export type SavedScreenshot = {
  relativePath: string;
  absolutePath: string;
  fileName: string;
};

/** Allocate final path (+ mkdir) without writing bytes — for streamed uploads. */
export async function allocateGuardScreenshotPath(input: {
  employeeId: string;
  employeeName?: string;
  pseudonym?: string;
  capturedAt?: Date;
  ext?: "png" | "jpg";
}): Promise<SavedScreenshot> {
  const employeeId = safeSegment(input.employeeId, "unknown");
  const name = safeSegment(input.employeeName || "", "Employee");
  const pseudo = safeSegment(input.pseudonym || "", "NA");
  const when =
    input.capturedAt && !Number.isNaN(input.capturedAt.getTime())
      ? input.capturedAt
      : new Date();
  const { dateFolder, stamp } = formatCaptureParts(when);
  const ext = input.ext === "jpg" ? "jpg" : "png";
  const fileName = `${name}_${pseudo}_${stamp}.${ext}`;
  const dir = path.join(GUARD_SCREENSHOTS_ROOT, employeeId, dateFolder);
  await fs.mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, fileName);
  const relativePath = path
    .join(employeeId, dateFolder, fileName)
    .split(path.sep)
    .join("/");
  return { relativePath, absolutePath, fileName };
}

export async function saveGuardScreenshot(
  input: SaveScreenshotInput
): Promise<SavedScreenshot> {
  if (!input.skipStorageGate) {
    const { assertScreenshotStorageWritable } = await import(
      "@/lib/guard-screenshot-retention"
    );
    const gate = await assertScreenshotStorageWritable();
    if (!gate.ok) {
      throw new Error(gate.reason || "screenshot storage unavailable");
    }
  }

  const dest = await allocateGuardScreenshotPath(input);
  try {
    await fs.writeFile(dest.absolutePath, input.png);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOSPC|no space/i.test(msg)) {
      throw new Error("disk full — screenshot not saved");
    }
    throw err;
  }
  return dest;
}

export type ScreenshotEmployeeSummary = {
  employeeId: string;
  count: number;
  latestAt: string | null;
  sampleName: string | null;
  samplePseudonym: string | null;
};

export type ScreenshotFileRow = {
  relativePath: string;
  fileName: string;
  employeeId: string;
  dateFolder: string;
  size: number;
  mtimeMs: number;
  capturedAt: string;
};

function isScreenshotImageName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg")
  );
}

function stripImageExt(fileName: string): string {
  return fileName.replace(/\.(png|jpe?g)$/i, "");
}

function parseNameParts(fileName: string): {
  name: string | null;
  pseudonym: string | null;
} {
  // SafeName_SafePseudo_yyyy-MM-dd_HH-mm-ss.(png|jpg)
  const base = stripImageExt(fileName);
  const m = base.match(/^(.+)_(.+)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})$/);
  if (!m) return { name: null, pseudonym: null };
  return { name: m[1], pseudonym: m[2] };
}

function capturedAtFromName(fileName: string, mtimeMs: number): string {
  const base = stripImageExt(fileName);
  const m = base.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (m) {
    return `${m[1]}T${m[2]}:${m[3]}:${m[4]}`;
  }
  return new Date(mtimeMs).toISOString();
}

export async function listScreenshotEmployees(): Promise<
  ScreenshotEmployeeSummary[]
> {
  try {
    await fs.mkdir(GUARD_SCREENSHOTS_ROOT, { recursive: true });
    const empDirs = await fs.readdir(GUARD_SCREENSHOTS_ROOT, {
      withFileTypes: true,
    });
    const out: ScreenshotEmployeeSummary[] = [];
    for (const ent of empDirs) {
      if (!ent.isDirectory()) continue;
      const employeeId = ent.name;
      let count = 0;
      let latestAt: string | null = null;
      let latestMs = 0;
      let sampleName: string | null = null;
      let samplePseudonym: string | null = null;
      const dateDirs = await fs.readdir(
        path.join(GUARD_SCREENSHOTS_ROOT, employeeId),
        { withFileTypes: true }
      );
      for (const d of dateDirs) {
        if (!d.isDirectory()) continue;
        const files = await fs.readdir(
          path.join(GUARD_SCREENSHOTS_ROOT, employeeId, d.name),
          { withFileTypes: true }
        );
        for (const f of files) {
          if (!f.isFile() || !isScreenshotImageName(f.name)) continue;
          count += 1;
          const st = await fs.stat(
            path.join(GUARD_SCREENSHOTS_ROOT, employeeId, d.name, f.name)
          );
          if (st.mtimeMs >= latestMs) {
            latestMs = st.mtimeMs;
            latestAt = capturedAtFromName(f.name, st.mtimeMs);
            const parts = parseNameParts(f.name);
            sampleName = parts.name;
            samplePseudonym = parts.pseudonym;
          }
        }
      }
      if (count > 0) {
        out.push({
          employeeId,
          count,
          latestAt,
          sampleName,
          samplePseudonym,
        });
      }
    }
    out.sort((a, b) => (b.latestAt || "").localeCompare(a.latestAt || ""));
    return out;
  } catch {
    return [];
  }
}

export async function listDateFoldersForEmployee(
  employeeIdRaw: string
): Promise<string[]> {
  const employeeId = safeSegment(employeeIdRaw, "");
  if (!employeeId) return [];
  const empRoot = path.join(GUARD_SCREENSHOTS_ROOT, employeeId);
  try {
    const dateDirs = await fs.readdir(empRoot, { withFileTypes: true });
    return dateDirs
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export type ListScreenshotsOpts = {
  employeeId: string;
  /** yyyy-MM-dd — only scan that day folder (fast). */
  date?: string;
  /** HH:mm or HH:mm:ss inclusive */
  timeFrom?: string;
  /** HH:mm or HH:mm:ss inclusive */
  timeTo?: string;
  page?: number;
  pageSize?: number;
};

function timeToSeconds(raw: string): number | null {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3] || 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

function capturedTimeSeconds(capturedAt: string): number | null {
  const m = capturedAt.match(/T(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function listScreenshotsForEmployee(
  opts: ListScreenshotsOpts | string
): Promise<{ files: ScreenshotFileRow[]; total: number; page: number; pageSize: number }> {
  const o: ListScreenshotsOpts =
    typeof opts === "string" ? { employeeId: opts } : opts;
  const employeeId = safeSegment(o.employeeId, "");
  const page = Math.max(1, Math.floor(o.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(o.pageSize || 24)));
  if (!employeeId) return { files: [], total: 0, page, pageSize };

  const empRoot = path.join(GUARD_SCREENSHOTS_ROOT, employeeId);
  const dateFilter =
    o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date.trim()) ? o.date.trim() : "";
  const fromSec = o.timeFrom ? timeToSeconds(o.timeFrom) : null;
  const toSec = o.timeTo ? timeToSeconds(o.timeTo) : null;

  try {
    let dateNames: string[];
    if (dateFilter) {
      dateNames = [dateFilter];
    } else {
      const dateDirs = await fs.readdir(empRoot, { withFileTypes: true });
      dateNames = dateDirs
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a));
    }

    const rows: ScreenshotFileRow[] = [];
    for (const dName of dateNames) {
      const dir = path.join(empRoot, dName);
      let files: { name: string; isFile: () => boolean }[];
      try {
        files = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !isScreenshotImageName(f.name)) continue;
        const abs = path.join(dir, f.name);
        let st: Awaited<ReturnType<typeof fs.stat>>;
        try {
          st = await fs.stat(abs);
        } catch {
          continue;
        }
        const capturedAt = capturedAtFromName(f.name, st.mtimeMs);
        if (fromSec != null || toSec != null) {
          const t = capturedTimeSeconds(capturedAt);
          if (t == null) continue;
          if (fromSec != null && t < fromSec) continue;
          if (toSec != null && t > toSec) continue;
        }
        rows.push({
          relativePath: [employeeId, dName, f.name].join("/"),
          fileName: f.name,
          employeeId,
          dateFolder: dName,
          size: st.size,
          mtimeMs: st.mtimeMs,
          capturedAt,
        });
      }
    }
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return {
      files: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    };
  } catch {
    return { files: [], total: 0, page, pageSize };
  }
}

export async function deleteScreenshotFiles(
  relativePaths: string[]
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const rel of relativePaths) {
    try {
      const abs = await resolveScreenshotFile(rel);
      await fs.unlink(abs);
      deleted.push(rel);
      // Best-effort: remove empty date / employee dirs
      try {
        const dateDir = path.dirname(abs);
        const left = await fs.readdir(dateDir);
        if (left.length === 0) await fs.rmdir(dateDir);
      } catch {
        /* ignore */
      }
    } catch {
      failed.push(rel);
    }
  }
  return { deleted, failed };
}

export async function deleteScreenshotsForDay(
  employeeIdRaw: string,
  dateFolder: string
): Promise<number> {
  const employeeId = safeSegment(employeeIdRaw, "");
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(dateFolder)) return 0;
  const dir = path.join(GUARD_SCREENSHOTS_ROOT, employeeId, dateFolder);
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const f of files) {
      if (!f.isFile() || !isScreenshotImageName(f.name)) continue;
      await fs.unlink(path.join(dir, f.name));
      n += 1;
    }
    try {
      await fs.rmdir(dir);
    } catch {
      /* ignore */
    }
    return n;
  } catch {
    return 0;
  }
}

/** Resolve a relative path under the screenshots root; throws on traversal. */
export async function resolveScreenshotFile(
  relativePath: string
): Promise<string> {
  const parts = String(relativePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (
    !parts.length ||
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        p.includes("\0") ||
        p.includes("\\")
    )
  ) {
    throw new Error("Invalid path");
  }
  await fs.mkdir(GUARD_SCREENSHOTS_ROOT, { recursive: true });
  const abs = path.join(GUARD_SCREENSHOTS_ROOT, ...parts);
  const realRoot = await fs.realpath(GUARD_SCREENSHOTS_ROOT);
  let realFile: string;
  try {
    realFile = await fs.realpath(abs);
  } catch {
    throw new Error("Not found");
  }
  if (!realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
    throw new Error("Invalid path");
  }
  if (!isScreenshotImageName(path.basename(realFile))) {
    throw new Error("Invalid path");
  }
  return realFile;
}
