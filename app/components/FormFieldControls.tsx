"use client";

import React from "react";
import { createPortal } from "react-dom";

/** Custom select — native <select> often fails to open inside overflow:auto modals on Windows. */
export function FormSelect({
  value,
  options,
  disabled,
  onChange,
  className,
  placeholder = "Select…",
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0, width: 0, maxHeight: 280 });

  const place = React.useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(280, Math.max(120, openUp ? spaceAbove : spaceBelow));
    setPos({
      top: openUp ? Math.max(8, r.top - maxHeight - 4) : r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 180),
      maxHeight,
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={className}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else {
            place();
            setOpen(true);
          }
        }}
        style={{
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          background: disabled ? "#f8fafc" : "#fff",
          color: value ? "#0f172a" : "#94a3b8",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || placeholder}
        </span>
        <span aria-hidden style={{ color: "#64748b", flexShrink: 0 }}>
          ▾
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="presentation"
              style={{ position: "fixed", inset: 0, zIndex: 10050 }}
              onClick={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            >
              <ul
                role="listbox"
                style={{
                  position: "fixed",
                  top: pos.top,
                  left: pos.left,
                  width: pos.width,
                  maxHeight: pos.maxHeight,
                  overflowY: "auto",
                  margin: 0,
                  padding: 6,
                  listStyle: "none",
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  boxShadow: "0 12px 28px rgba(15,23,42,0.18)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={!value}
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                    style={optionBtnStyle(!value)}
                  >
                    {placeholder}
                  </button>
                </li>
                {options.map((o) => (
                  <li key={o}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === o}
                      onClick={() => {
                        onChange(o);
                        setOpen(false);
                      }}
                      style={optionBtnStyle(value === o)}
                    >
                      {o}
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function optionBtnStyle(selected: boolean): React.CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    border: "none",
    background: selected ? "#f3e8f5" : "transparent",
    color: selected ? "#611f69" : "#0f172a",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "normal",
    lineHeight: 1.35,
  };
}

export type FormFileValue = {
  documentId: number;
  file_name: string;
  file_path: string;
  mime_type?: string;
};

export function parseFormFileValue(raw: unknown): FormFileValue | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as FormFileValue;
      if (parsed?.documentId && parsed?.file_path) return parsed;
    } catch {
      if (raw.startsWith("/uploads/")) {
        return { documentId: 0, file_name: raw.split("/").pop() || "file.pdf", file_path: raw };
      }
    }
    return null;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const documentId = Number(o.documentId || o.document_id || 0);
    const file_path = String(o.file_path || o.url || "");
    const file_name = String(o.file_name || o.name || "document.pdf");
    if (!file_path) return null;
    return {
      documentId,
      file_name,
      file_path,
      mime_type: o.mime_type ? String(o.mime_type) : undefined,
    };
  }
  return null;
}

export function FormFileUpload({
  value,
  disabled,
  accept = "application/pdf,.pdf",
  maxBytes = 10 * 1024 * 1024,
  employeeId,
  actorLogin,
  onChange,
  onError,
  hint = "PDF only · max 10 MB",
}: {
  value: unknown;
  disabled?: boolean;
  accept?: string;
  maxBytes?: number;
  employeeId: string;
  actorLogin: string;
  onChange: (next: FormFileValue | null) => void;
  onError?: (message: string) => void;
  hint?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const parsed = parseFormFileValue(value);

  async function onPick(file: File | null) {
    if (!file || disabled) return;
    if (file.size > maxBytes) {
      onError?.(`File exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)} MB limit`);
      return;
    }
    const mime = (file.type || "").toLowerCase();
    if (mime && mime !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onError?.("Only PDF files are allowed");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("employeeId", employeeId);
      fd.append("actorLogin", actorLogin);
      fd.append("files", file);
      const res = await fetch("/api/employee-documents", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success || !data.documents?.[0]) {
        throw new Error(data.error || "Upload failed");
      }
      const doc = data.documents[0] as {
        id: number;
        file_name: string;
        file_path: string;
        mime_type?: string;
      };
      onChange({
        documentId: doc.id,
        file_name: doc.file_name,
        file_path: doc.file_path,
        mime_type: doc.mime_type,
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function openFile() {
    if (!parsed) return;
    if (parsed.documentId > 0) {
      window.open(
        `/api/employee-documents/${parsed.documentId}?action=preview&actorLogin=${encodeURIComponent(actorLogin)}`,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }
    if (parsed.file_path) {
      window.open(parsed.file_path, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        disabled={disabled || uploading}
        onChange={(e) => void onPick(e.target.files?.[0] || null)}
      />
      {parsed ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            padding: "10px 12px",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            background: "#f8fafc",
          }}
        >
          <span style={{ fontSize: 13, color: "#0f172a", flex: 1, minWidth: 120 }}>
            {parsed.file_name}
          </span>
          <button
            type="button"
            onClick={openFile}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Open PDF
          </button>
          {!disabled ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #fecaca",
                background: "#fff",
                color: "#b91c1c",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || uploading || !employeeId}
          onClick={() => inputRef.current?.click()}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px dashed #cbd5e1",
            background: "#fafbfc",
            fontSize: 13,
            fontWeight: 600,
            color: "#611f69",
            cursor: disabled || uploading ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {uploading ? "Uploading…" : "Upload PDF"}
        </button>
      )}
      <span style={{ fontSize: 12, color: "#94a3b8" }}>{hint}</span>
    </div>
  );
}

/** Family slot index from field key, or null if not a family field. */
export function familySlotFromKey(key: string | undefined): number | null {
  if (!key) return null;
  const m = key.match(/^family_(\d+)(?:_|$)/) || key.match(/^section_family_(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isFamilyAddAnotherKey(key: string | undefined): boolean {
  return Boolean(key && /_add_another$/i.test(key));
}

export function inferFamilyCountFromData(
  formData: Record<string, unknown>,
  maxSlots = 8
): number {
  let highest = 1;
  for (let i = maxSlots; i >= 1; i--) {
    const keys = [
      `family_${i}_full_name`,
      `family_${i}_relationship`,
      `family_${i}_dob`,
      `family_${i}_cnic`,
      `family_${i}_dependent`,
    ];
    const filled = keys.some((k) => String(formData[k] ?? "").trim());
    if (filled) {
      highest = i;
      break;
    }
  }
  return highest;
}
