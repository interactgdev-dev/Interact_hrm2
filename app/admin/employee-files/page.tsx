"use client";

import React from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "./employee-files.module.css";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/document-constants";
import { formatFieldValueForDisplay, isCheckboxGroup, toggleCheckboxGroupValue } from "@/lib/form-field-options";
import { showAppToast } from "@/lib/app-toast";
import { showAppConfirm } from "@/lib/app-confirm";
import { canPreviewMime, documentTypeLabel, formCategoryLabel } from "@/lib/form-display";
import { fieldsForAudience } from "@/lib/form-schema";

type Emp = {
  id: number;
  first_name: string;
  last_name: string;
  employee_code: string | null;
  department_name: string | null;
  document_count: number;
};

type Doc = {
  id: number;
  file_name: string;
  folder_type: string;
  source_type: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

type Submission = {
  id: number;
  employee_id: number;
  employee_name?: string;
  template_title?: string;
  template_category?: string;
  status: string;
  submitted_at: string | null;
  result_document_id: number | null;
  assigned_note?: string | null;
  form_data?: Record<string, unknown> | null;
  form_schema?: { key?: string; label?: string; type?: string; options?: string[]; required?: boolean }[] | null;
};

type FormField = {
  key?: string;
  label?: string;
  type?: string;
  options?: string[];
  required?: boolean;
};

type PendingForm = {
  id: number;
  template_title?: string;
  template_category?: string;
  status: string;
};

export default function AdminEmployeeFilesPage() {
  const [tab, setTab] = React.useState<"folders" | "submitted">("folders");
  const [q, setQ] = React.useState("");
  const [employees, setEmployees] = React.useState<Emp[]>([]);
  const [selected, setSelected] = React.useState<Emp | null>(null);
  const [documents, setDocuments] = React.useState<Doc[]>([]);
  const [pendingForms, setPendingForms] = React.useState<PendingForm[]>([]);
  const [submissions, setSubmissions] = React.useState<Submission[]>([]);
  const [viewSubmission, setViewSubmission] = React.useState<Submission | null>(null);
  const [managerFormData, setManagerFormData] = React.useState<Record<string, unknown>>({});
  const [savingManager, setSavingManager] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const loginId = typeof window !== "undefined" ? localStorage.getItem("loginId") || "hr" : "hr";

  const loadEmployees = React.useCallback(async () => {
    const res = await fetch(`/api/admin/employee-files?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (data.success) setEmployees(data.employees || []);
  }, [q]);

  const loadDocs = React.useCallback(async (empId: number) => {
    const [docRes, formRes] = await Promise.all([
      fetch(`/api/employee-documents?employeeId=${empId}&hr=1`, { cache: "no-store" }),
      fetch(`/api/form-assignments?employeeId=${empId}`, { cache: "no-store" }),
    ]);
    const docData = await docRes.json();
    const formData = await formRes.json();
    if (docData.success) setDocuments(docData.documents || []);
    if (formData.success) {
      const all = formData.assignments || [];
      setPendingForms(
        all.filter((a: PendingForm) => ["pending", "in_progress", "draft"].includes(a.status))
      );
    }
  }, []);

  const loadSubmissions = React.useCallback(async () => {
    const res = await fetch(`/api/form-assignments?hr=1`, { cache: "no-store" });
    const data = await res.json();
    if (data.success) setSubmissions(data.assignments || []);
  }, []);

  React.useEffect(() => {
    setLoading(true);
    void loadEmployees().finally(() => setLoading(false));
  }, [loadEmployees]);

  React.useEffect(() => {
    if (tab === "submitted") void loadSubmissions();
  }, [tab, loadSubmissions]);

  React.useEffect(() => {
    if (selected) void loadDocs(selected.id);
  }, [selected, loadDocs]);

  async function hrUpload(files: FileList | null) {
    if (!files?.length || !selected) return;
    const fd = new FormData();
    fd.append("employeeId", String(selected.id));
    fd.append("isHr", "1");
    fd.append("actorLogin", loginId);
    for (const f of Array.from(files)) fd.append("files", f);
    const res = await fetch("/api/employee-documents", { method: "POST", body: fd });
    const data = await res.json();
    if (!data.success) showAppToast({ message: data.error || "Upload failed", variant: "error" });
    else {
      showAppToast({ message: "Document uploaded.", variant: "success" });
      await loadDocs(selected.id);
    }
  }

  async function hrDelete(docId: number) {
    const ok = await showAppConfirm({
      message: "Delete this document for the employee?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(
      `/api/employee-documents/${docId}?isHr=1&actorLogin=${encodeURIComponent(loginId)}`,
      { method: "DELETE" }
    );
    const data = await res.json();
    if (data.success && selected) {
      showAppToast({ message: "Document deleted.", variant: "success" });
      await loadDocs(selected.id);
    } else showAppToast({ message: data.error || "Delete failed", variant: "error" });
  }

  function previewDoc(doc: Doc) {
    if (!canPreviewMime(doc.mime_type)) {
      showAppToast({
        message: "Download Word/Excel files to preview.",
        variant: "info",
      });
      return;
    }
    window.open(
      `/api/employee-documents/${doc.id}?action=preview&isHr=1&actorLogin=${encodeURIComponent(loginId)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function cancelPendingForm(assignmentId: number) {
    const ok = await showAppConfirm({
      message: "Cancel this pending form for the employee?",
      confirmLabel: "Cancel form",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/form-assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", actorLogin: loginId }),
    });
    const data = await res.json();
    if (data.success && selected) {
      showAppToast({ message: "Pending form cancelled.", variant: "success" });
      await loadDocs(selected.id);
    } else showAppToast({ message: data.error || "Cancel failed", variant: "error" });
  }

  function downloadDoc(id: number, name: string) {
    const a = document.createElement("a");
    a.href = `/api/employee-documents/${id}?isHr=1&actorLogin=${encodeURIComponent(loginId)}`;
    a.download = name;
    a.click();
  }

  function downloadSubmittedForm(assignmentId: number, templateTitle?: string) {
    const safe = (templateTitle || "Form").replace(/[^\w\-]+/g, "_");
    const a = document.createElement("a");
    a.href = `/api/form-assignments/${assignmentId}/download?isHr=1&actorLogin=${encodeURIComponent(loginId)}`;
    a.download = `${safe}.docx`;
    a.click();
  }

  function printForm(assignmentId: number) {
    window.open(`/api/form-assignments/${assignmentId}/print`, "_blank");
  }

  async function openSubmissionResponse(id: number) {
    try {
      const res = await fetch(`/api/form-assignments/${id}?ts=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success || !data.assignment) {
        showAppToast({ message: data.error || "Could not load response", variant: "error" });
        return;
      }
      setViewSubmission(data.assignment as Submission);
      setManagerFormData({ ...(data.assignment.form_data || {}) });
    } catch {
      showAppToast({ message: "Could not load response", variant: "error" });
    }
  }

  function formatFieldValue(field: FormField, value: unknown): string {
    return formatFieldValueForDisplay(field, value);
  }

  const managerFields = viewSubmission
    ? (fieldsForAudience(viewSubmission.form_schema, "manager") as FormField[])
    : [];
  const employeeFields = viewSubmission
    ? (fieldsForAudience(viewSubmission.form_schema, "employee") as FormField[])
    : [];

  async function saveManagerReview() {
    if (!viewSubmission) return;
    setSavingManager(true);
    try {
      const res = await fetch(`/api/form-assignments/${viewSubmission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manager_review",
          form_data: managerFormData,
          actorLogin: loginId,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");
      showAppToast({ message: "Manager rating saved.", variant: "success" });
      await openSubmissionResponse(viewSubmission.id);
      await loadSubmissions();
    } catch (e) {
      showAppToast({
        message: e instanceof Error ? e.message : "Save failed",
        variant: "error",
      });
    } finally {
      setSavingManager(false);
    }
  }

  function renderManagerField(field: FormField) {
    const key = field.key || "";
    if (!key) return null;
    return (
      <div key={key} className={styles.field}>
        <label className={styles.label}>
          {field.label || key}
          {field.required ? " *" : ""}
        </label>
        {field.type === "select" ? (
          <select
            className={styles.select}
            value={String(managerFormData[key] ?? "")}
            onChange={(e) =>
              setManagerFormData((d) => ({ ...d, [key]: e.target.value }))
            }
          >
            <option value="">Select…</option>
            {(field.options || []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : field.type === "textarea" ? (
          <textarea
            className={styles.textarea}
            value={String(managerFormData[key] ?? "")}
            onChange={(e) =>
              setManagerFormData((d) => ({ ...d, [key]: e.target.value }))
            }
            rows={3}
          />
        ) : field.type === "checkbox" ? (
          isCheckboxGroup(field) ? (
            <div className={styles.checkboxGroup}>
              {(field.options || []).map((opt) => {
                const selected = Array.isArray(managerFormData[key])
                  ? (managerFormData[key] as string[])
                  : [];
                return (
                  <label key={opt} className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={selected.includes(opt)}
                      onChange={(e) =>
                        setManagerFormData((d) => ({
                          ...d,
                          [key]: toggleCheckboxGroupValue(d[key], opt, e.target.checked),
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
                checked={Boolean(managerFormData[key])}
                onChange={(e) =>
                  setManagerFormData((d) => ({ ...d, [key]: e.target.checked }))
                }
              />{" "}
              I acknowledge
            </label>
          )
        ) : (
          <input
            className={styles.input}
            type="text"
            value={String(managerFormData[key] ?? "")}
            onChange={(e) =>
              setManagerFormData((d) => ({ ...d, [key]: e.target.value }))
            }
          />
        )}
      </div>
    );
  }

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <header className={styles.header}>
            <h1 className={styles.title}>Employee Files</h1>
            <p className={styles.subtitle}>
              Browse each employee&apos;s folder, upload HR documents, and review submitted forms.
            </p>
          </header>

          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${tab === "folders" ? styles.tabActive : ""}`}
              onClick={() => setTab("folders")}
            >
              Employee folders
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "submitted" ? styles.tabActive : ""}`}
              onClick={() => setTab("submitted")}
            >
              Submitted forms
            </button>
          </div>

          {tab === "folders" ? (
            <>
              <div className={styles.toolbar}>
                <input
                  className={styles.search}
                  placeholder="Search name, ID, pseudonym…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <button type="button" className={styles.btn} onClick={() => void loadEmployees()}>
                  Search
                </button>
              </div>
              <div className={styles.layout}>
                <div className={styles.panel}>
                  <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Employees</h3>
                  {loading ? (
                    <div className={styles.empty}>Loading…</div>
                  ) : employees.length === 0 ? (
                    <div className={styles.empty}>No employees found</div>
                  ) : (
                    employees.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        className={`${styles.empItem} ${selected?.id === emp.id ? styles.empItemActive : ""}`}
                        onClick={() => setSelected(emp)}
                      >
                        <div className={styles.empName}>
                          {emp.first_name} {emp.last_name}
                          <span className={styles.badge}>{emp.document_count || 0} files</span>
                        </div>
                        <div className={styles.empMeta}>
                          ID {emp.id}
                          {emp.department_name ? ` · ${emp.department_name}` : ""}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className={styles.panel}>
                  {!selected ? (
                    <div className={styles.empty}>Select an employee to view their folder</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                          {selected.first_name} {selected.last_name} — My Folder
                        </h3>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          onClick={() => uploadRef.current?.click()}
                        >
                          Upload HR document
                        </button>
                        <input
                          ref={uploadRef}
                          type="file"
                          multiple
                          accept={DOCUMENT_UPLOAD_ACCEPT}
                          style={{ display: "none" }}
                          onChange={(e) => {
                            void hrUpload(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </div>
                      {pendingForms.length > 0 ? (
                        <div style={{ marginBottom: 16, padding: 12, background: "#fffbeb", borderRadius: 12, border: "1px solid #fde68a" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Pending forms</div>
                          {pendingForms.map((f) => (
                            <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13 }}>
                                <strong>{f.template_title}</strong> ({f.status})
                              </span>
                              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => void cancelPendingForm(f.id)}>
                                Cancel
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {documents.length === 0 ? (
                        <div className={styles.empty}>No documents in this folder</div>
                      ) : (
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>File</th>
                                <th>Type</th>
                                <th>Date</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {documents.map((doc) => (
                                <tr key={doc.id}>
                                  <td>{doc.file_name}</td>
                                  <td>{doc.folder_type}</td>
                                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                                  <td>
                                    <div className={styles.actions}>
                                      <button type="button" className={styles.btn} onClick={() => previewDoc(doc)}>
                                        Preview
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.btn}
                                        onClick={() => downloadDoc(doc.id, doc.file_name)}
                                      >
                                        Download
                                      </button>
                                      <button
                                        type="button"
                                        className={`${styles.btn} ${styles.btnDanger}`}
                                        onClick={() => hrDelete(doc.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.panel}>
              {submissions.length === 0 ? (
                <div className={styles.empty}>No submitted forms yet</div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Form</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s) => (
                        <tr key={s.id}>
                          <td>{s.employee_name || s.employee_id}</td>
                          <td>{s.template_title}</td>
                          <td>
                            {s.submitted_at
                              ? new Date(s.submitted_at).toLocaleString()
                              : "—"}
                          </td>
                          <td>
                            <div className={styles.actions}>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnPrimary}`}
                                onClick={() => void openSubmissionResponse(s.id)}
                              >
                                View response
                              </button>
                              <button
                                type="button"
                                className={styles.btn}
                                onClick={() => printForm(s.id)}
                              >
                                Print
                              </button>
                              <button
                                type="button"
                                className={styles.btn}
                                onClick={() => downloadSubmittedForm(s.id, s.template_title)}
                              >
                                Download
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {viewSubmission ? (
        <div className={styles.modalBackdrop} onClick={() => setViewSubmission(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>
              {viewSubmission.template_title || "Form response"}
            </h2>
            <p className={styles.modalMeta}>
              {viewSubmission.employee_name || `Employee #${viewSubmission.employee_id}`}
              {viewSubmission.template_category
                ? ` · ${formCategoryLabel(viewSubmission.template_category)}`
                : ""}
              {viewSubmission.submitted_at
                ? ` · Submitted ${new Date(viewSubmission.submitted_at).toLocaleString()}`
                : ""}
            </p>
            {viewSubmission.assigned_note?.trim() ? (
              <div className={styles.hrMessage}>
                <div className={styles.hrMessageLabel}>Your message to employee</div>
                <div className={styles.hrMessageBody}>{viewSubmission.assigned_note.trim()}</div>
              </div>
            ) : null}
            <h3 className={styles.responseHeading}>Employee response</h3>
            <div className={styles.responseList}>
              {employeeFields.map((field) => {
                  const key = field.key || "";
                  if (!key) return null;
                  return (
                    <div key={key} className={styles.responseRow}>
                      <div className={styles.responseLabel}>{field.label || key}</div>
                      <div className={styles.responseValue}>
                        {formatFieldValue(field, viewSubmission.form_data?.[key])}
                      </div>
                    </div>
                  );
                })}
            </div>
            {managerFields.length > 0 ? (
              <>
                <h3 className={styles.responseHeading}>Manager review</h3>
                <p className={styles.modalMeta}>
                  Overall rating and manager-only fields — filled by manager / HR after employee submits.
                </p>
                {managerFields.map((field) => renderManagerField(field))}
              </>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={() => setViewSubmission(null)}>
                Close
              </button>
              {managerFields.length > 0 ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={savingManager}
                  onClick={() => void saveManagerReview()}
                >
                  {savingManager ? "Saving…" : "Save manager rating"}
                </button>
              ) : null}
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => printForm(viewSubmission.id)}
              >
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </OptionalAdminShell>
  );
}
