"use client";

import React from "react";
import { ModalPortal } from "./ModalPortal";

export type StatusChangeReasonDraft = {
  employeeId: string;
  dateKey: string;
  fromStatus: string;
  nextStatus: string;
};

type Props = {
  draft: StatusChangeReasonDraft | null;
  saving?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export function StatusChangeReasonModal({
  draft,
  saving = false,
  onCancel,
  onConfirm,
}: Props) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!draft) return;
    setReason("");
    setError("");
  }, [draft]);

  if (!draft) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Please enter a reason for this status change.");
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <ModalPortal>
      <div
        role="presentation"
        onClick={saving ? undefined : onCancel}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 14000,
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-reason-title"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)",
            padding: "22px 24px 18px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2
            id="status-reason-title"
            style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "#0f172a" }}
          >
            Reason for status change
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748b", lineHeight: 1.4 }}>
            Changing status from <strong>{draft.fromStatus}</strong> to{" "}
            <strong>{draft.nextStatus}</strong>. This note is saved and shown in the Note column.
          </p>
          <form onSubmit={submit}>
            <label
              htmlFor="status-change-reason"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#334155",
                marginBottom: 6,
              }}
            >
              Reason <span style={{ color: "#c53030" }}>*</span>
            </label>
            <textarea
              id="status-change-reason"
              value={reason}
              disabled={saving}
              autoFocus
              rows={4}
              placeholder="Why is this status being changed?"
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError("");
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: error ? "1px solid #e53e3e" : "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                lineHeight: 1.4,
                resize: "vertical",
                minHeight: 96,
                fontFamily: "inherit",
              }}
            />
            {error ? (
              <div style={{ color: "#c53030", fontSize: 12, marginTop: 6 }}>{error}</div>
            ) : null}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 16,
              }}
            >
              <button
                type="button"
                disabled={saving}
                onClick={onCancel}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                  color: "#334155",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{
                  border: "none",
                  background: "#2b6cb0",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontWeight: 700,
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
