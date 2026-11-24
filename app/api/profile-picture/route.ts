import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import {
  deleteProfilePicture,
  getProfilePicturePath,
  getAllProfilePictureRows,
  profilePictureServeUrl,
  upsertProfilePicture,
  type ProfilePictureSubjectType,
} from "@/lib/profile-pictures-table";

const PICTURE_DIR = "profile-pictures";
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB — plenty for HD photos
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);
const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function isSubjectType(v: unknown): v is ProfilePictureSubjectType {
  return v === "employee" || v === "role" || v === "company_logo" || v === "shell_avatar";
}

async function unlinkPublicFile(relPath: string | null) {
  if (!relPath) return;
  try {
    const abs = path.join(process.cwd(), "public", relPath.replace(/^\/+/, ""));
    await fs.unlink(abs);
  } catch {
    /* file already gone — ignore */
  }
}

export async function GET() {
  try {
    const rows = await getAllProfilePictureRows();
    return NextResponse.json({ success: true, pictures: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load pictures" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const subjectType = formData.get("subjectType");
    // Always string — Mongo number vs string duplicates break refresh for some employees.
    const subjectId = String(formData.get("subjectId") ?? "").trim();
    const file = formData.get("file");

    if (!isSubjectType(subjectType) || !subjectId || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "subjectType, subjectId and file are required" },
        { status: 400 },
      );
    }
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) {
      return NextResponse.json(
        { success: false, error: "Please upload a PNG, JPG, WEBP or GIF image." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "Image must be 40 MB or smaller." },
        { status: 400 },
      );
    }

    const uploadRoot = path.join(process.cwd(), "public", "uploads", PICTURE_DIR);
    await fs.mkdir(uploadRoot, { recursive: true });

    const ext = EXT_BY_MIME[mime] || path.extname(file.name) || ".img";
    const unique = `${uuidv4()}${ext}`;
    const relPath = `/uploads/${PICTURE_DIR}/${unique}`;
    const absPath = path.join(uploadRoot, unique);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absPath, buf);

    // Remove the previous file for this subject (if any) after the new one is written.
    const oldPath = await getProfilePicturePath(subjectType, subjectId);
    await upsertProfilePicture(subjectType, subjectId, relPath, mime, file.size);
    if (oldPath && oldPath !== relPath) await unlinkPublicFile(oldPath);

    // Serve via the API route, not the static /uploads path (see file/[name]/route.ts).
    return NextResponse.json({ success: true, url: profilePictureServeUrl(relPath) });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to save picture" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const subjectType = params.get("subjectType");
    const subjectId = String(params.get("subjectId") ?? "").trim();
    if (!isSubjectType(subjectType) || !subjectId) {
      return NextResponse.json(
        { success: false, error: "subjectType and subjectId are required" },
        { status: 400 },
      );
    }
    const removed = await deleteProfilePicture(subjectType, subjectId);
    await unlinkPublicFile(removed);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to delete picture" },
      { status: 500 },
    );
  }
}
