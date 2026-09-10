import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

/**
 * Runtime uploads live under public/uploads, but Next.js production does not
 * serve files added after build. Stream them from disk instead.
 */
const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const parts = (await ctx.params).path || [];
    if (!parts.length) {
      return NextResponse.json({ success: false, error: "Missing path" }, { status: 400 });
    }

    // Block traversal: only plain path segments
    if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) {
      return NextResponse.json({ success: false, error: "Invalid path" }, { status: 400 });
    }

    const absPath = path.join(UPLOAD_ROOT, ...parts);
    const realUpload = await fs.realpath(UPLOAD_ROOT);
    const realFile = await fs.realpath(absPath);
    if (!realFile.startsWith(realUpload + path.sep) && realFile !== realUpload) {
      return NextResponse.json({ success: false, error: "Invalid path" }, { status: 403 });
    }

    const buf = await fs.readFile(realFile);
    const ext = path.extname(realFile).toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXT[ext] || "application/octet-stream";
    const isPdf = ext === ".pdf";

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...(isPdf
          ? { "Content-Disposition": `inline; filename="${path.basename(realFile)}"` }
          : {}),
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
}
