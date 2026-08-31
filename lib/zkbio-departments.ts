import { pool } from "@/lib/db";

/** ZKBio device dept names + HRM departments (+ raw_json fallback) for filter dropdowns. */
export async function loadZkbioDepartmentNames(): Promise<string[]> {
  const [deptRows] = await pool.query(
    `SELECT DISTINCT TRIM(dept_name) AS d
     FROM zkbio_punch_log
     WHERE dept_name IS NOT NULL AND TRIM(dept_name) <> ''
     UNION
     SELECT DISTINCT TRIM(d.name) AS d
     FROM departments d
     WHERE d.name IS NOT NULL AND TRIM(d.name) <> ''
     UNION
     SELECT DISTINCT TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.deptName'))) AS d
     FROM zkbio_punch_log
     WHERE raw_json IS NOT NULL
       AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.deptName')), '')) <> ''
     ORDER BY d ASC
     LIMIT 2000`,
  );
  return (deptRows as { d: string }[]).map((r) => r.d).filter(Boolean);
}
