import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import {
  allocateGuardScreenshotPath,
  saveGuardScreenshot,
} from "@/lib/guard-screenshots";
import {
  endScreenshotUpload,
  enqueueScreenshotPolicyScan,
  tryBeginScreenshotUpload,
} from "@/lib/guard-screenshot-ingest";
import { assertScreenshotStorageWritable } from "@/lib/guard-screenshot-retention";
import { enqueueScreenshotWinshareMirror } from "@/lib/guard-screenshot-winshare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keep uploads small — gallery quality does not need 12MB frames. */
const MAX_BYTES = 3 * 1024 * 1024; // 3MB

function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function decodeHeader(raw: string | null) {
  const v = String(raw || "").trim();
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function busyJson(seconds: number, error: string) {
  return NextResponse.json(
    { success: false, error, retry_after_seconds: seconds },
    { status: 503, headers: { "Retry-After": String(seconds) } },
  );
}

/**
 * Stream raw body to disk with a hard size cap — avoids holding full JPEG in heap.
 * Returns bytes written + magic header for format check.
 */
async function streamRawBodyToFile(
  req: NextRequest,
  absolutePath: string,
): Promise<{ bytes: number; header: Buffer }> {
  const body = req.body;
  if (!body) throw new Error("empty body");

  const reader = body.getReader();
  const fh = await fs.open(absolutePath, "w");
  let total = 0;
  const header = Buffer.alloc(8);
  let headerLen = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        throw new Error("image size invalid (max 3MB)");
      }
      const chunk = Buffer.from(value);
      if (headerLen < 8) {
        const n = Math.min(8 - headerLen, chunk.length);
        chunk.copy(header, headerLen, 0, n);
        headerLen += n;
      }
      await fh.write(chunk);
    }
  } catch (err) {
    try {
      await fh.close();
    } catch {
      /* ignore */
    }
    try {
      await fs.unlink(absolutePath);
    } catch {
      /* ignore */
    }
    throw err;
  }
  await fh.close();
  if (total <= 0) {
    try {
      await fs.unlink(absolutePath);
    } catch {
      /* ignore */
    }
    throw new Error("image size invalid (max 3MB)");
  }
  return { bytes: total, header: header.subarray(0, Math.min(8, headerLen)) };
}

export async function POST(req: NextRequest) {
  // 1) Cheap rejects before allocating upload slot / reading body
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: "image size invalid (max 3MB)" },
      { status: 400 },
    );
  }

  const storage = await assertScreenshotStorageWritable();
  if (!storage.ok) {
    return busyJson(60, storage.reason || "storage unavailable");
  }

  if (!tryBeginScreenshotUpload()) {
    return busyJson(15, "server busy — retry later");
  }

  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    const employeeId = decodeHeader(req.headers.get("x-employee-id"));
    const employeeName = decodeHeader(req.headers.get("x-employee-name"));
    const pseudonym = decodeHeader(req.headers.get("x-pseudonym"));
    const capturedAtRaw = decodeHeader(req.headers.get("x-captured-at"));

    let capturedAt: Date | undefined;
    if (capturedAtRaw) {
      const d = new Date(capturedAtRaw);
      if (!Number.isNaN(d.getTime())) capturedAt = d;
    }

    // Preferred: Interact Guard raw JPEG/PNG stream → disk (low RAM).
    if (
      ct.includes("image/png") ||
      ct.includes("image/jpeg") ||
      ct.includes("image/jpg") ||
      ct.includes("application/octet-stream")
    ) {
      if (!employeeId) {
        return NextResponse.json(
          { success: false, error: "employee_id required" },
          { status: 400 },
        );
      }

      const hintExt: "png" | "jpg" =
        ct.includes("png") && !ct.includes("jpeg") && !ct.includes("jpg")
          ? "png"
          : "jpg";

      const dest = await allocateGuardScreenshotPath({
        employeeId,
        employeeName,
        pseudonym,
        capturedAt,
        ext: hintExt,
      });

      const { header } = await streamRawBodyToFile(req, dest.absolutePath);
      const okJpeg = isJpeg(header);
      const okPng = isPng(header);
      if (!okJpeg && !okPng) {
        try {
          await fs.unlink(dest.absolutePath);
        } catch {
          /* ignore */
        }
        return NextResponse.json(
          { success: false, error: "PNG or JPEG required" },
          { status: 400 },
        );
      }

      // If magic disagrees with content-type hint, rename extension.
      const finalExt: "png" | "jpg" = okJpeg ? "jpg" : "png";
      let absolutePath = dest.absolutePath;
      let relativePath = dest.relativePath;
      let fileName = dest.fileName;
      if (finalExt !== hintExt) {
        const corrected = await allocateGuardScreenshotPath({
          employeeId,
          employeeName,
          pseudonym,
          capturedAt,
          ext: finalExt,
        });
        await fs.rename(dest.absolutePath, corrected.absolutePath);
        absolutePath = corrected.absolutePath;
        relativePath = corrected.relativePath;
        fileName = corrected.fileName;
      }

      // OCR only after response path — never during upload slot work beyond enqueue.
      enqueueScreenshotPolicyScan({
        absolutePath,
        relativePath,
        employeeId,
        employeeName,
        pseudonym,
      });
      // Optional CIFS winshare mirror — never awaited (HRM stays responsive).
      // Share layout: {id}_{Name}/{date}/{file}.jpg
      enqueueScreenshotWinshareMirror({
        absolutePath,
        relativePath,
        employeeId,
        employeeName,
        fileName,
      });

      return NextResponse.json({
        success: true,
        path: relativePath,
        fileName,
        stored: "server",
      });
    }

    // Fallback: multipart (rare / curl) — small buffer path
    const form = await req.formData();
    const image = form.get("image");
    if (!(image instanceof Blob) || image.size <= 0) {
      return NextResponse.json(
        { success: false, error: "image required" },
        { status: 400 },
      );
    }
    if (image.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "image size invalid (max 3MB)" },
        { status: 400 },
      );
    }
    const emp =
      String(form.get("employee_id") || "").trim() || employeeId;
    if (!emp) {
      return NextResponse.json(
        { success: false, error: "employee_id required" },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!isPng(bytes) && !isJpeg(bytes)) {
      return NextResponse.json(
        { success: false, error: "PNG or JPEG required" },
        { status: 400 },
      );
    }
    const saved = await saveGuardScreenshot({
      png: bytes,
      employeeId: emp,
      employeeName:
        String(form.get("employee_name") || "").trim() || employeeName,
      pseudonym: String(form.get("pseudonym") || "").trim() || pseudonym,
      capturedAt,
      ext: isJpeg(bytes) ? "jpg" : "png",
      skipStorageGate: true,
    });
    enqueueScreenshotPolicyScan({
      absolutePath: saved.absolutePath,
      relativePath: saved.relativePath,
      employeeId: emp,
      employeeName: saved.fileName,
      pseudonym,
    });
    enqueueScreenshotWinshareMirror({
      absolutePath: saved.absolutePath,
      relativePath: saved.relativePath,
      employeeId: emp,
      employeeName:
        String(form.get("employee_name") || "").trim() || employeeName,
      fileName: saved.fileName,
    });
    return NextResponse.json({
      success: true,
      path: saved.relativePath,
      fileName: saved.fileName,
      stored: "server",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (/size invalid|max 3MB/i.test(msg)) {
      return NextResponse.json(
        { success: false, error: msg },
        { status: 400 },
      );
    }
    if (/low disk|low memory|disk full|storage/i.test(msg)) {
      return busyJson(60, msg);
    }
    console.error("[guard/screenshots] upload failed", err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 },
    );
  } finally {
    endScreenshotUpload();
  }
}
