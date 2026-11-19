import { NextResponse } from "next/server";
import {
  buildMedicalBalances,
  isMedicalClaimTemplate,
  isMedicalSubscriptionTemplate,
  loadMedicalAssignments,
  policyYearBounds,
} from "@/lib/medical-benefits";
import { isHeadingField, parseFormFields } from "@/lib/form-schema";
import { pool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import { parseJsonField } from "@/lib/employee-documents";

export const runtime = "nodejs";

function flattenRow(
  formData: Record<string, unknown> | null,
  schema: unknown
): Record<string, unknown> {
  const fields = parseFormFields(schema).filter((f) => f.key && !isHeadingField(f));
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const key = String(f.key);
    const val = formData?.[key];
    if (Array.isArray(val)) out[key] = val.join("; ");
    else if (typeof val === "boolean") out[key] = val ? "Yes" : "No";
    else out[key] = val ?? "";
  }
  // Keep any extra keys (budget flags etc.)
  if (formData) {
    for (const [k, v] of Object.entries(formData)) {
      if (k in out) continue;
      if (Array.isArray(v)) out[k] = v.join("; ");
      else out[k] = v as unknown;
    }
  }
  return out;
}

export async function GET() {
  try {
    const assignments = await loadMedicalAssignments();
    const balances = buildMedicalBalances(assignments);
    const policy = policyYearBounds();

    // Schema for column headers — fetch all templates then filter in JS
    // (Mongo adapter struggles with LOWER(COALESCE(...)) / complex OR WHERE).
    const [tplRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, title, category, form_schema, is_active FROM hrm_form_templates ORDER BY id DESC`
    );

    let subscriptionSchema: unknown = [];
    let claimSchema: unknown = [];
    let gotSub = false;
    let gotClaim = false;
    for (const t of tplRows as Array<Record<string, unknown>>) {
      if (Number(t.is_active) === 0) continue;
      const schema = parseJsonField(t.form_schema);
      if (!gotSub && isMedicalSubscriptionTemplate(t.title, t.category)) {
        subscriptionSchema = schema;
        gotSub = true;
      }
      if (!gotClaim && isMedicalClaimTemplate(t.title, t.category)) {
        claimSchema = schema;
        gotClaim = true;
      }
    }

    const subscriptions = assignments
      .filter((a) => isMedicalSubscriptionTemplate(a.template_title, a.template_category))
      .map((a) => ({
        assignmentId: a.id,
        employeeId: a.employee_id,
        employeeName: a.employee_name,
        submittedAt: a.submitted_at,
        status: a.status,
        budgetExceeded: Boolean(a.form_data?.budget_exceeded),
        ...flattenRow(a.form_data, subscriptionSchema),
      }));

    const claims = assignments
      .filter((a) => isMedicalClaimTemplate(a.template_title, a.template_category))
      .map((a) => ({
        assignmentId: a.id,
        employeeId: a.employee_id,
        employeeName: a.employee_name,
        submittedAt: a.submitted_at,
        status: a.status,
        budgetExceeded: Boolean(a.form_data?.budget_exceeded),
        budgetExceedTicket: a.form_data?.budget_exceed_ticket ?? null,
        ...flattenRow(a.form_data, claimSchema),
      }));

    const subscriptionColumns = parseFormFields(subscriptionSchema)
      .filter((f) => f.key && !isHeadingField(f))
      .map((f) => ({ key: String(f.key), label: f.label || f.key }));
    const claimColumns = parseFormFields(claimSchema)
      .filter((f) => f.key && !isHeadingField(f))
      .map((f) => ({ key: String(f.key), label: f.label || f.key }));

    return NextResponse.json({
      success: true,
      policyYear: policy,
      balances,
      subscriptions,
      claims,
      subscriptionColumns,
      claimColumns,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load medical tracker";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
