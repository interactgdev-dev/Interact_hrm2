"use client";
import React, { useEffect, useMemo, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import adminStyles from "../admin-page.module.css";
import tableStyles from "../../break-summary/break-summary.module.css";
import leaveStyles from "../../leave/leave.module.css";
import shiftStyles from "./shift-scheduler.module.css";
import { FaClock, FaPlus, FaTrash, FaEdit, FaSave, FaTimes } from "react-icons/fa";

interface Shift {
  id: number;
  name: string;
  shift_in: string;
  shift_out: string;
  overtime_daily: number;
  working_days: string;
}

const formatTimeTo12Hour = (time: string): string => {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

export default function ShiftSchedulerPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [newShift, setNewShift] = useState({
    shift_name: "",
    clock_in_time: "",
    clock_out_time: "",
    overtime: false,
    work_days: "Mon-Fri",
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editShift, setEditShift] = useState({
    shift_name: "",
    clock_in_time: "",
    clock_out_time: "",
    overtime: false,
    work_days: "",
  });

  useEffect(() => {
    fetchShifts();
  }, []);

  const fetchShifts = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/master-shifts");
      const data = await res.json();
      if (data.success) {
        setShifts(data.shifts || []);
      } else {
        setError(data.error || "Failed to fetch shifts");
      }
    } catch {
      setError("Failed to fetch shifts");
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalHours = (clockIn: string, clockOut: string): number => {
    if (!clockIn || !clockOut) return 0;
    const [inHour, inMin] = clockIn.split(":").map(Number);
    const [outHour, outMin] = clockOut.split(":").map(Number);
    const inMinutes = inHour * 60 + inMin;
    const outMinutes = outHour * 60 + outMin;
    let diff = outMinutes - inMinutes;
    if (diff < 0) diff += 24 * 60;
    return Math.round((diff / 60) * 10) / 10;
  };

  const sortedShifts = useMemo(
    () =>
      [...shifts].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [shifts],
  );

  const handleCreateShift = async () => {
    if (!newShift.shift_name || !newShift.clock_in_time || !newShift.clock_out_time) {
      setError("Please fill all required fields");
      return;
    }

    const totalHours = calculateTotalHours(newShift.clock_in_time, newShift.clock_out_time);

    try {
      const res = await fetch("/api/master-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newShift,
          total_hours: totalHours,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Shift created successfully!");
        setNewShift({
          shift_name: "",
          clock_in_time: "",
          clock_out_time: "",
          overtime: false,
          work_days: "Mon-Fri",
        });
        fetchShifts();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.error || "Failed to create shift");
      }
    } catch {
      setError("Failed to create shift");
    }
  };

  const handleEdit = (shift: Shift) => {
    setEditingId(shift.id);
    setEditShift({
      shift_name: shift.name,
      clock_in_time: shift.shift_in,
      clock_out_time: shift.shift_out,
      overtime: !!shift.overtime_daily,
      work_days: shift.working_days,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    const totalHours = calculateTotalHours(editShift.clock_in_time, editShift.clock_out_time);

    try {
      const res = await fetch("/api/master-shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          ...editShift,
          total_hours: totalHours,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Shift updated successfully!");
        setEditingId(null);
        fetchShifts();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.error || "Failed to update shift");
      }
    } catch {
      setError("Failed to update shift");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this shift?")) return;

    try {
      const res = await fetch(`/api/master-shifts?id=${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Shift deleted successfully!");
        fetchShifts();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.error || "Failed to delete shift");
      }
    } catch {
      setError("Failed to delete shift");
    }
  };

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={tableStyles.breakSummaryContainer}>
          <div className={adminStyles.pageHeader}>
            <div>
              <h1 className={adminStyles.pageHeaderTitle}>
                <FaClock style={{ marginRight: 10, color: "#0f766e", verticalAlign: "middle" }} />
                Shift Scheduler
              </h1>
              <p className={tableStyles.mgmtAttMeta} style={{ marginTop: 4 }}>
                Create and manage predefined shift schedules
              </p>
            </div>
          </div>

          {error ? <p className={adminStyles.alertError}>{error}</p> : null}
          {success ? <p className={adminStyles.alertSuccess}>{success}</p> : null}

          <div className={adminStyles.card}>
            <h2 className={adminStyles.cardTitle}>Create New Shift</h2>
            <div className={adminStyles.formGrid}>
              <div className={adminStyles.field}>
                <label>Shift Name *</label>
                <input
                  type="text"
                  className={adminStyles.input}
                  placeholder="e.g., Morning, Afternoon, Night"
                  value={newShift.shift_name}
                  onChange={(e) => setNewShift({ ...newShift, shift_name: e.target.value })}
                />
              </div>
              <div className={adminStyles.field}>
                <label>Clock IN Time *</label>
                <input
                  type="time"
                  className={adminStyles.input}
                  value={newShift.clock_in_time}
                  onChange={(e) => setNewShift({ ...newShift, clock_in_time: e.target.value })}
                />
              </div>
              <div className={adminStyles.field}>
                <label>Clock OUT Time *</label>
                <input
                  type="time"
                  className={adminStyles.input}
                  value={newShift.clock_out_time}
                  onChange={(e) => setNewShift({ ...newShift, clock_out_time: e.target.value })}
                />
              </div>
              <div className={adminStyles.field}>
                <label>Work Days</label>
                <input
                  type="text"
                  className={adminStyles.input}
                  placeholder="e.g., Mon-Fri, Mon-Sat"
                  value={newShift.work_days}
                  onChange={(e) => setNewShift({ ...newShift, work_days: e.target.value })}
                />
              </div>
              <div className={adminStyles.field}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newShift.overtime}
                    onChange={(e) => setNewShift({ ...newShift, overtime: e.target.checked })}
                  />
                  Overtime Applicable
                </label>
              </div>
            </div>
            <button
              type="button"
              className={adminStyles.btnGreen}
              onClick={handleCreateShift}
              style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <FaPlus /> Create Shift
            </button>
          </div>

          <h2 className={tableStyles.pageTitle} style={{ marginTop: 8 }}>
            Predefined Shifts
          </h2>

          <div className={leaveStyles.reqTableShell}>
            <div className={tableStyles.mgmtAttScroll}>
              {loading ? (
                <div className={leaveStyles.loading}>Loading shifts…</div>
              ) : shifts.length === 0 ? (
                <div className={leaveStyles.reqEmpty}>
                  No shifts created yet. Create your first shift above.
                </div>
              ) : (
                <table className={`${leaveStyles.reqTable} ${tableStyles.shiftSchedTableFit}`}>
                  <thead>
                    <tr>
                      <th>Shift Name</th>
                      <th>Clock IN</th>
                      <th>Clock OUT</th>
                      <th>Total Hours</th>
                      <th>Overtime</th>
                      <th>Work Days</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedShifts.map((shift) => (
                      <tr key={shift.id}>
                        {editingId === shift.id ? (
                          <>
                            <td>
                              <input
                                type="text"
                                className={leaveStyles.toolbarSelect}
                                value={editShift.shift_name}
                                onChange={(e) =>
                                  setEditShift({ ...editShift, shift_name: e.target.value })
                                }
                                style={{ width: "100%" }}
                              />
                            </td>
                            <td>
                              <input
                                type="time"
                                className={leaveStyles.toolbarSelect}
                                value={editShift.clock_in_time}
                                onChange={(e) =>
                                  setEditShift({ ...editShift, clock_in_time: e.target.value })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="time"
                                className={leaveStyles.toolbarSelect}
                                value={editShift.clock_out_time}
                                onChange={(e) =>
                                  setEditShift({ ...editShift, clock_out_time: e.target.value })
                                }
                              />
                            </td>
                            <td>
                              {calculateTotalHours(
                                editShift.clock_in_time,
                                editShift.clock_out_time,
                              )}
                              h
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={editShift.overtime}
                                onChange={(e) =>
                                  setEditShift({ ...editShift, overtime: e.target.checked })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className={leaveStyles.toolbarSelect}
                                value={editShift.work_days}
                                onChange={(e) =>
                                  setEditShift({ ...editShift, work_days: e.target.value })
                                }
                                style={{ width: "100%" }}
                              />
                            </td>
                            <td>
                              <div className={shiftStyles.actions}>
                                <button
                                  type="button"
                                  className={shiftStyles.saveButton}
                                  onClick={handleSaveEdit}
                                >
                                  <FaSave />
                                </button>
                                <button
                                  type="button"
                                  className={shiftStyles.cancelButton}
                                  onClick={() => setEditingId(null)}
                                >
                                  <FaTimes />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ fontWeight: 700, color: "#0f766e" }}>{shift.name}</td>
                            <td>{formatTimeTo12Hour(shift.shift_in)}</td>
                            <td>{formatTimeTo12Hour(shift.shift_out)}</td>
                            <td>{calculateTotalHours(shift.shift_in, shift.shift_out)}h</td>
                            <td>
                              <span
                                className={
                                  shift.overtime_daily ? shiftStyles.yes : shiftStyles.no
                                }
                              >
                                {shift.overtime_daily ? "Yes" : "No"}
                              </span>
                            </td>
                            <td>{shift.working_days}</td>
                            <td>
                              <div className={shiftStyles.actions}>
                                <button
                                  type="button"
                                  className={shiftStyles.editButton}
                                  onClick={() => handleEdit(shift)}
                                >
                                  <FaEdit />
                                </button>
                                <button
                                  type="button"
                                  className={shiftStyles.deleteButton}
                                  onClick={() => handleDelete(shift.id)}
                                >
                                  <FaTrash />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </OptionalAdminShell>
  );
}
