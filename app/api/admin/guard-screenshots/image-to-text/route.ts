import { execFile } from "node:child_process";
import path from "node:path";
import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  isGalleryUnlocked,
  resolveScreenshotFile,
} from "@/lib/guard-screenshots";
import { enforcePolicyAfterOcr } from "@/lib/guard-keyword-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const TEXT_CACHE_ROOT = path.join(process.cwd(), "uploads", "guard-screenshot-text");
type ScanResult = {
  text: string;
  mode: string;
  provider: string;
  note?: string;
};

function cachePathFor(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) {
    throw new Error("Invalid path");
  }
  const file = path.join(TEXT_CACHE_ROOT, ...parts) + ".ocr.json";
  const root = path.resolve(TEXT_CACHE_ROOT);
  const abs = path.resolve(file);
  if (!abs.startsWith(root + path.sep)) throw new Error("Invalid path");
  return abs;
}

async function readCache(relativePath: string, imageMtimeMs: number) {
  try {
    const raw = await fs.readFile(cachePathFor(relativePath), "utf8");
    const saved = JSON.parse(raw) as { text?: string; mtimeMs?: number };
    if (saved.mtimeMs !== imageMtimeMs || !saved.text) return null;
    return saved.text;
  } catch {
    return null;
  }
}

async function writeCache(relativePath: string, imageMtimeMs: number, text: string) {
  const file = cachePathFor(relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ mtimeMs: imageMtimeMs, text }),
    "utf8"
  );
}

function scanInChild(absPath: string): Promise<ScanResult> {
  const script = path.join(process.cwd(), "image-to-text", "run-scan.js");
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--max-old-space-size=448", script, absPath],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 55000,
        maxBuffer: 1024 * 1024,
      },
      (err, stdout) => {
        const raw = String(stdout || "").trim();
        try {
          const parsed = JSON.parse(raw) as {
            ok?: boolean;
            text?: string;
            mode?: string;
            provider?: string;
            error?: string;
          };
          if (!parsed.ok) {
            reject(new Error(parsed.error || "Scan failed"));
            return;
          }
          resolve({
            text: parsed.text || "",
            mode: parsed.mode || "lines",
            provider: parsed.provider || "tesseract",
          });
          return;
        } catch {
          /* child crashed before printing JSON */
        }
        const killed = Boolean(
          err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed
        );
        reject(
          new Error(
            killed
              ? "Scan stopped because the server was low on memory. Try again."
              : "Image to text failed. Try again."
          )
        );
      }
    );
  });
}

/** RULE: never skip Policy check after Image→Text (words / sites / links / docs). */
function runMandatoryPolicyCheck(input: {
  abs: string;
  rel: string;
  employeeId: string;
  ocrText: string;
}) {
  if (!input.employeeId) return;
  void enforcePolicyAfterOcr({
    absolutePath: input.abs,
    relativePath: input.rel,
    employeeId: input.employeeId,
    ocrText: input.ocrText || "",
  }).then((result) => {
    if (!result.ok) {
      console.warn("[image-to-text] policy check failed:", result.error);
      return;
    }
    if (!result.skipped) {
      console.log(
        "[image-to-text] policy ticket",
        result.ticketNumber,
        result.matched
      );
    }
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      path?: string;
    } | null;
    const rel = String(body?.path || "").trim();
    if (!rel) {
      return NextResponse.json(
        { success: false, error: "path required" },
        { status: 400 }
      );
    }

    const abs = await resolveScreenshotFile(rel);
    const stat = await fs.stat(abs);
    if (stat.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "Screenshot is too large to scan" },
        { status: 413 }
      );
    }

    const employeeId =
      rel.replace(/\\/g, "/").split("/").filter(Boolean)[0] || "";

    const cached = await readCache(rel, stat.mtimeMs);
    if (cached != null) {
      runMandatoryPolicyCheck({
        abs,
        rel,
        employeeId,
        ocrText: cached,
      });
      return NextResponse.json({
        success: true,
        text: cached,
        mode: "lines",
        provider: "cache",
        note: null,
        fileName: path.basename(abs),
        policyChecked: true,
      });
    }

    const scanned = await scanInChild(abs);
    const text = scanned.text || "";

    if (text) {
      await writeCache(rel, stat.mtimeMs, text);
    }

    // Always run — even when OCR text is empty (evaluate returns no_match).
    runMandatoryPolicyCheck({
      abs,
      rel,
      employeeId,
      ocrText: text,
    });

    return NextResponse.json({
      success: true,
      text,
      mode: scanned.mode,
      provider: scanned.provider,
      note: null,
      fileName: path.basename(abs),
      policyChecked: true,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Scan failed";
    const msg = raw.replace(/key=[^&\s]+/gi, "key=redacted").slice(0, 300);
    const status = msg === "Not found" || msg === "Invalid path" ? 404 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
