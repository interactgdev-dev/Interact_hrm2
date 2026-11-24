import { pool } from "@/lib/db";
import { SHELL_SUBJECT_IDS } from "@/lib/shell-branding-constants";
import { getAllProfilePictureRows, profilePictureServeUrl } from "@/lib/profile-pictures-table";

export const ORG_CHART_PHOTOS_TABLE = "hrm_org_chart_photos";

export type OrgChartPhotoSubjectType =
  | "employee"
  | "role"
  | "company_logo"
  | "shell_avatar";

export type OrgChartPhotoRow = {
  id: number;
  subject_type: OrgChartPhotoSubjectType;
  subject_id: string;
  photo_data: string;
  mime_type: string;
};

async function migrateSubjectTypeEnum(conn: Awaited<ReturnType<typeof pool.getConnection>>) {
  await conn.execute(`
    ALTER TABLE ${ORG_CHART_PHOTOS_TABLE}
    MODIFY COLUMN subject_type ENUM('employee', 'role', 'company_logo', 'shell_avatar') NOT NULL
  `);
}

export async function ensureOrgChartPhotosTable() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ${ORG_CHART_PHOTOS_TABLE} (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        subject_type ENUM('employee', 'role', 'company_logo', 'shell_avatar') NOT NULL,
        subject_id VARCHAR(64) NOT NULL,
        photo_data LONGTEXT NOT NULL,
        mime_type VARCHAR(64) NOT NULL DEFAULT 'image/jpeg',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_org_chart_photo_subject (subject_type, subject_id),
        KEY idx_org_chart_photo_type (subject_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    try {
      await migrateSubjectTypeEnum(conn);
    } catch {
      /* enum already up to date */
    }
  } finally {
    conn.release();
  }
}

export function parseDataUrlMime(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/i.exec(dataUrl);
  return match?.[1]?.trim() || "image/jpeg";
}

export async function getAllOrgChartPhotos(): Promise<{
  employeePhotos: Record<string, string>;
  rolePhotos: Record<string, string>;
  shellBranding: {
    companyLogo: string | null;
    adminAvatar: string | null;
    employeeAvatars: Record<string, string>;
  };
}> {
  await ensureOrgChartPhotosTable();
  const [rows] = await pool.execute(
    `SELECT subject_type, subject_id, photo_data
     FROM ${ORG_CHART_PHOTOS_TABLE}`,
  );
  const employeePhotos: Record<string, string> = {};
  const rolePhotos: Record<string, string> = {};
  const shellBranding = {
    companyLogo: null as string | null,
    adminAvatar: null as string | null,
    employeeAvatars: {} as Record<string, string>,
  };

  // New file-based profile pictures take precedence over legacy base64 rows,
  // so append them AFTER the org_chart rows (they overwrite in the maps below).
  const profileRows = await getAllProfilePictureRows();
  const combined = [
    ...(rows as Array<{
      subject_type: OrgChartPhotoSubjectType;
      subject_id: string;
      photo_data: string;
    }>),
    ...profileRows.map((p) => ({
      subject_type: p.subject_type as OrgChartPhotoSubjectType,
      subject_id: p.subject_id,
      photo_data: profilePictureServeUrl(p.file_path),
    })),
  ];

  for (const row of combined) {
    const sid = String(row.subject_id ?? "").trim();
    if (!sid) continue;
    if (row.subject_type === "employee") {
      employeePhotos[sid] = row.photo_data;
    } else if (row.subject_type === "role") {
      rolePhotos[sid] = row.photo_data;
    } else if (row.subject_type === "company_logo") {
      shellBranding.companyLogo = row.photo_data;
    } else if (row.subject_type === "shell_avatar") {
      if (sid === SHELL_SUBJECT_IDS.adminAvatar) {
        shellBranding.adminAvatar = row.photo_data;
      } else {
        shellBranding.employeeAvatars[sid] = row.photo_data;
      }
    }
  }

  return { employeePhotos, rolePhotos, shellBranding };
}

export async function upsertOrgChartPhoto(
  subjectType: OrgChartPhotoSubjectType,
  subjectId: string,
  photoData: string,
) {
  await ensureOrgChartPhotosTable();
  const mime = parseDataUrlMime(photoData);
  await pool.execute(
    `INSERT INTO ${ORG_CHART_PHOTOS_TABLE} (subject_type, subject_id, photo_data, mime_type)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       photo_data = VALUES(photo_data),
       mime_type = VALUES(mime_type),
       updated_at = CURRENT_TIMESTAMP`,
    [subjectType, subjectId, photoData, mime],
  );
}

export async function deleteOrgChartPhoto(
  subjectType: OrgChartPhotoSubjectType,
  subjectId: string,
): Promise<boolean> {
  await ensureOrgChartPhotosTable();
  const [result] = await pool.execute(
    `DELETE FROM ${ORG_CHART_PHOTOS_TABLE}
     WHERE subject_type = ? AND subject_id = ?`,
    [subjectType, subjectId],
  );
  return ((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}
