import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import { regenerateSubmittedFormDocument } from "@/lib/form-submission";
import {
  mergeFormDataForAudience,
  validateRequiredFields,
} from "@/lib/form-schema";
import {
  logDocumentAudit,
  parseJsonField,
} from "@/lib/employee-documents";
import {
  buildMedicalBalances,
  createMedicalBudgetExceedTicket,
  evaluateClaimAgainstBalance,
  isMedicalClaimTemplate,
  loadMedicalAssignments,
} from "@/lib/medical-benefits";

type Ctx = { params: Promise<{ id: string }> };

async function loadAssignment(id: number): Promise<Record<string, unknown> | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM hrm_form_assignments WHERE id = ? LIMIT 1`,
    [id]
  );
  const a = rows[0] as Record<string, unknown> | undefined;
  if (!a) return null;

  let template_title: string | null = null;
  let template_category: string | null = null;
  let form_schema: unknown = null;
  let employee_name = `Employee ${a.employee_id}`;

  try {
    const [tRows] = await pool.execute<RowDataPacket[]>(
      `SELECT title, category, form_schema FROM hrm_form_templates WHERE id = ? LIMIT 1`,
      [a.template_id]
    );
    if (tRows[0]) {
      template_title = tRows[0].title != null ? String(tRows[0].title) : null;
      template_category = tRows[0].category != null ? String(tRows[0].category) : null;
      form_schema = tRows[0].form_schema;
    }
  } catch {
    /* keep nulls */
  }

  try {
    const [eRows] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name FROM hrm_employees WHERE id = ? LIMIT 1`,
      [a.employee_id]
    );
    if (eRows[0]) {
      employee_name =
        `${eRows[0].first_name || ""} ${eRows[0].last_name || ""}`.trim() || employee_name;
    }
  } catch {
    /* keep fallback name */
  }

  return {
    ...a,
    template_title,
    template_category,
    form_schema,
    employee_name,
  };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const row = await loadAssignment(Number(id));
    if (!row) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      assignment: {
        ...row,
        form_data: parseJsonField(row.form_data),
        form_schema: parseJsonField(row.form_schema),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const assignmentId = Number(id);
    const body = await req.json();
    const row = await loadAssignment(assignmentId);
    if (!row) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const action = body.action ? String(body.action) : "save";

    if (action === "cancel") {
      await pool.execute(
        `UPDATE hrm_form_assignments SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
        [assignmentId]
      );
      await logDocumentAudit({
        assignmentId,
        employeeId: Number(row.employee_id),
        action: "cancel_form",
        actorType: "hr",
        actorId: body.actorLogin || "hr",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "archive") {
      await pool.execute(
        `UPDATE hrm_form_assignments SET status = 'archived', reviewed_at = NOW(), reviewed_by = ? WHERE id = ?`,
        [body.actorLogin || "hr", assignmentId]
      );
      return NextResponse.json({ success: true });
    }

    const formData = body.form_data as Record<string, unknown> | undefined;
    const schema = parseJsonField(row.form_schema);
    const existingData = parseJsonField<Record<string, unknown>>(row.form_data) || {};

    if (action === "manager_review") {
      if (row.status !== "submitted" && row.status !== "archived") {
        return NextResponse.json(
          { success: false, error: "Employee must submit the form first." },
          { status: 400 }
        );
      }
      if (!formData || typeof formData !== "object") {
        return NextResponse.json({ success: false, error: "form_data required" }, { status: 400 });
      }
      const merged = mergeFormDataForAudience(schema, "manager", existingData, formData);
      const validationError = validateRequiredFields(schema, merged, "manager");
      if (validationError) {
        return NextResponse.json({ success: false, error: validationError }, { status: 400 });
      }

      const docId = await regenerateSubmittedFormDocument({
        assignmentId,
        employeeId: Number(row.employee_id),
        templateTitle: String(row.template_title),
        templateCategory: String(row.template_category),
        employeeName: String(row.employee_name),
        formData: merged,
        schema,
        submittedAt: row.submitted_at ? String(row.submitted_at) : null,
        hrMessage: row.assigned_note ? String(row.assigned_note) : null,
        resultDocumentId: row.result_document_id ? Number(row.result_document_id) : null,
      });

      await pool.execute(
        `UPDATE hrm_form_assignments
         SET form_data = ?, result_document_id = COALESCE(?, result_document_id), updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(merged), docId, assignmentId]
      );

      await logDocumentAudit({
        assignmentId,
        employeeId: Number(row.employee_id),
        action: "manager_review",
        actorType: "hr",
        actorId: body.actorLogin ? String(body.actorLogin) : "hr",
      });

      return NextResponse.json({ success: true, documentId: docId });
    }

    if (!formData || typeof formData !== "object") {
      return NextResponse.json({ success: false, error: "form_data required" }, { status: 400 });
    }

    const mergedEmployee = mergeFormDataForAudience(schema, "employee", existingData, formData);

    if (action === "submit") {
      const validationError = validateRequiredFields(schema, mergedEmployee, "employee");
      if (validationError) {
        return NextResponse.json({ success: false, error: validationError }, { status: 400 });
      }

      let budgetTicket: { ticketId: number; ticketNumber: string } | null = null;
      const submitData: Record<string, unknown> = { ...mergedEmployee };

      if (isMedicalClaimTemplate(row.template_title, row.template_category)) {
        try {
          const existing = await loadMedicalAssignments();
          const balances = buildMedicalBalances(existing);
          const check = evaluateClaimAgainstBalance(
            balances,
            Number(row.employee_id),
            submitData
          );
          if (check.exceeded) {
            submitData.budget_exceeded = true;
            submitData.budget_exceed_message = check.message;
            submitData.budget_remaining_before = check.remainingBefore;
            submitData.budget_limit = check.limit;
            budgetTicket = await createMedicalBudgetExceedTicket({
              employeeId: Number(row.employee_id),
              employeeName: String(row.employee_name || ""),
              check,
              assignmentId,
            });
            if (budgetTicket) {
              submitData.budget_exceed_ticket = budgetTicket.ticketNumber;
            }
          }
        } catch {
          // Budget check must not block form submit
        }
      }

      // Persist submission first so the form is never lost if file write fails.
      await pool.execute(
        `UPDATE hrm_form_assignments
         SET status = 'submitted', form_data = ?, submitted_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(submitData), assignmentId]
      );

      let docId: number | null = null;
      try {
        docId = await regenerateSubmittedFormDocument({
          assignmentId,
          employeeId: Number(row.employee_id),
          templateTitle: String(row.template_title || "Form"),
          templateCategory: String(row.template_category || ""),
          employeeName: String(row.employee_name || ""),
          formData: submitData,
          schema,
          submittedAt: new Date().toISOString(),
          hrMessage: row.assigned_note ? String(row.assigned_note) : null,
          resultDocumentId: row.result_document_id != null ? Number(row.result_document_id) : null,
        });
        if (docId) {
          await pool.execute(
            `UPDATE hrm_form_assignments
             SET result_document_id = ?, updated_at = NOW()
             WHERE id = ?`,
            [docId, assignmentId]
          );
        }
      } catch {
        // Submission already saved; employee can still open via print/preview.
        docId = null;
      }

      await logDocumentAudit({
        documentId: docId,
        assignmentId,
        employeeId: Number(row.employee_id),
        action: "submit_form",
        actorType: "employee",
        actorId: String(row.employee_id),
      });

      return NextResponse.json({
        success: true,
        documentId: docId,
        budgetExceeded: Boolean(submitData.budget_exceeded),
        budgetTicket: budgetTicket?.ticketNumber ?? null,
      });
    }

    const status =
      action === "start" ? "in_progress" : action === "draft" ? "draft" : row.status;
    await pool.execute(
      `UPDATE hrm_form_assignments SET form_data = ?, status = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(mergedEmployee), status, assignmentId]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
