import { query } from "@/lib/db";

export async function getEmployeePseudonym(employeeId: string): Promise<string | null> {
  try {
    const id = String(employeeId ?? "").trim();
    if (!id) return null;
    const [rows]: any = await query(
      `SELECT TRIM(pseudonym) AS pseudonym
       FROM hrm_employees
       WHERE CAST(id AS CHAR) = ? OR employee_code = ?
       LIMIT 1`,
      [id, id]
    );
    const pseudonym = rows?.[0]?.pseudonym;
    return typeof pseudonym === "string" && pseudonym.trim() ? pseudonym.trim() : null;
  } catch {
    return null;
  }
}

export type EmployeeTicketMeta = {
  pseudonym: string | null;
  department_name: string | null;
};

/** Batch lookup for Ticket Inbox search (name / pseudonym / department). */
export async function getEmployeeTicketMetaMap(
  employeeIds: Array<string | number | null | undefined>,
): Promise<Map<string, EmployeeTicketMeta>> {
  const map = new Map<string, EmployeeTicketMeta>();
  const ids = [
    ...new Set(
      employeeIds.map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length === 0) return map;

  try {
    const placeholders = ids.map(() => "?").join(",");
    const [rows]: any = await query(
      `SELECT e.id, e.employee_code,
              TRIM(e.pseudonym) AS pseudonym,
              d.name AS department_name
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id
       WHERE CAST(e.id AS CHAR) IN (${placeholders})
          OR e.employee_code IN (${placeholders})`,
      [...ids, ...ids],
    );
    for (const r of Array.isArray(rows) ? rows : []) {
      const pseudo =
        typeof r.pseudonym === "string" && r.pseudonym.trim()
          ? String(r.pseudonym).trim()
          : null;
      const dept =
        typeof r.department_name === "string" && r.department_name.trim()
          ? String(r.department_name).trim()
          : null;
      const meta: EmployeeTicketMeta = {
        pseudonym: pseudo,
        department_name: dept,
      };
      const idKey = String(r.id ?? "").trim();
      const codeKey = String(r.employee_code ?? "").trim();
      if (idKey) map.set(idKey, meta);
      if (codeKey) map.set(codeKey, meta);
    }
  } catch {
    /* empty map — UI still works without meta */
  }
  return map;
}
