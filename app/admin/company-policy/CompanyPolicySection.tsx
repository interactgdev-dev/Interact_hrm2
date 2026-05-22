"use client";
import React from "react";

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

export function CompanyPolicySection() {
  const [policies, setPolicies] = React.useState<any[]>([]);
  const [editMode, setEditMode] = React.useState<{ id?: number } | null>(null);
  const [heading, setHeading] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    fetchPolicies();
  }, []);

  async function fetchPolicies() {
    setLoading(true);
    const res = await fetch("/api/company-policies", { cache: "no-store" });
    const data = await res.json();
    setPolicies(Array.isArray(data.policies) ? data.policies : (data.policy ? [data.policy] : []));
    setLoading(false);
  }

  function startEdit(policy?: any) {
    setEditMode(policy ? { id: policy.id } : {});
    setHeading(policy?.heading || "");
    setDescription(policy?.description || "");
  }

  async function handleSave() {
    setSaving(true);
    if (editMode?.id) {
      await fetch("/api/company-policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editMode.id, heading, description }),
      });
    } else {
      await fetch("/api/company-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heading, description }),
      });
    }
    setEditMode(null);
    setSaving(false);
    fetchPolicies();
  }

  async function handleDelete(id: number) {
    if (!id) return;
    if (!window.confirm("Delete this company policy?")) return;
    setDeleting(true);
    await fetch("/api/company-policies", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeleting(false);
    fetchPolicies();
  }

  return (
    <div style={{ marginTop: 16, background: "#fff", borderRadius: 14, boxShadow: "0 10px 28px rgba(10,31,68,0.08)", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: "1.15rem", color: "#0f1d40", fontWeight: 700 }}>Company Policy</h2>
        <button onClick={() => startEdit()} style={{
          marginTop: 0,
          marginLeft: 16,
          padding: "12px 24px",
          borderRadius: 12,
          border: "none",
          background: "linear-gradient(120deg, #1853b3, #8bf3ff)",
          color: "#fff",
          fontWeight: 700,
          fontSize: "1.05rem",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(10,31,68,0.08)"
        }}>Add New Policy</button>
      </div>
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
            <button onClick={() => setEditMode(null)} style={{ ...buttonStyle, background: "#e6e8f2", color: "#0f1d40" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          {policies.length > 0 ? (
            <>
              {[...policies].sort((a, b) => a.id - b.id).map(policy => (
                <div key={policy.id} style={{ marginBottom: 24 }}>
                  <div style={{ color: "#0f1d40", fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>{policy.heading}</div>
                  <div style={{ color: "#4a5775", fontSize: "0.95rem", minHeight: 40 }}>{policy.description}</div>
                  <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                    <button onClick={() => startEdit(policy)} style={{
                      padding: "10px 18px",
                      borderRadius: 12,
                      border: "none",
                      background: "linear-gradient(120deg, #1853b3, #8bf3ff)",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "1.01rem",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(10,31,68,0.08)"
                    }}>Edit</button>
                    <button onClick={() => handleDelete(policy.id)} disabled={deleting} style={{
                      padding: "10px 18px",
                      borderRadius: 12,
                      border: "none",
                      background: deleting ? "#e6e8f2" : "linear-gradient(120deg, #8bf3ff, #1853b3)",
                      color: deleting ? "#c0392b" : "#fff",
                      fontWeight: 700,
                      fontSize: "1.01rem",
                      cursor: deleting ? "not-allowed" : "pointer",
                      boxShadow: "0 2px 8px rgba(10,31,68,0.08)"
                    }}>
                      {deleting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div style={{ color: "#6b7b9b" }}>No company policy added yet.</div>
            </>
          )}
          {/* Add New Policy button moved to heading */}
        </div>
      )}
    </div>
  );
}
