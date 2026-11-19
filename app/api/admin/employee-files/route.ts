import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";

function viewerIdFrom(req: NextRequest) {
  return (
    req.headers.get("x-hrm-employee-id") ||
    req.headers.get("x-employee-id") ||
    req.nextUrl.searchParams.get("viewerId") ||
    ""
  ).trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const departmentId = searchParams.get("departmentId");

    // One row per employee: multiple employee_jobs (or same dept via JOIN) must not
    // duplicate search hits. Aggregate department name so GROUP BY stays on employee.
    let sql = `SELECT e.id, e.first_name, e.last_name, e.employee_code, e.pseudonym,
                      MAX(d.name) AS department_name,
                      COUNT(DISTINCT doc.id) AS document_count,
                      SUM(CASE WHEN doc.folder_type = 'personal_upload' THEN 1 ELSE 0 END) AS upload_count,
                      SUM(CASE WHEN doc.source_type IN ('warning','appraisal','hr_upload') THEN 1 ELSE 0 END) AS hr_issued_count
               FROM hrm_employees e
               LEFT JOIN employee_jobs j ON j.employee_id = e.id
               LEFT JOIN departments d ON d.id = j.department_id
               LEFT JOIN hrm_employee_documents doc
                 ON doc.employee_id = e.id AND doc.deleted_at IS NULL
               WHERE 1=1`;
    const params: (string | number)[] = [];

    if (q) {
      const tokens = q.split(/\s+/).map((t) => t.trim()).filter(Boolean);
      // Each token must match name / id / code / pseudo (supports "waqas rafique" and "94").
      for (const token of tokens) {
        const like = `%${token}%`;
        if (/^\d+$/.test(token)) {
          sql += ` AND (
            e.id = ?
            OR CAST(e.id AS CHAR) LIKE ?
            OR CONCAT_WS(' ', IFNULL(e.first_name,''), IFNULL(e.last_name,'')) LIKE ?
            OR IFNULL(e.first_name,'') LIKE ?
            OR IFNULL(e.last_name,'') LIKE ?
            OR IFNULL(e.employee_code,'') LIKE ?
            OR IFNULL(e.pseudonym,'') LIKE ?
          )`;
          params.push(Number(token), like, like, like, like, like, like);
        } else {
          sql += ` AND (
            CONCAT_WS(' ', IFNULL(e.first_name,''), IFNULL(e.last_name,'')) LIKE ?
            OR IFNULL(e.first_name,'') LIKE ?
            OR IFNULL(e.last_name,'') LIKE ?
            OR CAST(e.id AS CHAR) LIKE ?
            OR IFNULL(e.employee_code,'') LIKE ?
            OR IFNULL(e.pseudonym,'') LIKE ?
          )`;
          params.push(like, like, like, like, like, like);
        }
      }
    }
    if (departmentId) {
      sql += ` AND j.department_id = ?`;
      params.push(Number(departmentId));
    }

    sql += ` GROUP BY e.id, e.first_name, e.last_name, e.employee_code, e.pseudonym
             ORDER BY e.first_name, e.last_name
             LIMIT 500`;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
    // Extra safety: unique by employee id (Mongo/SQL adapter edge cases).
    const seen = new Set<number>();
    let employees = (rows as RowDataPacket[]).filter((e) => {
      const id = Number(e.id);
      if (!Number.isFinite(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const viewerId = viewerIdFrom(req);
    if (viewerId) {
      try {
        const { resolveViewerDataScope, rowInViewerScope } = await import(
          "@/lib/access-control/data-scope"
        );
        const scope = await resolveViewerDataScope(viewerId);
        if (scope.mode !== "all") {
          employees = employees.filter((e) =>
            rowInViewerScope(scope, {
              employeeId: e.id,
              departmentName: e.department_name,
            }),
          );
        }
      } catch {
        /* keep list if scope helper fails */
      }
    }

    return NextResponse.json({ success: true, employees });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
