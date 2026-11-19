import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import {
  DOCUMENT_UPLOAD_MIMES,
  EMPLOYEE_FILES_DIR,
  MAX_DOCUMENT_BYTES,
} from "@/lib/document-constants";
import {
  logDocumentAudit,
  parseJsonField,
  resolveEmployeeNumericId,
  type EmployeeDocumentRow,
} from "@/lib/employee-documents";

async function loadTags(documentIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (!documentIds.length) return map;
  const placeholders = documentIds.map(() => "?").join(",");
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT m.document_id, t.name
     FROM hrm_document_tag_map m
     JOIN hrm_document_tags t ON t.id = m.tag_id
     WHERE m.document_id IN (${placeholders})`,
    documentIds
  );
  for (const row of rows) {
    const id = Number(row.document_id);
    const list = map.get(id) || [];
    list.push(String(row.name));
    map.set(id, list);
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeIdParam = searchParams.get("employeeId");
    const hrView = searchParams.get("hr") === "1";
    const folderType = searchParams.get("folderType");

    if (!employeeIdParam) {
      return NextResponse.json({ success: false, error: "employeeId required" }, { status: 400 });
    }

    let employeeId = Number(employeeIdParam);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      const resolved = await resolveEmployeeNumericId(String(employeeIdParam));
      if (!resolved) {
        return NextResponse.json({ success: false, error: "Invalid employeeId" }, { status: 400 });
      }
      employeeId = resolved;
    }

    const viewerId = (
      req.headers.get("x-hrm-employee-id") ||
      req.headers.get("x-employee-id") ||
      searchParams.get("viewerId") ||
      ""
    ).trim();
    if (hrView && viewerId) {
      try {
        const { resolveViewerDataScope, rowInViewerScope } = await import(
          "@/lib/access-control/data-scope"
        );
        const scope = await resolveViewerDataScope(viewerId);
        if (scope.mode !== "all") {
          const [deptRows] = await pool.execute<RowDataPacket[]>(
            `SELECT d.name AS department_name
             FROM hrm_employees e
             LEFT JOIN employee_jobs j ON e.id = j.employee_id
             LEFT JOIN departments d ON j.department_id = d.id
             WHERE e.id = ?
             LIMIT 1`,
            [employeeId],
          );
          const dept = deptRows[0]?.department_name ?? null;
          if (
            !rowInViewerScope(scope, {
              employeeId,
              departmentName: dept != null ? String(dept) : null,
            })
          ) {
            return NextResponse.json(
              { success: false, error: "Out of scope for this employee" },
              { status: 403 },
            );
          }
        }
      } catch {
        /* ignore scope helper failure */
      }
    }

    let sql = `SELECT * FROM hrm_employee_documents
               WHERE employee_id = ? AND deleted_at IS NULL`;
    const params: (string | number)[] = [employeeId];
    if (folderType) {
      sql += ` AND folder_type = ?`;
      params.push(folderType);
    }
    sql += ` ORDER BY created_at DESC`;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
    const docs = rows as EmployeeDocumentRow[];
    const tagMap = await loadTags(docs.map((d) => d.id));
    const documents = docs.map((d) => ({
      ...d,
      tags: tagMap.get(d.id) || [],
    }));

    if (hrView) {
      await logDocumentAudit({
        documentId: null,
        employeeId,
        action: "view",
        actorType: "hr",
        actorId: "admin",
        meta: { scope: "employee_folder" },
      });
    }

    return NextResponse.json({ success: true, documents });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load documents" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const employeeIdRaw = formData.get("employeeId");
    const actorLogin = String(formData.get("actorLogin") || "");
    const isHr = formData.get("isHr") === "1";
    const files = formData.getAll("files");

    if (!employeeIdRaw || !files.length) {
      return NextResponse.json({ success: false, error: "employeeId and files required" }, { status: 400 });
    }

    let employeeId = Number(employeeIdRaw);
    if (!Number.isFinite(employeeId)) {
      const resolved = await resolveEmployeeNumericId(String(employeeIdRaw));
      if (!resolved) {
        return NextResponse.json({ success: false, error: "Employee not found" }, { status: 404 });
      }
      employeeId = resolved;
    }

    const uploadRoot = path.join(process.cwd(), "public", "uploads", EMPLOYEE_FILES_DIR);
    await fs.mkdir(uploadRoot, { recursive: true });

    const saved: EmployeeDocumentRow[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;
      if (file.size > MAX_DOCUMENT_BYTES) {
        return NextResponse.json(
          { success: false, error: `${file.name} exceeds 100MB limit` },
          { status: 400 }
        );
      }
      const mime = (file.type || "application/octet-stream").toLowerCase();
      if (!DOCUMENT_UPLOAD_MIMES.has(mime)) {
        return NextResponse.json(
          { success: false, error: `File type not allowed: ${file.name}` },
          { status: 400 }
        );
      }

      const ext = path.extname(file.name) || "";
      const unique = `${uuidv4()}${ext}`;
      const relPath = `/uploads/${EMPLOYEE_FILES_DIR}/${unique}`;
      const absPath = path.join(uploadRoot, unique);
      const buf = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(absPath, buf);

      const sourceType = isHr ? "hr_upload" : "employee_upload";
      const folderType = isHr ? "hr_issued" : "personal_upload";

      const [result] = await pool.execute(
        `INSERT INTO hrm_employee_documents
          (employee_id, folder_type, source_type, file_name, file_path, mime_type, file_size,
           uploaded_by_employee_id, uploaded_by_hr, is_readonly)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          employeeId,
          folderType,
          sourceType,
          file.name,
          relPath,
          mime,
          file.size,
          isHr ? null : employeeId,
          isHr ? actorLogin || "hr" : null,
          isHr ? 1 : 0,
        ]
      );

      const insertId = (result as { insertId: number }).insertId;
      await logDocumentAudit({
        documentId: insertId,
        employeeId,
        action: "upload",
        actorType: isHr ? "hr" : "employee",
        actorId: actorLogin || String(employeeId),
      });

      saved.push({
        id: insertId,
        employee_id: employeeId,
        folder_type: folderType,
        source_type: sourceType,
        assignment_id: null,
        template_id: null,
        file_name: file.name,
        file_path: relPath,
        mime_type: mime,
        file_size: file.size,
        uploaded_by_employee_id: isHr ? null : employeeId,
        uploaded_by_hr: isHr ? actorLogin || "hr" : null,
        is_readonly: isHr ? 1 : 0,
        deleted_at: null,
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true, documents: saved });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
