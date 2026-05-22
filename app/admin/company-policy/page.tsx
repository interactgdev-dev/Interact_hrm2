"use client";
import React from "react";
import LayoutDashboard from "@/app/layout-dashboard";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #dfe3eb",
  fontSize: "0.95rem",
};

const buttonStyle: React.CSSProperties = {
  marginTop: 4,
  padding: "12px 14px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(120deg, #0052cc, #0b74ff)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

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
    if (!window.confirm("Delete this company policy?")) return;
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
    <LayoutDashboard>
      <div style={{ marginTop: 16, background: "#fff", borderRadius: 14, boxShadow: "0 10px 28px rgba(10,31,68,0.08)", padding: 18 }}>
        <h2 style={{ margin: "0 0 12px 0", fontSize: "1.15rem", color: "#0f1d40", fontWeight: 700 }}>Company Policy</h2>
        {loading ? (
          <div style={{ color: "#6b7b9b" }}>Loading...</div>
        ) : editMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              placeholder="Heading"
              value={heading}
              onChange={e => setHeading(e.target.value)}
              style={inputStyle}
            />
            <textarea
              placeholder="Description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              style={{ ...inputStyle, minHeight: 80 }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleSave} disabled={saving} style={buttonStyle}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button onClick={() => setEditMode(false)} style={{ ...buttonStyle, background: "#e6e8f2", color: "#0f1d40" }}>Cancel</button>
            </div>
          </div>
        ) : policy ? (
          <div>
            <div style={{ color: "#0f1d40", fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>{policy.heading}</div>
            <div style={{ color: "#4a5775", fontSize: "0.95rem", minHeight: 40 }}>{policy.description}</div>
            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button onClick={() => setEditMode(true)} style={buttonStyle}>Edit</button>
              <button onClick={handleDelete} disabled={deleting} style={{ ...buttonStyle, background: "#e6e8f2", color: "#c0392b" }}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: "#6b7b9b" }}>No company policy added yet.</div>
            <button onClick={() => setEditMode(true)} style={buttonStyle}>Add Policy</button>
          </div>
        )}
      </div>
    </LayoutDashboard>
  );
}
