import { pool } from "@/lib/db";
import { DESCRIPTOR_LENGTH } from "@/lib/face-types";

export const FACE_ENROLLMENT_TABLE = "employee_face_enrollment";

export type FaceEnrollmentRow = {
  id: number;
  employee_id: string;
  compreface_subject: string;
  compreface_image_id: string;
  local_path: string | null;
  face_descriptor: string | null;
  source: "upload" | "webcam";
  enrolled_by: string | null;
  created_at: string;
};

function parseDescriptorJson(raw: unknown): number[] | null {
  if (raw == null) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== DESCRIPTOR_LENGTH ||
    !parsed.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return null;
  }
  return parsed as number[];
}

export async function ensureFaceEnrollmentTable() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ${FACE_ENROLLMENT_TABLE} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL,
        compreface_subject VARCHAR(255) NOT NULL,
        compreface_image_id VARCHAR(64) NOT NULL,
        local_path VARCHAR(512) NULL,
        face_descriptor JSON NULL,
        source ENUM('upload','webcam') NOT NULL DEFAULT 'upload',
        enrolled_by VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_compreface_image (compreface_image_id),
        INDEX idx_employee (employee_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    try {
      await conn.execute(
        `ALTER TABLE ${FACE_ENROLLMENT_TABLE} ADD COLUMN face_descriptor JSON NULL`
      );
    } catch {
      // column already exists
    }
  } finally {
    conn.release();
  }
}

export async function getEnrollmentRowsForEmployee(
  employeeId: string
): Promise<FaceEnrollmentRow[]> {
  await ensureFaceEnrollmentTable();
  const id = String(employeeId || "").trim();
  if (!id) return [];
  // Use `=` so Mongo adapter flex-matches string/number employee_id (not IN)
  const [rows] = await pool.execute(
    `SELECT id, employee_id, compreface_subject, compreface_image_id, local_path,
            face_descriptor, source, enrolled_by,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS created_at
     FROM ${FACE_ENROLLMENT_TABLE}
     WHERE employee_id = ?
     ORDER BY created_at DESC`,
    [id]
  );
  return rows as FaceEnrollmentRow[];
}

export async function getEnrollmentRowsForEmployees(
  employeeIds: string[]
): Promise<FaceEnrollmentRow[]> {
  const ids = Array.from(
    new Set(employeeIds.map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (!ids.length) return [];
  const merged: FaceEnrollmentRow[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    for (const row of await getEnrollmentRowsForEmployee(id)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  merged.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return merged;
}

export async function countEnrollmentForEmployee(employeeId: string): Promise<number> {
  const rows = await getEnrollmentRowsForEmployee(employeeId);
  return rows.length;
}

export async function countDescriptorsForEmployee(employeeId: string): Promise<number> {
  const rows = await getEnrollmentRowsForEmployee(employeeId);
  return rows.filter((r) => parseDescriptorJson(r.face_descriptor)).length;
}

export type EmployeeEnrollmentContext = {
  subject: string | null;
  descriptors: number[][];
  count: number;
  descriptorCount: number;
};

export async function getDescriptorsForEmployee(
  employeeId: string
): Promise<EmployeeEnrollmentContext> {
  return getDescriptorsForEmployees([employeeId]);
}

export async function getDescriptorsForEmployees(
  employeeIds: string[]
): Promise<EmployeeEnrollmentContext> {
  const rows = await getEnrollmentRowsForEmployees(employeeIds);
  const descriptors = rows
    .map((r) => parseDescriptorJson(r.face_descriptor))
    .filter((d): d is number[] => !!d);
  return {
    subject: rows[0]?.compreface_subject ?? null,
    descriptors,
    count: rows.length,
    descriptorCount: descriptors.length,
  };
}

export async function insertEnrollmentRow(input: {
  employeeId: string;
  subject: string;
  imageId: string;
  localPath?: string | null;
  descriptor: number[];
  source: "upload" | "webcam";
  enrolledBy?: string | null;
}) {
  await ensureFaceEnrollmentTable();
  await pool.execute(
    `INSERT INTO ${FACE_ENROLLMENT_TABLE}
       (employee_id, compreface_subject, compreface_image_id, local_path, face_descriptor, source, enrolled_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.employeeId,
      input.subject,
      input.imageId,
      input.localPath ?? null,
      JSON.stringify(input.descriptor),
      input.source,
      input.enrolledBy ?? null,
    ]
  );
}

export async function getOtherEmployeesDescriptorSamples(
  excludeEmployeeId: string | string[]
): Promise<Array<{ employeeId: string; descriptors: number[][] }>> {
  await ensureFaceEnrollmentTable();
  const excludeIds = Array.from(
    new Set(
      (Array.isArray(excludeEmployeeId) ? excludeEmployeeId : [excludeEmployeeId])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  if (!excludeIds.length) return [];

  // Mongo adapter does not support NOT IN — use != then filter aliases in JS
  const primary = excludeIds[0];
  const [rows] = await pool.execute(
    `SELECT employee_id, face_descriptor
     FROM ${FACE_ENROLLMENT_TABLE}
     WHERE employee_id != ? AND face_descriptor IS NOT NULL
     ORDER BY employee_id, id DESC`,
    [primary]
  );

  const excludeSet = new Set<string>();
  for (const id of excludeIds) {
    excludeSet.add(id);
    if (/^\d+$/.test(id)) excludeSet.add(String(Number(id)));
  }

  const byEmployee = new Map<string, number[][]>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const empId = String(row.employee_id);
    if (excludeSet.has(empId) || excludeSet.has(String(Number(empId)))) continue;
    const desc = parseDescriptorJson(row.face_descriptor);
    if (!desc) continue;
    if (!byEmployee.has(empId)) byEmployee.set(empId, []);
    byEmployee.get(empId)!.push(desc);
  }

  return Array.from(byEmployee.entries()).map(([employeeId, descriptors]) => ({
    employeeId,
    descriptors,
  }));
}

export async function updateEnrollmentDescriptor(
  rowId: number,
  descriptor: number[]
): Promise<boolean> {
  await ensureFaceEnrollmentTable();
  const [result] = await pool.execute(
    `UPDATE ${FACE_ENROLLMENT_TABLE} SET face_descriptor = ? WHERE id = ?`,
    [JSON.stringify(descriptor), rowId]
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

export async function getEnrollmentRowById(id: number): Promise<FaceEnrollmentRow | null> {
  await ensureFaceEnrollmentTable();
  const [rows] = await pool.execute(
    `SELECT id, employee_id, compreface_subject, compreface_image_id, local_path, face_descriptor,
            source, enrolled_by,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS created_at
     FROM ${FACE_ENROLLMENT_TABLE} WHERE id = ?`,
    [id]
  );
  return (rows as FaceEnrollmentRow[])[0] ?? null;
}

export async function deleteEnrollmentRowById(id: number): Promise<FaceEnrollmentRow | null> {
  await ensureFaceEnrollmentTable();
  const [rows] = await pool.execute(
    `SELECT id, employee_id, compreface_subject, compreface_image_id, local_path, face_descriptor,
            source, enrolled_by,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS created_at
     FROM ${FACE_ENROLLMENT_TABLE} WHERE id = ?`,
    [id]
  );
  const row = (rows as FaceEnrollmentRow[])[0];
  if (!row) return null;
  await pool.execute(`DELETE FROM ${FACE_ENROLLMENT_TABLE} WHERE id = ?`, [id]);
  return row;
}
