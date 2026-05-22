"use client";
import React, { useState } from "react";

interface LeaveSettingsFormProps {
  shiftId: number;
  onClose: () => void;
}

export default function LeaveSettingsForm({ shiftId, onClose }: LeaveSettingsFormProps) {
  const [form, setForm] = useState({
    auto_calculate: false,
    full_day_minutes: 0,
    half_day_minutes: 0,
    short_day_minutes: 0,
    full_day_value: 1,
    half_day_value: 0.5,
    short_day_value: 0.33
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    await fetch("/api/shift-leave-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, shift_id: shiftId })
    });
    setLoading(false);
    setSuccess(true);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
      <div style={{ flexBasis: "100%" }}>
        <label style={{ fontWeight: 500, fontSize: "0.97rem" }}>
          <input type="checkbox" name="auto_calculate" checked={form.auto_calculate} onChange={handleChange} style={{ marginRight: 6 }} />
          Check to auto calculate the leave minutes on the basis of Shift IN and Shift OUT
        </label>
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Full Day Minutes</label>
        <input type="number" name="full_day_minutes" value={form.full_day_minutes} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Full Day Value</label>
        <input type="number" step="0.01" name="full_day_value" value={form.full_day_value} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Half Day Minutes</label>
        <input type="number" name="half_day_minutes" value={form.half_day_minutes} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Half Day Value</label>
        <input type="number" step="0.01" name="half_day_value" value={form.half_day_value} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Short Day Minutes</label>
        <input type="number" name="short_day_minutes" value={form.short_day_minutes} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Short Day Value</label>
        <input type="number" step="0.01" name="short_day_value" value={form.short_day_value} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flexBasis: "100%", display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 18 }}>
        <button type="submit" style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} disabled={loading}>Update</button>
        <button type="button" style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} onClick={onClose}>Close</button>
        {success && <span style={{ color: "#38b2ac", fontWeight: 600, fontSize: "0.97rem" }}>Saved!</span>}
      </div>
    </form>
  );
}
