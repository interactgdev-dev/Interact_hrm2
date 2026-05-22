"use client";
import React, { useState } from "react";

interface LateSittingOvertimeProps {
  shiftId: number;
  onClose: () => void;
}

export default function LateSittingOvertimeForm({ shiftId, onClose }: LateSittingOvertimeProps) {
  const [form, setForm] = useState({
    late_sitting_time: "",
    late_sitting_minutes: 0,
    overtime_per_month: 0,
    overtime_per_day: 0
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    await fetch("/api/shift-late-sitting-overtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, shift_id: shiftId })
    });
    setLoading(false);
    setSuccess(true);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Late Sitting Time:</label>
        <input type="time" name="late_sitting_time" value={form.late_sitting_time} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Late Sitting Minutes:</label>
        <input type="number" name="late_sitting_minutes" value={form.late_sitting_minutes} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>OverTime Per Month:</label>
        <input type="number" name="overtime_per_month" value={form.overtime_per_month} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>OverTime Per Day:</label>
        <input type="number" name="overtime_per_day" value={form.overtime_per_day} onChange={handleChange} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
      </div>
      <div style={{ flexBasis: "100%", display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 18 }}>
        <button type="submit" style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} disabled={loading}>Update</button>
        <button type="button" style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} onClick={onClose}>Close</button>
        {success && <span style={{ color: "#38b2ac", fontWeight: 600, fontSize: "0.97rem" }}>Saved!</span>}
      </div>
    </form>
  );
}
