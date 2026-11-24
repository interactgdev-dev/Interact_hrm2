import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";

export const PROFILE_PICTURES_TABLE = "hrm_profile_pictures";

export type ProfilePictureSubjectType =
  | "employee"
  | "role"
  | "company_logo"
  | "shell_avatar";

export type ProfilePictureRow = {
  subject_type: ProfilePictureSubjectType;
  subject_id: string;
  file_path: string;
};

/** Always store/lookup subject ids as strings (avoids Mongo number vs string duplicates). */
export function normalizeProfileSubjectId(subjectId: string | number): string {
  return String(subjectId ?? "").trim();
}

/**
 * Turn a stored disk path (e.g. `/uploads/profile-pictures/uuid.jpg`) into a URL
 * that is served by an API route. Next.js production only serves files that were
 * in `public/` at build time — files uploaded at runtime 404 — so we stream them
 * through `/api/profile-picture/file/<name>` instead of linking the static path.
 */
export function profilePictureServeUrl(filePath: string): string {
  const name = filePath.split("/").filter(Boolean).pop() ?? "";
  return `/api/profile-picture/file/${encodeURIComponent(name)}`;
}

export async function upsertProfilePicture(
  subjectType: ProfilePictureSubjectType,
  subjectId: string | number,
  filePath: string,
  mime: string,
  size: number,
) {
  const sid = normalizeProfileSubjectId(subjectId);
  if (!sid) throw new Error("subjectId required");
  await pool.execute(
    `INSERT INTO ${PROFILE_PICTURES_TABLE}
       (subject_type, subject_id, file_path, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       file_path = VALUES(file_path),
       mime_type = VALUES(mime_type),
       file_size = VALUES(file_size),
       updated_at = CURRENT_TIMESTAMP`,
    [subjectType, sid, filePath, mime, size],
  );
}

export async function getProfilePicturePath(
  subjectType: ProfilePictureSubjectType,
  subjectId: string | number,
): Promise<string | null> {
  const sid = normalizeProfileSubjectId(subjectId);
  if (!sid) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT file_path FROM ${PROFILE_PICTURES_TABLE}
     WHERE subject_type = ? AND subject_id = ? LIMIT 1`,
    [subjectType, sid],
  );
  if (rows[0]?.file_path) return String(rows[0].file_path);

  // Legacy rows may have numeric subject_id in Mongo — try that once.
  if (/^\d+$/.test(sid)) {
    try {
      const [numRows] = await pool.execute<RowDataPacket[]>(
        `SELECT file_path FROM ${PROFILE_PICTURES_TABLE}
         WHERE subject_type = ? AND subject_id = ? LIMIT 1`,
        [subjectType, Number(sid)],
      );
      if (numRows[0]?.file_path) return String(numRows[0].file_path);
    } catch {
      /* ignore */
    }
  }
  return null;
}

type RawPicRow = ProfilePictureRow & {
  updated_at?: string | Date | null;
  file_size?: number | null;
};

/**
 * All profile-picture rows, subject_id normalized to string.
 * Duplicate string/number ids collapse to one row (newest / non-empty path wins).
 */
export async function getAllProfilePictureRows(): Promise<ProfilePictureRow[]> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT subject_type, subject_id, file_path, updated_at, file_size
       FROM ${PROFILE_PICTURES_TABLE}`,
    );
    const best = new Map<string, RawPicRow>();
    for (const raw of rows as RawPicRow[]) {
      const subject_type = raw.subject_type as ProfilePictureSubjectType;
      const subject_id = normalizeProfileSubjectId(raw.subject_id as string | number);
      const file_path = String(raw.file_path || "").trim();
      if (!subject_type || !subject_id || !file_path) continue;
      const key = `${subject_type}:${subject_id}`;
      const prev = best.get(key);
      if (!prev) {
        best.set(key, { subject_type, subject_id, file_path, updated_at: raw.updated_at });
        continue;
      }
      const prevTs = prev.updated_at ? new Date(prev.updated_at).getTime() : 0;
      const nextTs = raw.updated_at ? new Date(raw.updated_at).getTime() : 0;
      if (nextTs >= prevTs) {
        best.set(key, { subject_type, subject_id, file_path, updated_at: raw.updated_at });
      }
    }
    return [...best.values()].map(({ subject_type, subject_id, file_path }) => ({
      subject_type,
      subject_id,
      file_path,
    }));
  } catch {
    return [];
  }
}

/** Deletes the row and returns the removed file path (so the caller can unlink it). */
export async function deleteProfilePicture(
  subjectType: ProfilePictureSubjectType,
  subjectId: string | number,
): Promise<string | null> {
  const sid = normalizeProfileSubjectId(subjectId);
  const existing = await getProfilePicturePath(subjectType, sid);
  await pool.execute(
    `DELETE FROM ${PROFILE_PICTURES_TABLE}
     WHERE subject_type = ? AND subject_id = ?`,
    [subjectType, sid],
  );
  // Also remove legacy numeric-id duplicate if present.
  if (/^\d+$/.test(sid)) {
    try {
      await pool.execute(
        `DELETE FROM ${PROFILE_PICTURES_TABLE}
         WHERE subject_type = ? AND subject_id = ?`,
        [subjectType, Number(sid)],
      );
    } catch {
      /* ignore */
    }
  }
  return existing;
}
