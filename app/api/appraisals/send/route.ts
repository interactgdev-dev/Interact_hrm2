import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import {
  applyAutofillToSchema,
  getEmployeeProfileForAutofill,
  logDocumentAudit,
  parseJsonField,
} from "@/lib/employee-documents";
import {
  cycleLabel,
  getBlankAppraisalTemplateId,
  getPendingAppraisals,
  normalizeCycleKey,
} from "@/lib/appraisal-due";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const employeeId = Number(body.employee_id);
    const cycleRaw = String(body.cycle || "").trim();
    const cycle =
      normalizeCycleKey(cycleRaw) ||
      (Number.isFinite(Number(cycleRaw)) && Number(cycleRaw) >= 1 ? String(Number(cycleRaw)) : "");
    const assignedBy = body.assigned_by ? String(body.assigned_by) : "hr";

    if (!employeeId || !cycle) {
      return NextResponse.json(
        { success: false, error: "employee_id and cycle (1, 2, 3, …) required" },
        { status: 400 }
      );
    }

    const pending = await getPendingAppraisals();
    const match = pending.find((p) => p.employee_id === employeeId && p.cycle === cycle);
    if (!match) {
      return NextResponse.json(
        { success: false, error: "This appraisal is not due, or already completed." },
        { status: 400 }
      );
    }
    if (match.has_open_assignment) {
      return NextResponse.json(
        { success: false, error: "Appraisal form already sent (HR Issued). Check employee My Files." },
        { status: 400 }
      );
    }

    const templateId = Number(body.template_id) || (await getBlankAppraisalTemplateId());
    if (!templateId) {
      return NextResponse.json(
        { success: false, error: "No active appraisal template found. Create one in Form Templates." },
        { status: 400 }
      );
    }

    const [tRows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM hrm_form_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
      [templateId]
    );
    const template = tRows[0];
    if (!template || String(template.category).toLowerCase() !== "appraisal") {
      return NextResponse.json({ success: false, error: "Appraisal template not found" }, { status: 404 });
    }

    const reviewPeriod = cycleLabel(cycle, match.due_after_months);
    const schema = parseJsonField(template.form_schema);
    const profile = await getEmployeeProfileForAutofill(employeeId);
    const formData: Record<string, unknown> = profile
      ? applyAutofillToSchema(schema, profile)
      : {};
    formData.review_period = reviewPeriod;
    formData.appraisal_cycle = cycle;
    formData.appraisal_due_date = match.due_date;
    formData.joined_date = match.joined_date;

    const note = `HR Issued — ${reviewPeriod}`;

    const [result] = await pool.execute(
      `INSERT INTO hrm_form_assignments
        (template_id, employee_id, assigned_by, assigned_note, status, form_data)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [templateId, employeeId, assignedBy, note, JSON.stringify(formData)]
    );
    const assignmentId = (result as { insertId: number }).insertId;

    await logDocumentAudit({
      assignmentId,
      employeeId,
      action: "assign_form",
      actorType: "hr",
      actorId: assignedBy,
      meta: { category: "appraisal", cycle, reviewPeriod },
    });

    return NextResponse.json({
      success: true,
      assignment_id: assignmentId,
      message: "Appraisal form sent. Employee will see it in My Files (HR Issued).",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to send appraisal form" },
      { status: 500 }
    );
  }
}
