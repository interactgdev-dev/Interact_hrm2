"use client";
import React from "react";
import { showAppConfirm } from "@/lib/app-confirm";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../admin-page.module.css";

export default function CompanyPolicyPage() {
  const [policy, setPolicy] = React.useState<any | null>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [heading, setHeading] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    fetchPolicy();
  }, []);

  async function fetchPolicy() {
    setLoading(true);
    const res = await fetch("/api/company-policies", { cache: "no-store" });
    const data = await res.json();
    const policyItem = Array.isArray(data.policies)
      ? data.policies[0] || null
      : (data.policy || null);
    setPolicy(policyItem);
    setHeading(policyItem?.heading || "");
    setDescription(policyItem?.description || "");
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    if (policy && policy.id) {
      await fetch("/api/company-policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: policy.id, heading, description }),
      });
    } else {
      await fetch("/api/company-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heading, description }),
      });
    }
    setEditMode(false);
    setSaving(false);
    fetchPolicy();
  }

  async function handleDelete() {
    if (!policy?.id) return;
    const ok = await showAppConfirm({
      message: "Delete this company policy?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    await fetch("/api/company-policies", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: policy.id }),
    });
    setDeleting(false);
    setPolicy(null);
    setHeading("");
    setDescription("");
  }

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}>Company Policy</h1>
          <p className={styles.subtitle}>Manage the company policy displayed to employees.</p>

          <div className={styles.card}>
            {loading ? (
              <p className={styles.muted}>Loading...</p>
            ) : editMode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className={styles.field}>
                  <label>Heading</label>
                  <input
                    className={styles.input}
                    placeholder="Heading"
                    value={heading}
                    onChange={(e) => setHeading(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Description</label>
                  <textarea
                    className={styles.textareaField}
                    placeholder="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                  />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={handleSave} disabled={saving} className={styles.btnPrimary}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditMode(false)} className={styles.btnSecondary}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : policy ? (
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 8, color: "#0f172a" }}>
                  {policy.heading}
                </div>
                <p className={styles.muted} style={{ minHeight: 40, margin: "0 0 16px" }}>
                  {policy.description}
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => setEditMode(true)} className={styles.btnPrimary}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className={styles.btnReject}
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className={styles.muted}>No company policy added yet.</p>
                <button type="button" onClick={() => setEditMode(true)} className={styles.btnPrimary} style={{ marginTop: 12 }}>
                  Add Policy
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </OptionalAdminShell>
  );
}
