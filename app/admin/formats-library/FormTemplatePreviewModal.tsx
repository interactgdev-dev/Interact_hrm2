"use client";

import React from "react";
import { createPortal } from "react-dom";
import { showAppToast } from "@/lib/app-toast";
import { formCategoryLabel } from "@/lib/form-display";
import { fieldsForAudience, isHrField, isManagerField, type FormFieldDef } from "@/lib/form-schema";
import { isCheckboxGroup } from "@/lib/form-field-options";
import { slugifyFieldKey, validateFormSchemaFields } from "@/lib/form-template-fields";
import { FormFieldOptionsEditor } from "@/app/components/FormFieldOptionsEditor";
import { ensureOptionRows, normalizeOptionList } from "@/lib/form-field-options";
import styles from "../employee-files/employee-files.module.css";

type TemplateDetail = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  scope: string;
  department_name?: string | null;
  form_schema: FormFieldDef[];
};

const SAMPLE: Record<string, string> = {
  employee_name: "Sample Employee",
  employee_id: "101",
  department: "Operations",
  job_title: "Team Member",
  review_period: "January 2026 – June 2026",
};

function fieldBadge(field: FormFieldDef): string | null {
  if (isHrField(field)) return "HR sets when sending";
  if (isManagerField(field)) return "Manager fills";
  if (field.readonly) return "Auto-fill";
  return null;
}

function PreviewField({ field }: { field: FormFieldDef }) {
  const key = field.key || "";
  const badge = fieldBadge(field);
  const sample =
    field.type === "checkbox"
      ? false
      : SAMPLE[key] || (field.type === "date" ? "2026-07-07" : "");

  if (field.type === "heading") {
    return (
      <div className={styles.previewFormField} style={{ marginTop: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
          {field.label || key}
        </h3>
        {Array.isArray(field.options) && field.options[0] ? (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
            {field.options[0]}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.previewFormField}>
      <div className={styles.previewFormLabelRow}>
        <label className={styles.label}>
          {field.label || key}
          {field.required ? " *" : ""}
        </label>
        {badge ? <span className={styles.previewFormBadge}>{badge}</span> : null}
      </div>
      {field.type === "textarea" ? (
        <textarea
          className={styles.textarea}
          readOnly
          value={String(sample)}
          placeholder="Employee will type here…"
        />
      ) : field.type === "select" ? (
        <select className={styles.select} disabled value="">
          <option value="">Select…</option>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "file" || field.type === "pdf" || field.type === "upload" ? (
        <div
          style={{
            padding: "12px 14px",
            border: "1px dashed #cbd5e1",
            borderRadius: 10,
            background: "#fafbfc",
            fontSize: 13,
            color: "#64748b",
          }}
        >
          PDF upload (employee attaches file · HR can open after submit)
          {Array.isArray(field.options) && field.options[0] ? (
            <div style={{ marginTop: 6, fontSize: 12 }}>{field.options[0]}</div>
          ) : null}
        </div>
      ) : field.type === "checkbox" ? (
        isCheckboxGroup(field) ? (
          <div className={styles.checkboxGroup}>
            {(field.options || []).map((o) => (
              <label key={o} className={styles.checkItem}>
                <input type="checkbox" disabled /> {o}
              </label>
            ))}
          </div>
        ) : (
          <label className={styles.checkItem}>
            <input type="checkbox" disabled /> I acknowledge
          </label>
        )
      ) : (
        <input
          className={styles.input}
          readOnly
          type={field.type === "date" ? "date" : "text"}
          value={String(sample)}
        />
      )}
    </div>
  );
}

function newEditableField(): FormFieldDef {
  return {
    key: `field_${Date.now()}`,
    label: "",
    type: "text",
    required: false,
    filled_by: "employee",
  };
}

export function FormTemplatePreviewModal({
  templateId,
  onClose,
  onSaved,
}: {
  templateId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [editMode, setEditMode] = React.useState(false);
  const [template, setTemplate] = React.useState<TemplateDetail | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const [editFields, setEditFields] = React.useState<FormFieldDef[]>([]);

  const loadTemplate = React.useCallback(async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/form-templates/${id}?ts=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success || !data.template) throw new Error(data.error || "Failed to load");
      const t = data.template as TemplateDetail;
      const schema = Array.isArray(t.form_schema) ? t.form_schema : [];
      setTemplate({ ...t, form_schema: schema });
      setEditTitle(t.title);
      setEditFields(schema.map((f) => ({ ...f })));
      setEditMode(false);
    } catch (e) {
      showAppToast({
        message: e instanceof Error ? e.message : "Could not load form",
        variant: "error",
      });
      onClose();
    } finally {
      setLoading(false);
    }
  }, [onClose]);

  React.useEffect(() => {
    if (templateId) void loadTemplate(templateId);
  }, [templateId, loadTemplate]);

  function updateField(index: number, patch: Partial<FormFieldDef>) {
    setEditFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const next = { ...f, ...patch };
        if (patch.label != null && !f.key?.startsWith("employee_")) {
          next.key = slugifyFieldKey(patch.label) || f.key;
        }
        return next;
      })
    );
  }

  function removeField(index: number) {
    setEditFields((prev) => prev.filter((_, i) => i !== index));
  }

  function insertFieldAfter(index: number) {
    setEditFields((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, newEditableField());
      return next;
    });
  }

  async function saveEdits() {
    if (!template) return;
    const title = editTitle.trim();
    if (!title) {
      showAppToast({ message: "Title is required.", variant: "error" });
      return;
    }
    const cleaned = editFields
      .map((f) => ({
        ...f,
        label: (f.label || "").trim(),
        key: f.key || slugifyFieldKey(f.label || "field"),
      }))
      .filter((f) => f.label);
    if (!cleaned.length) {
      showAppToast({ message: "Add at least one field.", variant: "error" });
      return;
    }
    const schemaError = validateFormSchemaFields(cleaned);
    if (schemaError) {
      showAppToast({ message: schemaError, variant: "error" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/form-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, form_schema: cleaned }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");
      showAppToast({ message: "Form template updated.", variant: "success" });
      await loadTemplate(template.id);
      onSaved();
      setEditMode(false);
    } catch (e) {
      showAppToast({
        message: e instanceof Error ? e.message : "Save failed",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!templateId || typeof document === "undefined") return null;

  const employeePreviewFields = template
    ? fieldsForAudience(template.form_schema, "employee")
    : [];

  return createPortal(
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${styles.modal} ${styles.modalWide} ${styles.previewModal}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {loading || !template ? (
          <div className={styles.empty}>Loading form…</div>
        ) : (
          <>
            <div className={styles.previewModalHeader}>
              <div>
                <h2 className={styles.modalTitle}>{template.title}</h2>
                <p className={styles.modalMeta}>
                  {formCategoryLabel(template.category)}
                  {template.department_name ? ` · ${template.department_name}` : ""}
                  {" · "}
                  {template.scope === "company" ? "Company-wide" : "Department"}
                </p>
              </div>
              <div className={styles.previewTabs}>
                <button
                  type="button"
                  className={`${styles.previewTab} ${!editMode ? styles.previewTabActive : ""}`}
                  onClick={() => setEditMode(false)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={`${styles.previewTab} ${editMode ? styles.previewTabActive : ""}`}
                  onClick={() => setEditMode(true)}
                >
                  Edit
                </button>
              </div>
            </div>

            {!editMode ? (
              <div className={styles.previewFormBody}>
                <p className={styles.previewHint}>
                  How employees will see fillable fields. HR / manager fields are marked.
                </p>
                {employeePreviewFields.length === 0 ? (
                  <p className={styles.empty}>No employee fields on this form.</p>
                ) : (
                  employeePreviewFields.map((field) => (
                    <PreviewField key={field.key || field.label} field={field} />
                  ))
                )}
              </div>
            ) : (
              <div className={styles.previewFormBody}>
                <div className={styles.field}>
                  <label className={styles.label}>Form title</label>
                  <input
                    className={styles.input}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>
                {editFields.map((field, index) => (
                  <div key={`${field.key}-${index}`} className={styles.customFieldCard}>
                    <p className={styles.customFieldCardTitle}>Field {index + 1}</p>
                    <div className={styles.customFieldGrid}>
                      <div className={`${styles.field} ${styles.customFieldGridFull}`} style={{ margin: 0 }}>
                        <label className={styles.label}>Label</label>
                        <input
                          className={styles.input}
                          value={field.label || ""}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                        />
                      </div>
                      <div className={styles.field} style={{ margin: 0 }}>
                        <label className={styles.label}>Type</label>
                        <select
                          className={styles.select}
                          value={field.type || "text"}
                          onChange={(e) => {
                            const type = e.target.value;
                            const patch: Partial<FormFieldDef> = { type };
                            if (type === "select") {
                              const filled = normalizeOptionList(field.options);
                              patch.options =
                                filled.length >= 2 ? ensureOptionRows(filled, 2) : ["", ""];
                            }
                            updateField(index, patch);
                          }}
                        >
                          <option value="text">Text</option>
                          <option value="textarea">Long text</option>
                          <option value="select">Dropdown</option>
                          <option value="date">Date</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="file">PDF upload</option>
                        </select>
                      </div>
                      <div className={styles.field} style={{ margin: 0 }}>
                        <label className={styles.label}>Filled by</label>
                        <select
                          className={styles.select}
                          value={field.filled_by || "employee"}
                          onChange={(e) =>
                            updateField(index, {
                              filled_by: e.target.value as FormFieldDef["filled_by"],
                            })
                          }
                          disabled={Boolean(field.readonly)}
                        >
                          <option value="employee">Employee</option>
                          <option value="hr">HR</option>
                          <option value="manager">Manager</option>
                        </select>
                      </div>
                      {field.type === "select" ? (
                        <div className={`${styles.field} ${styles.customFieldGridFull}`} style={{ margin: 0 }}>
                          <label className={styles.label}>Dropdown options</label>
                          <FormFieldOptionsEditor
                            options={field.options || []}
                            onChange={(options) => updateField(index, { options })}
                            minRows={2}
                            placeholder="e.g. Single, Married"
                            hint="At least 2 choices required."
                          />
                        </div>
                      ) : null}
                      {field.type === "checkbox" ? (
                        <div className={`${styles.field} ${styles.customFieldGridFull}`} style={{ margin: 0 }}>
                          <label className={styles.label}>Checkbox choices</label>
                          <FormFieldOptionsEditor
                            options={field.options || []}
                            onChange={(options) =>
                              updateField(index, {
                                options: normalizeOptionList(options).length ? options : undefined,
                              })
                            }
                            minRows={0}
                            placeholder="e.g. Health insurance"
                            hint="Leave empty for single acknowledge, or add multiple choices."
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.customFieldActions}>
                      <label className={styles.checkItem} style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          disabled={Boolean(field.readonly)}
                          onChange={(e) => updateField(index, { required: e.target.checked })}
                        />
                        Required
                      </label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className={styles.btn}
                          onClick={() => insertFieldAfter(index)}
                        >
                          + Add field
                        </button>
                        {!field.readonly ? (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnDanger}`}
                            onClick={() => removeField(index)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => setEditFields((prev) => [...prev, newEditableField()])}
                >
                  + Add custom field
                </button>
              </div>
            )}

            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={onClose}>
                Close
              </button>
              {editMode ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={saving}
                  onClick={() => void saveEdits()}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
