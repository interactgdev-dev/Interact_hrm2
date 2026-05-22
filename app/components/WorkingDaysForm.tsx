"use client";
import React, { useState } from "react";

interface WorkingDaysFormProps {
  shiftId: number;
  onClose: () => void;
}

const days = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

export default function WorkingDaysForm({ shiftId, onClose }: WorkingDaysFormProps) {
  const [form, setForm] = useState({
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    await fetch("/api/shift-working-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, shift_id: shiftId })
    });
    setLoading(false);
    setSuccess(true);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {days.map((day) => (
          <label key={day} style={{ fontWeight: 500, fontSize: "0.97rem" }}>
            <input
              type="checkbox"
              name={day}
              checked={form[day as keyof typeof form]}
              onChange={handleChange}
              style={{ marginRight: 6 }}
            />
            {day.charAt(0).toUpperCase() + day.slice(1)}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button type="submit" style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} disabled={loading}>Update</button>
        <button type="button" style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} onClick={onClose}>Close</button>
        {success && <span style={{ color: "#38b2ac", fontWeight: 600, fontSize: "0.97rem" }}>Saved!</span>}
      </div>
    </form>
  );
}
