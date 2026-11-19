import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import {
  applyAutofillToSchema,
  getEmployeeProfileForAutofill,
  logDocumentAudit,
  parseJsonField,
  resolveEmployeeNumericId,
  type FormAssignmentRow,
} from "@/lib/employee-documents";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeIdRaw = (searchParams.get("employeeId") || "").trim();
    const status = searchParams.get("status");
    const hrView = searchParams.get("hr") === "1";
    const viewerId = (
      req.headers.get("x-hrm-employee-id") ||
      req.headers.get("x-employee-id") ||
      searchParams.get("viewerId") ||
      ""
    ).trim();

    // Avoid multi-JOIN SQL here — Mongo SQL adapter historically dropped INNER JOIN rows
    // when ON sides were aliased (t.id = a.template_id). Enrich in JS instead.
    let sql = `SELECT * FROM hrm_form_assignments WHERE 1=1`;
    const params: (string | number)[] = [];
    let employeeId: number | null = null;

    if (employeeIdRaw) {
      employeeId = Number(employeeIdRaw);
      if (!Number.isFinite(employeeId) || employeeId <= 0) {
        const resolved = await resolveEmployeeNumericId(employeeIdRaw);
        if (!resolved) {
          return NextResponse.json({ success: true, assignments: [] });
        }
        employeeId = resolved;
      }
      sql += ` AND employee_id = ?`;
      params.push(employeeId);
    }
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    } else if (!hrView && employeeIdRaw) {
      sql += ` AND status IN ('pending','in_progress','draft','submitted')`;
    } else if (hrView) {
      sql += ` AND status IN ('submitted','archived')`;
    }
    sql += ` ORDER BY updated_at DESC`;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
    const rawAssignments = rows as FormAssignmentRow[];

    const templateIds = Array.from(
      new Set(rawAssignments.map((a) => Number(a.template_id)).filter((n) => Number.isFinite(n) && n > 0))
    );
    const employeeIds = Array.from(
      new Set(rawAssignments.map((a) => Number(a.employee_id)).filter((n) => Number.isFinite(n) && n > 0))
    );

    const templateMap = new Map<number, RowDataPacket>();
    if (templateIds.length) {
      const placeholders = templateIds.map(() => "?").join(",");
      const [tRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, title, category, form_schema FROM hrm_form_templates WHERE id IN (${placeholders})`,
        templateIds
      );
      for (const t of tRows) templateMap.set(Number(t.id), t);
    }

    const employeeMap = new Map<number, { name: string; department_name: string | null }>();
    if (employeeIds.length) {
      const placeholders = employeeIds.map(() => "?").join(",");
      const [eRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, first_name, last_name FROM hrm_employees WHERE id IN (${placeholders})`,
        employeeIds
      );
      for (const e of eRows) {
        const id = Number(e.id);
        if (!employeeMap.has(id)) {
          employeeMap.set(id, {
            name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || `Employee ${id}`,
            department_name: null,
          });
        }
      }
      // Optional department (best-effort; join adapter bugs must not hide forms)
      try {
        const [jRows] = await pool.execute<RowDataPacket[]>(
          `SELECT employee_id, department_id FROM employee_jobs WHERE employee_id IN (${placeholders})`,
          employeeIds
        );
        const deptIds = Array.from(
          new Set(jRows.map((j) => Number(j.department_id)).filter((n) => Number.isFinite(n) && n > 0))
        );
        const deptMap = new Map<number, string>();
        if (deptIds.length) {
          const dph = deptIds.map(() => "?").join(",");
          const [dRows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, name FROM departments WHERE id IN (${dph})`,
            deptIds
          );
          for (const d of dRows) deptMap.set(Number(d.id), String(d.name || ""));
        }
        for (const j of jRows) {
          const eid = Number(j.employee_id);
          const emp = employeeMap.get(eid);
          if (!emp || emp.department_name) continue;
          const name = deptMap.get(Number(j.department_id));
          if (name) emp.department_name = name;
        }
      } catch {
        /* department enrichment is optional */
      }
    }

    let assignments = rawAssignments.map((a) => {
      const tid = Number(a.template_id);
      const eid = Number(a.employee_id);
      const t = templateMap.get(tid);
      const emp = employeeMap.get(eid);
      return {
        ...a,
        template_title: t?.title != null ? String(t.title) : null,
        template_category: t?.category != null ? String(t.category) : null,
        form_schema: parseJsonField(t?.form_schema ?? null),
        form_data: parseJsonField<Record<string, unknown>>(a.form_data),
        employee_name: emp?.name || `Employee ${eid}`,
        department_name: emp?.department_name ?? null,
      };
    });

    // Status filter in JS too (Mongo IN lists can be flaky)
    if (!status && !hrView && employeeIdRaw) {
      const allow = new Set(["pending", "in_progress", "draft", "submitted"]);
      assignments = assignments.filter((a) => allow.has(String(a.status || "").toLowerCase()));
    } else if (!status && hrView) {
      const allow = new Set(["submitted", "archived"]);
      assignments = assignments.filter((a) => allow.has(String(a.status || "").toLowerCase()));
    }

    if (hrView && viewerId) {
      try {
        const { resolveViewerDataScope, rowInViewerScope } = await import(
          "@/lib/access-control/data-scope"
        );
        const scope = await resolveViewerDataScope(viewerId);
        if (scope.mode !== "all") {
          assignments = assignments.filter((a) =>
            rowInViewerScope(scope, {
              employeeId: a.employee_id,
              departmentName: a.department_name ?? null,
            }),
          );
        }
      } catch {
        /* keep if scope helper fails */
      }
    }

    return NextResponse.json({ success: true, assignments });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load assignments" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const templateId = Number(body.template_id);
    const employeeId = Number(body.employee_id);
    const assignedBy = body.assigned_by ? String(body.assigned_by) : "hr";
    const note = body.assigned_note != null ? String(body.assigned_note).trim() : "";

    if (!templateId || !employeeId) {
      return NextResponse.json(
        { success: false, error: "template_id and employee_id required" },
        { status: 400 }
      );
    }

    const [tRows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM hrm_form_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
      [templateId]
    );
    const template = tRows[0];
    if (!template) {
      return NextResponse.json({ success: false, error: "Template not found" }, { status: 404 });
    }

    if (String(template.category).toLowerCase() === "warning" && !note) {
      return NextResponse.json(
        { success: false, error: "Please enter warning details for the employee." },
        { status: 400 }
      );
    }

    const reviewPeriod =
      body.review_period != null ? String(body.review_period).trim() : "";
    if (String(template.category).toLowerCase() === "appraisal" && !reviewPeriod) {
      return NextResponse.json(
        { success: false, error: "Review period is required for appraisal forms." },
        { status: 400 }
      );
    }

    const schema = parseJsonField(template.form_schema);
    const profile = await getEmployeeProfileForAutofill(employeeId);
    const formData = profile ? applyAutofillToSchema(schema, profile) : {};
    if (reviewPeriod) {
      formData.review_period = reviewPeriod;
    }

    const [result] = await pool.execute(
      `INSERT INTO hrm_form_assignments
        (template_id, employee_id, assigned_by, assigned_note, status, form_data)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [templateId, employeeId, assignedBy, note || null, JSON.stringify(formData)]
    );
    const assignmentId = (result as { insertId: number }).insertId;

    await logDocumentAudit({
      assignmentId,
      employeeId,
      action: "assign_form",
      actorType: "hr",
      actorId: assignedBy,
      meta: { template_id: templateId },
    });

    return NextResponse.json({
      success: true,
      id: assignmentId,
      template_title: template.title,
      template_category: template.category,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Assign failed" },
      { status: 500 }
    );
  }
}
