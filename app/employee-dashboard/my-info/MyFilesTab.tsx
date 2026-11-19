"use client";

import React from "react";
import { createPortal } from "react-dom";
import { FaDownload, FaTrash, FaUpload, FaFileAlt, FaEdit, FaEye } from "react-icons/fa";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/document-constants";
import { showAppToast } from "@/lib/app-toast";
import { showAppConfirm } from "@/lib/app-confirm";
import { canPreviewMime, documentTypeLabel, formCategoryLabel } from "@/lib/form-display";
import { fieldsForAudience } from "@/lib/form-schema";
import {
  formatFieldValueForDisplay,
  isCheckboxGroup,
  isFileField,
  toggleCheckboxGroupValue,
} from "@/lib/form-field-options";
import {
  FormFileUpload,
  FormSelect,
  familySlotFromKey,
  inferFamilyCountFromData,
  isFamilyAddAnotherKey,
} from "@/app/components/FormFieldControls";
import styles from "./my-files.module.css";

type Doc = {
  id: number;
  file_name: string;
  folder_type: string;
  source_type: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  is_readonly: number;
};

type Assignment = {
  id: number;
  template_id?: number;
  template_title?: string;
  template_category?: string;
  status: string;
  assigned_note?: string | null;
  form_data?: Record<string, unknown> | null;
  form_schema?: unknown;
  submitted_at?: string | null;
  updated_at: string;
};

type FormField = {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  readonly?: boolean;
  options?: string[];
  filled_by?: "employee" | "manager";
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function folderBadge(doc: Doc) {
  if (doc.source_type === "employee_upload") return styles.badgePersonal;
  if (doc.source_type === "form_submission") return styles.badgeSubmitted;
  return styles.badgeHr;
}

function HrMessageBox({
  message,
  label = "Message from HR",
  variant = "default",
}: {
  message: string;
  label?: string;
  variant?: "default" | "review";
}) {
  return (
    <div
      className={`${styles.hrMessage} ${variant === "review" ? styles.hrMessageReview : ""}`}
    >
      <div className={styles.hrMessageLabel}>{label}</div>
      <div className={styles.hrMessageBody}>{message}</div>
    </div>
  );
}

function FormFillModal({
  assignment,
  employeeId,
  actorLogin,
  onClose,
  onSaved,
}: {
  assignment: Assignment;
  employeeId: string;
  actorLogin: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields = fieldsForAudience(assignment.form_schema, "employee") as FormField[];
  const maxFamilySlot = React.useMemo(() => {
    let max = 0;
    for (const f of fields) {
      const slot = familySlotFromKey(f.key);
      if (slot && slot > max) max = slot;
    }
    return max;
  }, [fields]);
  const [formData, setFormData] = React.useState<Record<string, unknown>>(
    () => ({ ...(assignment.form_data || {}) })
  );
  const [familyCount, setFamilyCount] = React.useState(() =>
    maxFamilySlot > 0
      ? Math.min(maxFamilySlot, inferFamilyCountFromData(assignment.form_data || {}, maxFamilySlot))
      : 1
  );
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function patch(action: string) {
    setSaving(true);
    setError("");
    try {
      const cleaned = { ...formData };
      if (maxFamilySlot > 0) {
        for (let i = familyCount + 1; i <= maxFamilySlot; i++) {
          for (const key of Object.keys(cleaned)) {
            if (familySlotFromKey(key) === i || isFamilyAddAnotherKey(key)) {
              delete cleaned[key];
            }
          }
        }
        for (const key of Object.keys(cleaned)) {
          if (isFamilyAddAnotherKey(key)) delete cleaned[key];
        }
      }
      const res = await fetch(`/api/form-assignments/${assignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, form_data: cleaned }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      onSaved();
      if (action === "submit") onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (isFamilyAddAnotherKey(f.key)) continue;
    const slot = familySlotFromKey(f.key);
    if (slot != null && slot > familyCount) continue;

    if (f.type === "heading") {
      rendered.push(
        <div key={f.key} className={styles.field} style={{ marginTop: 18, marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
            {f.label || f.key}
          </h3>
          {Array.isArray(f.options) && f.options[0] ? (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
              {f.options[0]}
            </p>
          ) : null}
        </div>
      );
    } else {
      rendered.push(
        <div key={f.key} className={styles.field}>
          <label className={styles.label}>
            {f.label || f.key}
            {f.required ? " *" : ""}
          </label>
          {Array.isArray(f.options) && f.options[0] && isFileField(f) ? (
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748b" }}>{f.options[0]}</p>
          ) : null}
          {f.type === "textarea" ? (
            <textarea
              className={styles.textarea}
              value={String(formData[f.key] ?? "")}
              readOnly={f.readonly}
              onChange={(e) => setFormData((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          ) : f.type === "select" ? (
            <FormSelect
              className={styles.select}
              value={String(formData[f.key] ?? "")}
              disabled={f.readonly}
              options={f.options || []}
              onChange={(next) => setFormData((d) => ({ ...d, [f.key]: next }))}
            />
          ) : isFileField(f) ? (
            <FormFileUpload
              value={formData[f.key]}
              disabled={f.readonly}
              employeeId={employeeId}
              actorLogin={actorLogin}
              onChange={(next) => setFormData((d) => ({ ...d, [f.key]: next }))}
              onError={(message) => setError(message)}
            />
          ) : f.type === "checkbox" ? (
            isCheckboxGroup(f) ? (
              <div className={styles.checkboxGroup}>
                {(f.options || []).map((opt) => {
                  const selected = Array.isArray(formData[f.key])
                    ? (formData[f.key] as string[])
                    : [];
                  return (
                    <label key={opt} className={styles.checkItem}>
                      <input
                        type="checkbox"
                        checked={selected.includes(opt)}
                        disabled={f.readonly}
                        onChange={(e) =>
                          setFormData((d) => ({
                            ...d,
                            [f.key]: toggleCheckboxGroupValue(d[f.key], opt, e.target.checked),
                          }))
                        }
                      />{" "}
                      {opt}
                    </label>
                  );
                })}
              </div>
            ) : (
              <label className={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={Boolean(formData[f.key])}
                  disabled={f.readonly}
                  onChange={(e) => setFormData((d) => ({ ...d, [f.key]: e.target.checked }))}
                />{" "}
                I acknowledge
              </label>
            )
          ) : (
            <input
              className={styles.input}
              type={f.type === "date" ? "date" : "text"}
              value={String(formData[f.key] ?? "")}
              readOnly={f.readonly}
              onChange={(e) => setFormData((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          )}
        </div>
      );
    }

    const isLastOfVisibleFamilySlot =
      slot != null &&
      slot === familyCount &&
      (i === fields.length - 1 || familySlotFromKey(fields[i + 1]?.key) !== slot);

    if (isLastOfVisibleFamilySlot && familyCount < maxFamilySlot) {
      rendered.push(
        <div key={`add-family-${slot}`} className={styles.field} style={{ marginTop: 4 }}>
          <button
            type="button"
            className={styles.btnSm}
            style={{ color: "#611f69", borderColor: "#e9d5ef", background: "#fdf4ff" }}
            onClick={() => setFamilyCount((n) => Math.min(maxFamilySlot, n + 1))}
          >
            + Add another family member
          </button>
        </div>
      );
    }
  }

  return createPortal(
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className={styles.modalTitle}>{assignment.template_title || "Complete form"}</h2>
        {assignment.assigned_note?.trim() ? (
          <HrMessageBox message={assignment.assigned_note.trim()} />
        ) : null}
        {String(assignment.form_data?.review_period ?? "").trim() ? (
          <HrMessageBox
            label="Review period"
            variant="review"
            message={String(assignment.form_data?.review_period).trim()}
          />
        ) : null}
        {error ? <div className={`${styles.alert} ${styles.alertError}`}>{error}</div> : null}
        <div className={styles.modalBody}>{rendered}</div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.btnSm} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnSm}
            onClick={() => patch("draft")}
            disabled={saving}
          >
            Save draft
          </button>
          <button
            type="button"
            className={`${styles.btnSm} ${styles.btnPrimary}`}
            onClick={() => patch("submit")}
            disabled={saving}
          >
            {saving ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function MyFilesTab({ employeeId }: { employeeId: string }) {
  const [documents, setDocuments] = React.useState<Doc[]>([]);
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [fillAssignment, setFillAssignment] = React.useState<Assignment | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const loginId = typeof window !== "undefined" ? localStorage.getItem("loginId") || "" : "";

  const load = React.useCallback(async () => {
    const empId = String(employeeId || "").trim();
    if (!empId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [docRes, assignRes] = await Promise.all([
        fetch(`/api/employee-documents?employeeId=${encodeURIComponent(empId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/form-assignments?employeeId=${encodeURIComponent(empId)}`, {
          cache: "no-store",
        }),
      ]);
      const docData = await docRes.json();
      const assignData = await assignRes.json();
      if (docData.success) setDocuments(docData.documents || []);
      else setDocuments([]);
      if (assignData.success) setAssignments(assignData.assignments || []);
      else {
        setAssignments([]);
        if (assignData.error) {
          showAppToast({
            message: assignData.error || "Could not load forms from HR",
            variant: "error",
          });
        }
      }
    } catch {
      setDocuments([]);
      setAssignments([]);
      showAppToast({ message: "Could not load My Files", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length || !employeeId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("employeeId", employeeId);
      fd.append("actorLogin", loginId);
      for (const f of list) fd.append("files", f);
      const res = await fetch("/api/employee-documents", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Upload failed");
      showAppToast({ message: "File uploaded to My Folder.", variant: "success" });
      await load();
    } catch (e) {
      showAppToast({
        message: e instanceof Error ? e.message : "Upload failed",
        variant: "error",
      });
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(id: number) {
    const ok = await showAppConfirm({
      message: "Delete this file?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(
      `/api/employee-documents/${id}?employeeId=${encodeURIComponent(employeeId)}&actorLogin=${encodeURIComponent(loginId)}`,
      { method: "DELETE" }
    );
    const data = await res.json();
    if (data.success) {
      showAppToast({ message: "File removed.", variant: "success" });
      await load();
    } else showAppToast({ message: data.error || "Could not delete", variant: "error" });
  }

  function downloadDoc(id: number, name: string, sourceType?: string) {
    const ext =
      sourceType === "form_submission"
        ? ".docx"
        : name.includes(".")
          ? name.slice(name.lastIndexOf("."))
          : "";
    const base = name.replace(/\.[^.]+$/, "") || "document";
    const url = `/api/employee-documents/${id}?actorLogin=${encodeURIComponent(loginId)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = sourceType === "form_submission" ? `${base}.docx` : name;
    a.click();
  }

  function previewDoc(doc: Doc) {
    if (!canPreviewMime(doc.mime_type)) {
      showAppToast({
        message: "Download this file to preview Word/Excel documents.",
        variant: "info",
      });
      return;
    }
    window.open(
      `/api/employee-documents/${doc.id}?action=preview&actorLogin=${encodeURIComponent(loginId)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function openFillForm(assignmentId: number) {
    try {
      const res = await fetch(`/api/form-assignments/${assignmentId}?ts=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.success || !data.assignment) {
        showAppToast({ message: data.error || "Could not load form", variant: "error" });
        return;
      }
      setFillAssignment(data.assignment);
    } catch {
      showAppToast({ message: "Could not load form", variant: "error" });
    }
  }

  function previewForm(assignmentId: number) {
    window.open(
      `/api/form-assignments/${assignmentId}/print?audience=employee`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  const isHrIssuedDoc = (doc: Doc) =>
    doc.source_type === "hr_upload" ||
    doc.source_type === "warning" ||
    doc.source_type === "appraisal" ||
    doc.folder_type === "hr_issued";

  const pendingForms = assignments.filter((a) =>
    ["pending", "in_progress", "draft"].includes(String(a.status || "").toLowerCase())
  );
  const submittedForms = assignments.filter(
    (a) => String(a.status || "").toLowerCase() === "submitted"
  );

  if (loading) {
    return <div className={styles.empty}>Loading My Files…</div>;
  }

  return (
    <div>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          <FaFileAlt /> Forms to complete
        </h3>
        <p className={styles.uploadHint} style={{ marginBottom: 12 }}>
          When HR sends you a form (Form Templates → Send to employee), it appears here. Fill and
          submit — then it moves to <strong>Submitted forms</strong> and <strong>My folder</strong>.
        </p>
        {pendingForms.length === 0 ? (
          <div className={styles.empty}>
            No form waiting right now. If HR just sent one, refresh this page.
          </div>
        ) : (
          pendingForms.map((a) => (
            <div key={a.id} className={styles.formCard}>
              <p className={styles.formCardTitle}>
                {a.template_title || formCategoryLabel(a.template_category)}
              </p>
              <p className={styles.formCardMeta}>
                {formCategoryLabel(a.template_category)}
                {a.template_id ? ` · Form #${a.template_id}` : ""}
                {" · "}
                <span className={`${styles.badge} ${styles.badgePending}`}>{a.status}</span>
              </p>
              {a.assigned_note?.trim() ? <HrMessageBox message={a.assigned_note.trim()} /> : null}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btnSm}
                  onClick={() => previewForm(a.id)}
                >
                  <FaEye /> Preview
                </button>
                <button
                  type="button"
                  className={`${styles.btnSm} ${styles.btnPrimary}`}
                  onClick={() => void openFillForm(a.id)}
                >
                  <FaEdit /> Fill form
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {submittedForms.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <FaFileAlt /> Submitted forms
          </h3>
          {submittedForms.map((a) => (
            <div key={a.id} className={styles.formCard}>
              <p className={styles.formCardTitle}>
                {a.template_title || formCategoryLabel(a.template_category)}
              </p>
              <p className={styles.formCardMeta}>
                {formCategoryLabel(a.template_category)}
                {" · "}
                <span className={`${styles.badge} ${styles.badgeSubmitted}`}>submitted</span>
                {a.submitted_at
                  ? ` · ${new Date(a.submitted_at).toLocaleString()}`
                  : ""}
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.btnSm} ${styles.btnPrimary}`}
                  onClick={() => previewForm(a.id)}
                >
                  <FaEye /> Open / print
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          <FaUpload /> Upload documents
        </h3>
        <div
          className={`${styles.uploadZone} ${dragOver ? styles.uploadZoneActive : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <p className={styles.uploadHint}>
            <strong>Drop files here</strong> or click to browse
            <br />
            PDF, images, Word, Excel — up to 100 MB each
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOCUMENT_UPLOAD_ACCEPT}
          className={styles.hiddenInput}
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? <p className={styles.uploadHint}>Uploading…</p> : null}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>My folder</h3>
        {documents.length === 0 ? (
          <div className={styles.empty}>No documents yet. Upload files or complete forms from HR.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.file_name}</td>
                    <td>
                      <span className={`${styles.badge} ${folderBadge(doc)}`}>
                        {documentTypeLabel(doc)}
                      </span>
                    </td>
                    <td>{formatBytes(doc.file_size)}</td>
                    <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className={styles.actions}>
                        {(isHrIssuedDoc(doc) || canPreviewMime(doc.mime_type)) ? (
                          <button
                            type="button"
                            className={styles.btnSm}
                            onClick={() => previewDoc(doc)}
                          >
                            <FaEye /> Preview
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={styles.btnSm}
                          onClick={() => downloadDoc(doc.id, doc.file_name, doc.source_type)}
                        >
                          <FaDownload /> Download
                        </button>
                        {doc.source_type === "employee_upload" && !doc.is_readonly ? (
                          <button
                            type="button"
                            className={`${styles.btnSm} ${styles.btnDanger}`}
                            onClick={() => deleteDoc(doc.id)}
                          >
                            <FaTrash /> Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {fillAssignment ? (
        <FormFillModal
          assignment={fillAssignment}
          employeeId={employeeId}
          actorLogin={loginId}
          onClose={() => setFillAssignment(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}
