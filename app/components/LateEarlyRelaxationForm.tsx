"use client";
import React, { useState } from "react";

interface LateEarlyRelaxationProps {
  shiftId: number;
  onClose: () => void;
}

export default function LateEarlyRelaxationForm({ shiftId, onClose }: LateEarlyRelaxationProps) {
  const [form, setForm] = useState({
    daily_late_minutes: 0,
    daily_early_minutes: 0,
    monthly_late_minutes: 0,
    monthly_early_minutes: 0,
    monthly_special_late_relax: 0,
    minutes_one_time_late: 0,
    no_late_without_special: 0,
    day_to_deduct: ""
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    await fetch("/api/shift-late-early-relaxation", {
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
        <label>Daily Late Minutes:</label>
        <input type="number" name="daily_late_minutes" value={form.daily_late_minutes} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Daily Early Minutes:</label>
        <input type="number" name="daily_early_minutes" value={form.daily_early_minutes} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Monthly Late Minutes:</label>
        <input type="number" name="monthly_late_minutes" value={form.monthly_late_minutes} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Monthly Early Minutes:</label>
        <input type="number" name="monthly_early_minutes" value={form.monthly_early_minutes} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Monthly Special No of Late Relax:</label>
        <input type="number" name="monthly_special_late_relax" value={form.monthly_special_late_relax} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Minutes for One Time Late:</label>
        <input type="number" name="minutes_one_time_late" value={form.minutes_one_time_late} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>No of late without Special Late:</label>
        <input type="number" name="no_late_without_special" value={form.no_late_without_special} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <label>Day to deduct:</label>
        <select name="day_to_deduct" value={form.day_to_deduct} onChange={handleChange} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
          <option value="">Select Day</option>
          <option value="Monday">Monday</option>
          <option value="Tuesday">Tuesday</option>
          <option value="Wednesday">Wednesday</option>
          <option value="Thursday">Thursday</option>
          <option value="Friday">Friday</option>
          <option value="Saturday">Saturday</option>
          <option value="Sunday">Sunday</option>
        </select>
      </div>
      <div style={{ flexBasis: "100%", display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 18 }}>
        <button type="submit" style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} disabled={loading}>Update</button>
        <button type="button" style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} onClick={onClose}>Close</button>
        {success && <span style={{ color: "#38b2ac", fontWeight: 600, fontSize: "0.97rem" }}>Saved!</span>}
      </div>
    </form>
  );
}
