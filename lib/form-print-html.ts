import type { FormTemplateRow } from "@/lib/employee-documents";
import { fieldsForAudience } from "@/lib/form-schema";
import { formatFieldValueForDisplay, isFileField } from "@/lib/form-field-options";

export function buildFormPrintHtml(params: {
  template: Pick<FormTemplateRow, "title" | "category">;
  employeeName: string;
  employeeId: string;
  formData: Record<string, unknown>;
  schema: unknown;
  submittedAt?: string | null;
  hrMessage?: string | null;
  audience?: "employee" | "all";
}): string {
  const audience = params.audience ?? "all";
  const fields = fieldsForAudience(params.schema, audience === "employee" ? "employee" : "all");
  const rows = fields
    .map((raw) => {
      if (!raw || typeof raw !== "object") return "";
      const f = raw as { key?: string; label?: string; type?: string; options?: string[] };
      if (!f.key) return "";
      const val = params.formData[f.key];
      if (isFileField(f)) {
        const file =
          val && typeof val === "object"
            ? (val as { file_name?: string; file_path?: string; documentId?: number })
            : null;
        if (!file?.file_path && !file?.documentId) {
          return `<tr><th>${escapeHtml(f.label || f.key)}</th><td>—</td></tr>`;
        }
        const label = escapeHtml(file.file_name || "Open PDF");
        const href = file.documentId
          ? `/api/employee-documents/${file.documentId}?action=preview`
          : escapeHtml(String(file.file_path));
        return `<tr><th>${escapeHtml(f.label || f.key)}</th><td><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></td></tr>`;
      }
      const display = formatFieldValueForDisplay(f, val);
      return `<tr><th>${escapeHtml(f.label || f.key)}</th><td>${escapeHtml(display)}</td></tr>`;
    })
    .join("");

  const submitted = params.submittedAt
    ? new Date(params.submittedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })
    : new Date().toLocaleString("en-PK", { timeZone: "Asia/Karachi" });

  const hrBlock =
    params.hrMessage && params.hrMessage.trim()
      ? `<div class="hr-msg"><div class="hr-msg-label">Message from HR</div><div class="hr-msg-body">${escapeHtml(params.hrMessage.trim())}</div></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.template.title)}</title>
  <style>
    body { font-family: Segoe UI, system-ui, sans-serif; color: #0f172a; padding: 32px; max-width: 800px; margin: 0 auto; }
    h1 { color: #611f69; font-size: 22px; margin: 0 0 8px; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { width: 36%; background: #f8fafc; font-size: 13px; }
    td { font-size: 14px; }
    .hr-msg { background: #fdf4ff; border: 1px solid #e9d5ef; border-left: 4px solid #611f69; padding: 14px 16px; border-radius: 10px; margin-bottom: 20px; }
    .hr-msg-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #611f69; margin-bottom: 6px; }
    .hr-msg-body { font-size: 14px; line-height: 1.5; color: #1d1c1d; white-space: pre-wrap; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(params.template.title)}</h1>
  <div class="meta">
    Employee: ${escapeHtml(params.employeeName)} (ID ${escapeHtml(params.employeeId)})<br/>
    Category: ${escapeHtml(params.template.category)} · Submitted: ${escapeHtml(submitted)}
  </div>
  ${hrBlock}
  <table>${rows}</table>
  <script>window.onload = function(){ /* optional auto-print */ };</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
