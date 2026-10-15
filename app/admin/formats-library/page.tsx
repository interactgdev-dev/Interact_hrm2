"use client";

import React from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../employee-files/employee-files.module.css";
import { showAppToast } from "@/lib/app-toast";
import { showAppConfirm } from "@/lib/app-confirm";
import {
  defaultHrMessageForCategory,
  defaultReviewPeriod,
  formCategoryLabel,
  hrMessageFieldLabel,
  hrMessagePlaceholder,
  isHrMessageRequired,
  isReviewPeriodRequired,
  reviewPeriodPlaceholder,
} from "@/lib/form-display";
import {
  buildFormSchemaFromSelection,
  defaultPresetsForCategory,
  FORM_FIELD_PRESETS,
  PRESET_GROUP_LABELS,
  validateCustomFieldDrafts,
  type CustomFieldDraft,
} from "@/lib/form-template-fields";
import { ensureOptionRows, normalizeOptionList } from "@/lib/form-field-options";
import { FormFieldOptionsEditor } from "@/app/components/FormFieldOptionsEditor";
import { FormTemplatePreviewModal } from "./FormTemplatePreviewModal";

type Template = {
  id: number;
  title: string;
  description: string | null;
  scope: string;
  department_name?: string | null;
  category: string;
  is_active: number;
};

type Emp = {
  id: number;
  first_name: string;
  last_name: string;
};

const PRESET_GROUPS = ["auto", "employee", "hr", "manager"] as const;

function newCustomField(): CustomFieldDraft {
  return {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: "",
    type: "text",
    required: false,
    filled_by: "employee",
    optionList: [],
  };
}

export default function FormatsLibraryPage() {
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [departments, setDepartments] = React.useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sendModal, setSendModal] = React.useState<Template | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [empQ, setEmpQ] = React.useState("");
  const [empResults, setEmpResults] = React.useState<Emp[]>([]);
  const [selectedEmp, setSelectedEmp] = React.useState<Emp | null>(null);
  const [note, setNote] = React.useState("");
  const [reviewPeriod, setReviewPeriod] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const [newTitle, setNewTitle] = React.useState("");
  const [newScope, setNewScope] = React.useState<"company" | "department">("company");
  const [newDeptId, setNewDeptId] = React.useState("");
  const [newCategory, setNewCategory] = React.useState("general");
  const [selectedPresets, setSelectedPresets] = React.useState<string[]>(
    defaultPresetsForCategory("general")
  );
  const [customFields, setCustomFields] = React.useState<CustomFieldDraft[]>([]);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [previewTemplateId, setPreviewTemplateId] = React.useState<number | null>(null);

  const loginId = typeof window !== "undefined" ? localStorage.getItem("loginId") || "hr" : "hr";

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, dRes] = await Promise.all([
        fetch("/api/form-templates?active=1", { cache: "no-store" }),
        fetch("/api/departments", { cache: "no-store" }),
      ]);
      const tData = await tRes.json();
      const dData = await dRes.json();
      if (tData.success) setTemplates(tData.templates || []);
      if (dData.success) setDepartments(dData.departments || []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!sendModal || empQ.length < 2) {
      setEmpResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      void fetch(`/api/admin/employee-files?q=${encodeURIComponent(empQ)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success) setEmpResults(d.employees || []);
        });
    }, 300);
    return () => window.clearTimeout(t);
  }, [empQ, sendModal]);

  function openSendModal(t: Template) {
    setSendModal(t);
    setSelectedEmp(null);
    setEmpQ("");
    setNote(defaultHrMessageForCategory(t.category));
    setReviewPeriod(t.category.toLowerCase() === "appraisal" ? defaultReviewPeriod() : "");
  }

  function closeSendModal() {
    setSendModal(null);
    setSelectedEmp(null);
    setEmpQ("");
    setNote("");
    setReviewPeriod("");
  }

  async function sendForm() {
    if (!sendModal || !selectedEmp) return;
    const trimmedNote = note.trim();
    const trimmedReviewPeriod = reviewPeriod.trim();
    if (isHrMessageRequired(sendModal.category) && !trimmedNote) {
      showAppToast({
        message: "Please enter warning details — the employee must know what this warning is about.",
        variant: "error",
      });
      return;
    }
    if (isReviewPeriodRequired(sendModal.category) && !trimmedReviewPeriod) {
      showAppToast({
        message: "Please enter the review period for this appraisal (e.g. January 2026 – June 2026).",
        variant: "error",
      });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/form-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: sendModal.id,
          employee_id: selectedEmp.id,
          assigned_by: loginId,
          assigned_note: trimmedNote || null,
          review_period: trimmedReviewPeriod || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      const sentTitle = sendModal.title;
      const sentName = `${selectedEmp.first_name} ${selectedEmp.last_name}`;
      closeSendModal();
      showAppToast({
        title: "Form sent",
        message: `${sentTitle} sent to ${sentName}.`,
        variant: "success",
      });
    } catch (e) {
      showAppToast({
        message: e instanceof Error ? e.message : "Send failed",
        variant: "error",
      });
    } finally {
      setSending(false);
    }
  }

  function openCreateModal() {
    setCreateOpen(true);
    setNewTitle("");
    setNewScope("company");
    setNewDeptId("");
    setNewCategory("general");
    setSelectedPresets(defaultPresetsForCategory("general"));
    setCustomFields([]);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCustomFields([]);
  }

  function togglePreset(presetId: string) {
    setSelectedPresets((prev) =>
      prev.includes(presetId) ? prev.filter((id) => id !== presetId) : [...prev, presetId]
    );
  }

  function appendCustomField() {
    setCustomFields((prev) => [...prev, newCustomField()]);
  }

  function insertCustomFieldAfter(index: number) {
    setCustomFields((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, newCustomField());
      return next;
    });
  }

  function updateCustomField(id: string, patch: Partial<CustomFieldDraft>) {
    setCustomFields((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeCustomField(id: string) {
    setCustomFields((prev) => prev.filter((x) => x.id !== id));
  }

  function onCategoryChange(category: string) {
    setNewCategory(category);
    setSelectedPresets(defaultPresetsForCategory(category));
  }

  async function createTemplate() {
    if (!newTitle.trim()) {
      showAppToast({ message: "Please enter a form title.", variant: "error" });
      return;
    }
    if (newScope === "department" && !newDeptId) {
      showAppToast({ message: "Please select a department.", variant: "error" });
      return;
    }
    const optionError = validateCustomFieldDrafts(customFields);
    if (optionError) {
      showAppToast({ message: optionError, variant: "error" });
      return;
    }
    const formSchema = buildFormSchemaFromSelection(selectedPresets, customFields);
    if (formSchema.length === 0) {
      showAppToast({
        message: "Select at least one field or add a custom field.",
        variant: "error",
      });
      return;
    }
    const res = await fetch("/api/form-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim(),
        scope: newScope,
        department_id: newScope === "department" ? Number(newDeptId) : null,
        category: newCategory,
        form_schema: formSchema,
        created_by: loginId,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      showAppToast({ message: data.error || "Create failed", variant: "error" });
      return;
    }
    closeCreateModal();
    showAppToast({ message: "Template created.", variant: "success" });
    await load();
  }

  async function deleteTemplate(t: Template) {
    const ok = await showAppConfirm({
      title: "Delete form?",
      message: `Delete "${t.title}"? This removes the template from the library. Existing submitted forms are kept.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/form-templates/${t.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Delete failed");
      showAppToast({ message: `"${t.title}" deleted.`, variant: "success" });
      await load();
    } catch (e) {
      showAppToast({
        message: e instanceof Error ? e.message : "Delete failed",
        variant: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  function renderTemplateActions(t: Template) {
    return (
      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => setPreviewTemplateId(t.id)}
        >
          Preview
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => openSendModal(t)}
        >
          Send to employee
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          disabled={deletingId === t.id}
          onClick={() => void deleteTemplate(t)}
        >
          {deletingId === t.id ? "Deleting…" : "Delete"}
        </button>
      </div>
    );
  }

  const companyTemplates = templates.filter((t) => t.scope === "company");
  const deptTemplates = templates.filter((t) => t.scope === "department");

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <header className={styles.header}>
            <h1 className={styles.title}>Formats Library</h1>
            <p className={styles.subtitle}>
              Company-wide forms (warning, appraisal) and department-specific templates. Send forms to employees for online fill.
            </p>
          </header>

          <div className={styles.toolbar}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={openCreateModal}
            >
              + New template
            </button>
          </div>

          {loading ? (
            <div className={styles.empty}>Loading templates…</div>
          ) : (
            <>
              <section className={styles.panel} style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>
                  Company-wide forms
                </h3>
                {companyTemplates.length === 0 ? (
                  <div className={styles.empty}>No company templates</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Category</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companyTemplates.map((t) => (
                          <tr key={t.id}>
                            <td>{t.title}</td>
                            <td>{formCategoryLabel(t.category)}</td>
                            <td>{renderTemplateActions(t)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className={styles.panel}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>
                  Department forms
                </h3>
                {deptTemplates.length === 0 ? (
                  <div className={styles.empty}>No department templates yet</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Department</th>
                          <th>Category</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptTemplates.map((t) => (
                          <tr key={t.id}>
                            <td>{t.title}</td>
                            <td>{t.department_name || "—"}</td>
                            <td>{formCategoryLabel(t.category)}</td>
                            <td>{renderTemplateActions(t)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {sendModal ? (
        <div className={styles.modalBackdrop} onClick={closeSendModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700 }}>
              Send: {sendModal.title}
            </h2>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>
              Category: <strong>{formCategoryLabel(sendModal.category)}</strong> · Template ID {sendModal.id}
            </p>
            <div className={styles.field}>
              <label className={styles.label}>Search employee</label>
              <input
                className={styles.input}
                value={empQ}
                onChange={(e) => setEmpQ(e.target.value)}
                placeholder="Name or ID"
              />
            </div>
            {empResults.slice(0, 8).map((e) => (
              <button
                key={e.id}
                type="button"
                className={`${styles.empItem} ${selectedEmp?.id === e.id ? styles.empItemActive : ""}`}
                onClick={() => setSelectedEmp(e)}
                style={{ marginBottom: 4 }}
              >
                {e.first_name} {e.last_name} (ID {e.id})
              </button>
            ))}
            {sendModal.category.toLowerCase() === "appraisal" ? (
              <div className={styles.field}>
                <label className={styles.label}>Review period *</label>
                <input
                  className={styles.input}
                  value={reviewPeriod}
                  onChange={(e) => setReviewPeriod(e.target.value)}
                  placeholder={reviewPeriodPlaceholder()}
                />
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b" }}>
                  Appraisal cycle dates — employee will see this read-only (e.g. Jan–Jun 2026).
                </p>
              </div>
            ) : null}
            <div className={styles.field}>
              <label className={styles.label}>
                {hrMessageFieldLabel(sendModal.category)}
                {isHrMessageRequired(sendModal.category) ? " *" : ""}
              </label>
              <textarea
                className={styles.textarea}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={hrMessagePlaceholder(sendModal.category)}
                rows={4}
              />
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b" }}>
                This message is shown to the employee when they open the form.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className={styles.btn} onClick={closeSendModal}>
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={!selectedEmp || sending}
                onClick={() => void sendForm()}
              >
                {sending ? "Sending…" : "Send form"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className={styles.modalBackdrop} onClick={closeCreateModal}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700 }}>New form template</h2>
            <div className={styles.field}>
              <label className={styles.label}>Title</label>
              <input className={styles.input} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Scope</label>
              <select
                className={styles.select}
                value={newScope}
                onChange={(e) => setNewScope(e.target.value as "company" | "department")}
              >
                <option value="company">Company-wide</option>
                <option value="department">Department only</option>
              </select>
            </div>
            {newScope === "department" ? (
              <div className={styles.field}>
                <label className={styles.label}>Department</label>
                <select
                  className={styles.select}
                  value={newDeptId}
                  onChange={(e) => setNewDeptId(e.target.value)}
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className={styles.field}>
              <label className={styles.label}>Category</label>
              <select
                className={styles.select}
                value={newCategory}
                onChange={(e) => onCategoryChange(e.target.value)}
              >
                <option value="general">General</option>
                <option value="warning">Warning</option>
                <option value="appraisal">Appraisal</option>
                <option value="onboarding">Onboarding</option>
                <option value="asset">Asset</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
              Form fields — select presets
            </p>
            {PRESET_GROUPS.map((group) => {
              const presets = FORM_FIELD_PRESETS.filter((p) => p.group === group);
              if (!presets.length) return null;
              return (
                <div key={group} className={styles.fieldGroup}>
                  <p className={styles.fieldGroupTitle}>{PRESET_GROUP_LABELS[group]}</p>
                  <div className={styles.checkGrid}>
                    {presets.map((preset) => (
                      <label key={preset.id} className={styles.checkItem}>
                        <input
                          type="checkbox"
                          checked={selectedPresets.includes(preset.id)}
                          onChange={() => togglePreset(preset.id)}
                        />
                        <span>
                          {preset.label}
                          {preset.required ? " *" : ""}
                          {preset.description ? (
                            <span className={styles.checkHint}>{preset.description}</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div style={{ marginTop: 16, marginBottom: 8 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                Custom fields
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                Add your own labels — e.g. &quot;Uniform size&quot;, &quot;Marital status&quot;.
              </p>
            </div>

            <div className={styles.customFieldsList}>
              {customFields.length === 0 ? (
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>
                  No custom fields yet. Click below to add one.
                </p>
              ) : null}
              {customFields.map((cf, index) => (
                <div key={cf.id} className={styles.customFieldCard}>
                  <p className={styles.customFieldCardTitle}>
                    Custom field {index + 1}
                    {cf.label.trim() ? ` — ${cf.label.trim()}` : ""}
                  </p>
                  <div className={styles.customFieldGrid}>
                    <div className={`${styles.field} ${styles.customFieldGridFull}`} style={{ margin: 0 }}>
                      <label className={styles.label}>Field label</label>
                      <input
                        className={styles.input}
                        placeholder="e.g. Marital status"
                        value={cf.label}
                        onChange={(e) => updateCustomField(cf.id, { label: e.target.value })}
                      />
                    </div>
                    <div className={styles.field} style={{ margin: 0 }}>
                      <label className={styles.label}>Type</label>
                      <select
                        className={styles.select}
                        value={cf.type}
                        onChange={(e) => {
                          const type = e.target.value as CustomFieldDraft["type"];
                          const patch: Partial<CustomFieldDraft> = { type };
                          if (type === "select") {
                            const filled = normalizeOptionList(cf.optionList);
                            patch.optionList =
                              filled.length >= 2 ? ensureOptionRows(filled, 2) : ["", ""];
                          }
                          updateCustomField(cf.id, patch);
                        }}
                      >
                        <option value="text">Text</option>
                        <option value="textarea">Long text</option>
                        <option value="select">Dropdown</option>
                        <option value="date">Date</option>
                        <option value="checkbox">Checkbox</option>
                      </select>
                    </div>
                    <div className={styles.field} style={{ margin: 0 }}>
                      <label className={styles.label}>Filled by</label>
                      <select
                        className={styles.select}
                        value={cf.filled_by}
                        onChange={(e) =>
                          updateCustomField(cf.id, {
                            filled_by: e.target.value as CustomFieldDraft["filled_by"],
                          })
                        }
                      >
                        <option value="employee">Employee</option>
                        <option value="hr">HR</option>
                        <option value="manager">Manager</option>
                      </select>
                    </div>
                    {cf.type === "select" ? (
                      <div className={`${styles.field} ${styles.customFieldGridFull}`} style={{ margin: 0 }}>
                        <label className={styles.label}>Dropdown options</label>
                        <FormFieldOptionsEditor
                          options={cf.optionList}
                          onChange={(optionList) => updateCustomField(cf.id, { optionList })}
                          minRows={2}
                          placeholder="e.g. Single, Married"
                          hint="Add at least 2 choices. Employees will pick one from the list."
                        />
                      </div>
                    ) : null}
                    {cf.type === "checkbox" ? (
                      <div className={`${styles.field} ${styles.customFieldGridFull}`} style={{ margin: 0 }}>
                        <label className={styles.label}>Checkbox choices</label>
                        <FormFieldOptionsEditor
                          options={cf.optionList}
                          onChange={(optionList) => updateCustomField(cf.id, { optionList })}
                          minRows={0}
                          placeholder="e.g. Health insurance"
                          hint="Leave empty for a single “I acknowledge” checkbox, or add options for multiple checkboxes."
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.customFieldActions}>
                    <label className={styles.checkItem} style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={cf.required}
                        onChange={(e) => updateCustomField(cf.id, { required: e.target.checked })}
                      />
                      Required field
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => insertCustomFieldAfter(index)}
                      >
                        + Add
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnDanger}`}
                        onClick={() => removeCustomField(cf.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.customFieldFooter}>
              <button type="button" className={styles.btn} onClick={appendCustomField}>
                + Add custom field
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
              <button type="button" className={styles.btn} onClick={closeCreateModal}>
                Cancel
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void createTemplate()}>
                Create template
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <FormTemplatePreviewModal
        templateId={previewTemplateId}
        onClose={() => setPreviewTemplateId(null)}
        onSaved={() => void load()}
      />
    </OptionalAdminShell>
  );
}
