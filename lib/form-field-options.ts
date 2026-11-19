/** Helpers for dropdown / checkbox option lists in form builder. */

export function normalizeOptionList(options: string[] | undefined | null): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) => String(o).trim()).filter(Boolean);
}

export function ensureOptionRows(options: string[], minRows = 2): string[] {
  const next = [...options];
  while (next.length < minRows) next.push("");
  return next;
}

export function isCheckboxGroup(field: { type?: string; options?: string[] }): boolean {
  return field.type === "checkbox" && normalizeOptionList(field.options).length > 0;
}

export function isFileField(field: { type?: string }): boolean {
  const t = String(field.type || "").toLowerCase();
  return t === "file" || t === "pdf" || t === "upload";
}

export function formatFieldValueForDisplay(
  field: { type?: string; options?: string[] },
  value: unknown
): string {
  if (isFileField(field)) {
    if (!value) return "—";
    if (typeof value === "object") {
      const o = value as Record<string, unknown>;
      return String(o.file_name || o.name || o.file_path || "PDF attached");
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as { file_name?: string; name?: string };
        return String(parsed.file_name || parsed.name || "PDF attached");
      } catch {
        return value.trim() || "—";
      }
    }
    return "—";
  }
  if (isCheckboxGroup(field)) {
    const selected = Array.isArray(value)
      ? value.map(String).filter(Boolean)
      : value != null && String(value).trim()
        ? [String(value)]
        : [];
    return selected.length ? selected.join(", ") : "—";
  }
  if (field.type === "checkbox") return value ? "Yes" : "No";
  const s = value != null ? String(value).trim() : "";
  return s || "—";
}

export function toggleCheckboxGroupValue(current: unknown, option: string, checked: boolean): string[] {
  const list = Array.isArray(current) ? current.map(String) : [];
  if (checked) return list.includes(option) ? list : [...list, option];
  return list.filter((x) => x !== option);
}
