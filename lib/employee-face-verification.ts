import { pool } from "@/lib/db";
import { ensureFaceEnrollmentTable } from "@/lib/face-enrollment-table";
import { isFaceVerificationEnabled } from "@/lib/face-matching";
import { resolveEmployeeDbId } from "@/lib/resolve-employee-id";

let columnReady: Promise<void> | null = null;

export async function ensureFaceVerificationColumn(): Promise<void> {
  if (columnReady) return columnReady;
  columnReady = (async () => {
    try {
      await pool.execute(
        `ALTER TABLE hrm_employees
         ADD COLUMN face_verification_enabled TINYINT(1) NOT NULL DEFAULT 0`
      );
    } catch {
      // column already exists
    }
  })();
  return columnReady;
}

export async function isEmployeeFaceVerificationEnabled(
  employeeId: string
): Promise<boolean> {
  if (!isFaceVerificationEnabled()) return false;

  await ensureFaceVerificationColumn();
  const id = (await resolveEmployeeDbId(employeeId)) || String(employeeId).trim();
  if (!id) return false;

  try {
    const [rows] = await pool.execute(
      `SELECT face_verification_enabled FROM hrm_employees WHERE id = ? LIMIT 1`,
      [id]
    );
    const row = (rows as Array<{ face_verification_enabled?: number }>)[0];
    if (!row) return false;
    return Number(row.face_verification_enabled ?? 0) === 1;
  } catch {
    return false;
  }
}

export async function setEmployeeFaceVerificationEnabled(
  employeeId: string,
  enabled: boolean
): Promise<boolean> {
  await ensureFaceVerificationColumn();
  const id = (await resolveEmployeeDbId(employeeId)) || String(employeeId).trim();
  if (!id) return false;

  try {
    const [result] = await pool.execute(
      `UPDATE hrm_employees SET face_verification_enabled = ? WHERE id = ?`,
      [enabled ? 1 : 0, id]
    );
    return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Bulk Active / Inactive for face verification. */
export async function setEmployeesFaceVerificationEnabled(
  employeeIds: Array<string | number>,
  enabled: boolean
): Promise<number> {
  await ensureFaceVerificationColumn();
  const ids = [
    ...new Set(
      employeeIds
        .map((v) => String(v ?? "").trim())
        .filter((v) => v.length > 0 && /^\d+$/.test(v))
    ),
  ];
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(",");
  try {
    const [result] = await pool.execute(
      `UPDATE hrm_employees SET face_verification_enabled = ? WHERE id IN (${placeholders})`,
      [enabled ? 1 : 0, ...ids]
    );
    return Number((result as { affectedRows?: number }).affectedRows ?? 0);
  } catch {
    return 0;
  }
}

export type EmployeeFaceVerificationRow = {
  id: number;
  name: string;
  pseudonym: string | null;
  employee_code: string | null;
  department: string | null;
  face_verification_enabled: boolean;
  photo_count: number;
  descriptor_count: number;
};

export async function listEmployeesFaceVerification(): Promise<EmployeeFaceVerificationRow[]> {
  await Promise.all([ensureFaceVerificationColumn(), ensureFaceEnrollmentTable()]);

  // One joined query (was 3 full-table scans) — keeps Face Enrollment page snappy.
  const [rows] = await pool.query(`
    SELECT
      e.id,
      e.first_name,
      e.last_name,
      e.pseudonym,
      e.employee_code,
      d.name AS department_name,
      COALESCE(e.face_verification_enabled, 0) AS face_verification_enabled,
      COALESCE(fe.photo_count, 0) AS photo_count,
      COALESCE(fe.descriptor_count, 0) AS descriptor_count
    FROM hrm_employees e
    LEFT JOIN employee_jobs j ON e.id = j.employee_id
    LEFT JOIN departments d ON j.department_id = d.id
    LEFT JOIN (
      SELECT
        employee_id,
        COUNT(*) AS photo_count,
        SUM(CASE WHEN face_descriptor IS NOT NULL THEN 1 ELSE 0 END) AS descriptor_count
      FROM employee_face_enrollment
      GROUP BY employee_id
    ) fe ON fe.employee_id = e.id
    WHERE e.status IS NULL OR e.status IN ('enabled', 'active', 'Enabled', 'Active')
    ORDER BY e.id ASC
  `);

  const seen = new Set<number>();
  const out: EmployeeFaceVerificationRow[] = [];
  for (const raw of rows as Array<Record<string, unknown>>) {
    const id = Number(raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = [raw.first_name, raw.last_name]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(" ");
    out.push({
      id,
      name: name || `Employee ${id}`,
      pseudonym: raw.pseudonym != null ? String(raw.pseudonym) : null,
      employee_code: raw.employee_code != null ? String(raw.employee_code) : null,
      department: raw.department_name != null ? String(raw.department_name) : null,
      face_verification_enabled: Number(raw.face_verification_enabled ?? 0) === 1,
      photo_count: Number(raw.photo_count ?? 0),
      descriptor_count: Number(raw.descriptor_count ?? 0),
    });
  }
  return out;
}
