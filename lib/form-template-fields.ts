import type { FormFieldDef } from "@/lib/form-schema";
import { normalizeOptionList } from "@/lib/form-field-options";

export type FormFieldPreset = {
  id: string;
  label: string;
  description?: string;
  type: "text" | "textarea" | "select" | "date" | "checkbox" | "file";
  group: "auto" | "employee" | "hr" | "manager";
  defaultKey: string;
  autofill?: string;
  readonly?: boolean;
  filled_by?: "employee" | "manager" | "hr";
  required?: boolean;
  options?: string[];
};

export const FORM_FIELD_PRESETS: FormFieldPreset[] = [
  {
    id: "employee_name",
    label: "Employee Name",
    type: "text",
    group: "auto",
    defaultKey: "employee_name",
    autofill: "employee.full_name",
    readonly: true,
  },
  {
    id: "employee_id",
    label: "Employee ID",
    type: "text",
    group: "auto",
    defaultKey: "employee_id",
    autofill: "employee.id",
    readonly: true,
  },
  {
    id: "department",
    label: "Department",
    type: "text",
    group: "auto",
    defaultKey: "department",
    autofill: "employee.department",
    readonly: true,
  },
  {
    id: "job_title",
    label: "Job Title",
    type: "text",
    group: "auto",
    defaultKey: "job_title",
    autofill: "employee.job_title",
    readonly: true,
  },
  {
    id: "review_period",
    label: "Review Period",
    description: "HR sets when sending the form",
    type: "text",
    group: "hr",
    defaultKey: "review_period",
    filled_by: "hr",
  },
  {
    id: "warning_reason",
    label: "Warning Reason",
    type: "textarea",
    group: "employee",
    defaultKey: "warning_reason",
    required: true,
  },
  {
    id: "strengths",
    label: "Strengths",
    type: "textarea",
    group: "employee",
    defaultKey: "strengths",
    required: true,
  },
  {
    id: "areas_for_improvement",
    label: "Areas for Improvement",
    type: "textarea",
    group: "employee",
    defaultKey: "areas_for_improvement",
    required: true,
  },
  {
    id: "employee_comments",
    label: "Employee Comments",
    type: "textarea",
    group: "employee",
    defaultKey: "employee_comments",
  },
  {
    id: "overall_rating",
    label: "Overall Rating",
    description: "Filled by manager after employee submits",
    type: "select",
    group: "manager",
    defaultKey: "overall_rating",
    filled_by: "manager",
    options: ["Excellent", "Good", "Average", "Needs Improvement"],
  },
  {
    id: "manager_comments",
    label: "Manager Comments",
    type: "textarea",
    group: "manager",
    defaultKey: "manager_comments",
    filled_by: "manager",
  },
  {
    id: "notes",
    label: "Notes",
    type: "textarea",
    group: "employee",
    defaultKey: "notes",
  },
  {
    id: "acknowledge",
    label: "I acknowledge and agree",
    type: "checkbox",
    group: "employee",
    defaultKey: "acknowledge",
    required: true,
  },
  {
    id: "date_signed",
    label: "Date Signed",
    type: "date",
    group: "employee",
    defaultKey: "date_signed",
    autofill: "today",
  },
];

export type CustomFieldDraft = {
  id: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "checkbox" | "file";
  required: boolean;
  filled_by: "employee" | "manager" | "hr";
  /** Dropdown / checkbox-group choices */
  optionList: string[];
};

export const PRESET_GROUP_LABELS: Record<FormFieldPreset["group"], string> = {
  auto: "Auto-fill (employee info)",
  employee: "Employee fills",
  hr: "HR sets when sending",
  manager: "Manager fills after submit",
};

export function slugifyFieldKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48);
  return base || `field_${Date.now()}`;
}

export function presetToField(preset: FormFieldPreset): FormFieldDef {
  return {
    key: preset.defaultKey,
    label: preset.label,
    type: preset.type,
    autofill: preset.autofill,
    readonly: preset.readonly,
    filled_by: preset.filled_by,
    required: preset.required,
    options: preset.options,
  };
}

export function buildFormSchemaFromSelection(
  selectedPresetIds: string[],
  customFields: CustomFieldDraft[]
): FormFieldDef[] {
  const schema: FormFieldDef[] = [];
  const usedKeys = new Set<string>();

  for (const preset of FORM_FIELD_PRESETS) {
    if (!selectedPresetIds.includes(preset.id)) continue;
    const field = presetToField(preset);
    if (field.key) usedKeys.add(field.key);
    schema.push(field);
  }

  for (const custom of customFields) {
    const label = custom.label.trim();
    if (!label) continue;
    let key = slugifyFieldKey(label);
    while (usedKeys.has(key)) key = `${key}_${usedKeys.size}`;
    usedKeys.add(key);
    const opts = normalizeOptionList(custom.optionList);
    schema.push({
      key,
      label,
      type: custom.type,
      required: custom.required,
      filled_by: custom.filled_by,
      options:
        custom.type === "select"
          ? opts
          : custom.type === "checkbox" && opts.length > 0
            ? opts
            : undefined,
    });
  }

  return schema;
}

export function validateCustomFieldDrafts(customFields: CustomFieldDraft[]): string | null {
  for (const custom of customFields) {
    const label = custom.label.trim();
    if (!label) continue;
    const opts = normalizeOptionList(custom.optionList);
    if (custom.type === "select" && opts.length < 2) {
      return `"${label}" dropdown needs at least 2 options.`;
    }
    if (
      custom.type === "checkbox" &&
      custom.optionList.some((o) => o.trim()) &&
      opts.length < 1
    ) {
      return `"${label}" needs at least one checkbox option.`;
    }
  }
  return null;
}

export function validateFormSchemaFields(fields: FormFieldDef[]): string | null {
  for (const f of fields) {
    const label = (f.label || f.key || "Field").trim();
    const opts = normalizeOptionList(f.options);
    if (f.type === "select" && opts.length < 2) {
      return `"${label}" dropdown needs at least 2 options.`;
    }
    if (f.type === "checkbox" && opts.length > 0 && opts.length < 1) {
      return `"${label}" needs at least one checkbox option.`;
    }
  }
  return null;
}

export function defaultPresetsForCategory(category: string): string[] {
  const base = ["employee_name", "employee_id", "department"];
  const c = category.toLowerCase();
  if (c === "warning") return [...base, "warning_reason", "acknowledge", "date_signed"];
  if (c === "appraisal") {
    return [
      ...base,
      "review_period",
      "strengths",
      "areas_for_improvement",
      "overall_rating",
      "manager_comments",
    ];
  }
  return [...base, "notes"];
}
