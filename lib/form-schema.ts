export type FormFieldDef = {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  readonly?: boolean;
  autofill?: string;
  options?: string[];
  filled_by?: "employee" | "manager" | "hr";
};

export function parseFormFields(schema: unknown): FormFieldDef[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter((f): f is FormFieldDef => !!f && typeof f === "object");
}

/** HR sets when sending the form (e.g. appraisal cycle dates). */
export function isHrField(field: FormFieldDef): boolean {
  if (field.filled_by === "hr") return true;
  const key = (field.key || "").toLowerCase();
  const label = (field.label || "").toLowerCase();
  if (key === "review_period" || key === "appraisal_period") return true;
  if (label.includes("review period")) return true;
  return false;
}

/** Manager / TL fills this field — hidden from employee form. */
export function isManagerField(field: FormFieldDef): boolean {
  if (field.filled_by === "manager") return true;
  const key = (field.key || "").toLowerCase();
  const label = (field.label || "").toLowerCase();
  if (key === "overall_rating" || key.endsWith("_overall_rating")) return true;
  if (label.includes("overall rating")) return true;
  if (isRatingScaleSelect(field)) return true;
  return false;
}

function isRatingScaleSelect(field: FormFieldDef): boolean {
  if (field.type !== "select" || !Array.isArray(field.options) || field.options.length < 3) {
    return false;
  }
  const normalized = field.options.map((o) => String(o).toLowerCase().trim());
  const hasExcellent = normalized.some((o) => o.includes("excellent"));
  const hasGood = normalized.some((o) => o === "good" || o.startsWith("good "));
  const hasAverage = normalized.some((o) => o.includes("average"));
  const hasNeedsImprovement = normalized.some((o) => o.includes("needs improvement"));
  return hasExcellent && hasGood && (hasAverage || hasNeedsImprovement);
}

export function isHeadingField(field: FormFieldDef): boolean {
  return String(field.type || "").toLowerCase() === "heading";
}

export function isEmployeeField(field: FormFieldDef): boolean {
  return !isManagerField(field) && !isHrField(field);
}

export type FormAudience = "employee" | "manager" | "all";

export function fieldsForAudience(schema: unknown, audience: FormAudience): FormFieldDef[] {
  const fields = parseFormFields(schema);
  if (audience === "all") return fields;
  if (audience === "employee") return fields.filter(isEmployeeField);
  return fields.filter(isManagerField);
}

export function mergeFormDataForAudience(
  schema: unknown,
  audience: "employee" | "manager",
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const allowed = new Set(
    fieldsForAudience(schema, audience)
      .map((f) => f.key)
      .filter(Boolean) as string[]
  );
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (allowed.has(key)) merged[key] = value;
  }
  return merged;
}

export function validateRequiredFields(
  schema: unknown,
  formData: Record<string, unknown>,
  audience: FormAudience
): string | null {
  for (const field of fieldsForAudience(schema, audience)) {
    if (!field.required || !field.key) continue;
    if (isHeadingField(field)) continue;
    const val = formData[field.key];
    if (field.type === "checkbox") {
      if (!val) return `${field.label || field.key} is required`;
      continue;
    }
    if (!String(val ?? "").trim()) return `${field.label || field.key} is required`;
  }
  return null;
}
