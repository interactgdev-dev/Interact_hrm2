"use client";
import React, { useEffect, useState } from "react";
import LateEarlyRelaxationForm from "./LateEarlyRelaxationForm";
import LateSittingOvertimeForm from "./LateSittingOvertimeForm";
import WorkingDaysForm from "./WorkingDaysForm";
import LeaveSettingsForm from "./LeaveSettingsForm";

interface MasterShift {
  id: number;
  name: string;
  shift_in: string;
  shift_out: string;
  late_daily: number;
  early_daily: number;
  overtime_daily: number;
  working_days: string;
  late_sitting: number;
}

const tabList = [
  "Shift",
  "Late & Early Relaxation",
  "Late Sitting & Over Time",
  "Working Days",
  "Leave",
  "Missing Time"
];

export default function MasterShiftsTable() {
  const [shifts, setShifts] = useState<MasterShift[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  // Shift form state
  const [shiftName, setShiftName] = useState("");
  const [shiftIn, setShiftIn] = useState("");
  const [shiftOut, setShiftOut] = useState("");
  const [shiftOutNextDay, setShiftOutNextDay] = useState(false);
  const [newShiftId, setNewShiftId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [editModal, setEditModal] = useState<{ open: boolean; shift: MasterShift | null }>({ open: false, shift: null });

  useEffect(() => {
    fetch("/api/master-shifts")
      .then((res) => res.json())
      .then((data: MasterShift[]) => setShifts(data));
  }, []);

  // Add new shift to DB
  const handleShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    const res = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: shiftName,
        shift_in: shiftIn,
        shift_out: shiftOut,
        shift_out_next_day: shiftOutNextDay
      })
    });
    setLoading(false);
    setSuccess(true);
    // Get inserted shift id
    const shiftsRes = await fetch("/api/shifts");
    const shiftsData = await shiftsRes.json();
    if (shiftsData.length > 0) {
      setNewShiftId(shiftsData[shiftsData.length - 1].id);
    }
  };

  // Delete shift
  const handleDelete = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this shift?")) return;
    await fetch(`/api/shifts?id=${id}`, { method: "DELETE" });
    setShifts((prev) => prev.filter((s) => s.id !== id));
  };

  // Edit shift
  const handleEdit = (shift: MasterShift) => {
    setEditModal({ open: true, shift });
  };

  // Update shift
  const handleUpdateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.shift) return;
    await fetch(`/api/shifts?id=${editModal.shift.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editModal.shift)
    });
    setEditModal({ open: false, shift: null });
    // Refresh
    fetch("/api/master-shifts")
      .then((res) => res.json())
      .then((data: MasterShift[]) => setShifts(data));
  };

  return (
    <div style={{ background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.2rem" }}>Master Shift Setup</h2>
        <button style={{ background: "#38b2ac", color: "#fff", borderRadius: 8, padding: "8px 18px", fontWeight: 600, border: "none", cursor: "pointer" }} onClick={() => { setShowModal(true); setActiveTab(0); }}>Add New</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#e2e8f0" }}>
            <th style={{ padding: 8 }}>Edit</th>
            <th style={{ padding: 8 }}>Delete</th>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Shift IN</th>
            <th style={{ padding: 8 }}>Shift OUT</th>
            <th style={{ padding: 8 }}>LateDaily</th>
            <th style={{ padding: 8 }}>EarlyDaily</th>
            <th style={{ padding: 8 }}>OverTimeDaily</th>
            <th style={{ padding: 8 }}>Working Days</th>
            <th style={{ padding: 8 }}>LateSitting</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => (
            <tr key={shift.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
              <td style={{ padding: 8 }}>
                <button style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "4px 12px", border: "none", cursor: "pointer" }} onClick={() => handleEdit(shift)}>Edit</button>
              </td>
              <td style={{ padding: 8 }}>
                <button style={{ background: "#e53e3e", color: "#fff", borderRadius: 6, padding: "4px 12px", border: "none", cursor: "pointer" }} onClick={() => handleDelete(shift.id)}>Delete</button>
              </td>
              <td style={{ padding: 8 }}>{shift.name}</td>
              <td style={{ padding: 8 }}>{shift.shift_in}</td>
              <td style={{ padding: 8 }}>{shift.shift_out}</td>
              <td style={{ padding: 8 }}>{shift.late_daily}</td>
              <td style={{ padding: 8 }}>{shift.early_daily}</td>
              <td style={{ padding: 8 }}>{shift.overtime_daily}</td>
              <td style={{ padding: 8 }}>{shift.working_days}</td>
              <td style={{ padding: 8 }}>{shift.late_sitting}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Modal for Add New Shift */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, minWidth: 600, maxWidth: 600, minHeight: 420, boxShadow: "0 2px 12px #e2e8f0", position: "relative", fontSize: "0.97rem", display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.15rem", marginBottom: 16 }}>Create New Shift</h3>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
              {tabList.map((tab, idx) => (
                <button
                  key={tab}
                  style={{
                    background: activeTab === idx ? "#3182ce" : "#e2e8f0",
                    color: activeTab === idx ? "#fff" : "#222",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontWeight: 600,
                    fontSize: "0.97rem",
                    cursor: "pointer"
                  }}
                  onClick={() => setActiveTab(idx)}
                >
                  {tab}
                </button>
              ))}
            </div>
            {/* Tab Content */}
            {activeTab === 0 && (
              <form onSubmit={handleShiftSubmit}>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.97rem" }}>Shift Name</label>
                <input value={shiftName} onChange={e => setShiftName(e.target.value)} style={{ width: "100%", padding: 6, marginBottom: 14, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
                <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "0.97rem" }}>Shift IN</label>
                    <input type="time" value={shiftIn} onChange={e => setShiftIn(e.target.value)} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "0.97rem" }}>Shift OUT</label>
                    <input type="time" value={shiftOut} onChange={e => setShiftOut(e.target.value)} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.97rem" }} />
                  </div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", marginTop: 18 }}>
                    <input type="checkbox" checked={shiftOutNextDay} onChange={e => setShiftOutNextDay(e.target.checked)} style={{ marginRight: 6 }} />
                    <span style={{ fontSize: "0.97rem" }}>Shift OUT Next Day</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="submit" style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "6px 14px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} disabled={loading}>Update</button>
                  <button type="button" style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 14px", border: "none", cursor: "pointer", fontSize: "0.97rem" }} onClick={() => setShowModal(false)}>Close</button>
                  {success && <span style={{ color: "#38b2ac", fontWeight: 600, fontSize: "0.97rem" }}>Saved!</span>}
                </div>
              </form>
            )}
            {activeTab === 1 && (
              <div style={{ width: "100%" }}>
                <LateEarlyRelaxationForm shiftId={newShiftId ?? 0} onClose={() => setShowModal(false)} />
              </div>
            )}
            {activeTab === 2 && (
              <div style={{ width: "100%" }}>
                <LateSittingOvertimeForm shiftId={newShiftId ?? 0} onClose={() => setShowModal(false)} />
              </div>
            )}
            {activeTab === 3 && (
              <div style={{ width: "100%" }}>
                <WorkingDaysForm shiftId={newShiftId ?? 0} onClose={() => setShowModal(false)} />
              </div>
            )}
            {activeTab === 4 && (
              <div style={{ width: "100%" }}>
                <LeaveSettingsForm shiftId={newShiftId ?? 0} onClose={() => setShowModal(false)} />
              </div>
            )}
            {/* Other tabs will be added later */}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal.open && editModal.shift && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 32, minWidth: 480, boxShadow: "0 2px 12px #e2e8f0", position: "relative" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 18 }}>Edit Shift</h3>
            <form onSubmit={handleUpdateShift}>
              <label style={{ display: "block", marginBottom: 8 }}>Shift Name</label>
              <input value={editModal.shift.name} onChange={e => setEditModal(m => m && m.shift ? { ...m, shift: { ...m.shift, name: e.target.value } } : m)} style={{ width: "100%", padding: 8, marginBottom: 18, borderRadius: 6, border: "1px solid #e2e8f0" }} />
              <div style={{ display: "flex", gap: 18, marginBottom: 18 }}>
                <div style={{ flex: 1 }}>
                  <label>Shift IN</label>
                  <input type="time" value={editModal.shift.shift_in} onChange={e => setEditModal(m => m && m.shift ? { ...m, shift: { ...m.shift, shift_in: e.target.value } } : m)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Shift OUT</label>
                  <input type="time" value={editModal.shift.shift_out} onChange={e => setEditModal(m => m && m.shift ? { ...m, shift: { ...m.shift, shift_out: e.target.value } } : m)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button type="submit" style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer" }}>Update</button>
                <button type="button" style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer" }} onClick={() => setEditModal({ open: false, shift: null })}>Close</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
