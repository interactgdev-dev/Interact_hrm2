"use client";
import React, { useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";
import { FaFileExcel, FaSave, FaEdit, FaTimes, FaPlus } from "react-icons/fa";
import * as XLSX from 'xlsx';
import {
  dateTimeLocalToIsoInTimeZone,
  getDateStringInTimeZone,
  getDateTimeLocalInTimeZone,
  getParts,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
import { compareAttendanceRows } from "../../../lib/attendance-sort";

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function getMonthStartDateString(date: Date = new Date()) {
  const d = getDateStringInTimeZone(date, SERVER_TIMEZONE);
  return `${d.slice(0, 7)}-01`;
}

function formatDateOnly(dateValue: string | null | undefined) {
  if (!dateValue) return "";
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.exec(dateValue);
  if (dateOnlyMatch) return dateValue;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return getDateStringInTimeZone(parsed, SERVER_TIMEZONE);
}

// Helper to format duration
function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

// Helper to format late time
function formatLateTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// Helper to format datetime for datetime-local input (server timezone)
function formatDateTimeLocal(dateTimeString: string | null): string {
  if (!dateTimeString) return "";
  return getDateTimeLocalInTimeZone(dateTimeString, SERVER_TIMEZONE);
}

function toKarachiEpochMs(value: string | null | undefined) {
  if (!value) return null;
  const parts = getParts(value, SERVER_TIMEZONE);
  if (!parts) return null;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

interface AttendanceRecord {
  id?: number;
  employee_id: string;
  employee_name: string;
  pseudonym?: string;
  department_name?: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  is_late?: boolean;
  late_minutes?: number;
  isEditing?: boolean;
}

export default function ManageAttendancePage() {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchName, setSearchName] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [fromDate, setFromDate] = useState(getMonthStartDateString());
  const [toDate, setToDate] = useState(getLocalDateString()); // Default to today
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRecord, setNewRecord] = useState<Partial<AttendanceRecord>>({
    employee_id: "",
    date: getLocalDateString(),
    clock_in: null,
    clock_out: null
  });

  // Fetch all employees
  useEffect(() => {
    fetch("/api/employee-list")
      .then(res => res.json())
      .then(data => {
        if (data.success && data.employees) {
          setEmployees(data.employees || []);
        }
      })
      .catch(err => console.error("Error fetching employees:", err));
  }, []);

  // Fetch departments
  useEffect(() => {
    fetch('/api/departments')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.departments) {
          setDepartments(data.departments);
        }
      })
      .catch(err => console.error('Error fetching departments:', err));
  }, []);

  // Fetch attendance records from /api/attendance (like /time page)
  const fetchAttendance = () => {
    setLoading(true);
    let url = "/api/attendance";
    const params = new URLSearchParams();
    const effectiveFromDate = fromDate || toDate;
    if (effectiveFromDate) params.append("fromDate", effectiveFromDate);
    if (toDate) params.append("toDate", toDate);
    if (params.toString()) url += `?${params.toString()}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          let records = data.attendance || [];
          // Filter by name if search is active
          if (searchName) {
            records = records.filter((r: AttendanceRecord) =>
              r.employee_name?.toLowerCase().includes(searchName.toLowerCase())
            );
          }
          // Filter by department if selected
          if (selectedDepartment) {
            records = records.filter((r: AttendanceRecord) =>
              r.department_name === selectedDepartment
            );
          }
          // Format date to remove time portion
          records = records.map((r: AttendanceRecord) => ({
            ...r,
            date: formatDateOnly(r.clock_in || r.clock_out || r.date),
            isEditing: false
          }));
          setAttendance(records);
        } else {
          setAttendance([]);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching attendance:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAttendance();
  }, [fromDate, toDate, searchName, selectedDepartment]);

  const sortedAttendance = [...attendance].sort(compareAttendanceRows);
  
  let filteredAttendance = sortedAttendance;
  
  // Filter by search name only if actively searching
  if (searchName) {
    filteredAttendance = filteredAttendance.filter(a => a.employee_name?.toLowerCase().includes(searchName.toLowerCase()));
  }

  // Toggle edit mode
  const toggleEdit = (id: number) => {
    setAttendance(prev =>
      prev.map(a => (a.id === id ? { ...a, isEditing: !a.isEditing } : a))
    );
  };

  // Update field value
  const updateField = (id: number, field: keyof AttendanceRecord, value: any) => {
    setAttendance(prev =>
      prev.map(a => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  // Save attendance record
  const saveRecord = async (record: AttendanceRecord) => {
    try {
      const response = await fetch("/api/attendance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: record.id,
          employee_id: record.employee_id,
          employee_name: record.employee_name,
          date: record.date,
          clock_in: record.clock_in,
          clock_out: record.clock_out
        })
      });

      const data = await response.json();
      
      if (data.success) {
        alert("Attendance updated successfully!");
        toggleEdit(record.id!);
        fetchAttendance(); // Refresh to get latest data with late calculation
      } else {
        alert("Error updating attendance: " + data.error);
      }
    } catch (error) {
      console.error("Error saving attendance:", error);
      alert("Error saving attendance");
    }
  };

  // Add new attendance record
  const addNewRecord = async () => {
    if (!newRecord.employee_id || !newRecord.date) {
      alert("Please select employee and date");
      return;
    }

    try {
      const employee = employees.find(e => e.id === newRecord.employee_id);
      const employeeName = employee ? 
        `${employee.first_name} ${employee.last_name}`.trim() 
        : "";
      
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: newRecord.employee_id,
          employee_name: employeeName,
          date: newRecord.date,
          clock_in: newRecord.clock_in,
          clock_out: newRecord.clock_out
        })
      });

      const data = await response.json();
      
      if (data.success) {
        alert("Attendance added successfully!");
        setShowAddForm(false);
        setNewRecord({
          employee_id: "",
          date: getLocalDateString(),
          clock_in: null,
          clock_out: null
        });
        fetchAttendance();
      } else {
        alert("Error adding attendance: " + data.error);
      }
    } catch (error) {
      console.error("Error adding attendance:", error);
      alert("Error adding attendance");
    }
  };

  // Delete attendance record
  const deleteRecord = async (id: number) => {
    if (!confirm("Are you sure you want to delete this record?")) return;

    try {
      const response = await fetch("/api/attendance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await response.json();
      
      if (data.success) {
        alert("Attendance deleted successfully!");
        fetchAttendance();
      } else {
        alert("Error deleting attendance: " + data.error);
      }
    } catch (error) {
      console.error("Error deleting attendance:", error);
      alert("Error deleting attendance");
    }
  };

  // Download Excel
  const downloadExcel = () => {
    const data = filteredAttendance.map(a => {
      let totalHours = "";
      if (a.clock_in && a.clock_out) {
        const start = toKarachiEpochMs(a.clock_in);
        const end = toKarachiEpochMs(a.clock_out);
        if (start !== null && end !== null) {
          const totalSeconds = Math.floor((end - start) / 1000);
          totalHours = formatDuration(Math.max(0, totalSeconds));
        }
      }
      let lateText = "On Time";
      if (a.is_late) {
        lateText = `Late ${formatLateTime(a.late_minutes || 0)}`;
      }
      return {
        "Id": a.employee_id,
        "Full Name": a.employee_name,
        "P.Name": a.pseudonym || '-',
        "Department": a.department_name || '-',
        "Date": formatDateOnly(a.clock_in || a.clock_out || a.date),
        "Clock In": a.clock_in ? getTimeStringInTimeZone(a.clock_in, SERVER_TIMEZONE) : "",
        "Clock Out": a.clock_out ? getTimeStringInTimeZone(a.clock_out, SERVER_TIMEZONE) : "",
        "Total Hours": totalHours,
        "Late": lateText
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 14 }, // Employee ID
      { wch: 22 }, // Name
      { wch: 14 }, // Date
      { wch: 14 }, // Clock In
      { wch: 14 }, // Clock Out
      { wch: 16 }, // Total Hours
      { wch: 18 }  // Late
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `Attendance_${getLocalDateString()}.xlsx`);
  };

  return (
    <LayoutDashboard>
      <div style={{ padding: "20px" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ color: "#0052CC", fontWeight: 700, fontSize: "1.75rem", letterSpacing: "0.3px", margin: 0 }}>
            Manage Attendance
          </h1>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              background: "linear-gradient(135deg, #0052CC 0%, #00B8A9 100%)",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
              fontWeight: "600"
            }}
          >
            <FaPlus /> Add New Attendance
          </button>
        </div>

        {/* Add New Record Form */}
        {showAddForm && (
          <div style={{
            background: "#f8f9fa",
            padding: "20px",
            borderRadius: "8px",
            marginBottom: "20px",
            border: "1px solid #e2e8f0"
          }}>
            <h3 style={{ marginTop: 0, marginBottom: "16px", color: "#0052CC" }}>Add New Attendance Record</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", fontSize: "14px" }}>Employee</label>
                <select
                  value={newRecord.employee_id}
                  onChange={(e) => setNewRecord({ ...newRecord, employee_id: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e0",
                    fontSize: "14px"
                  }}
                >
                  <option value="">Select Employee</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name} ({emp.employee_code || emp.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", fontSize: "14px" }}>Date</label>
                <input
                  type="date"
                  value={newRecord.date}
                  onChange={(e) => setNewRecord({ ...newRecord, date: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e0",
                    fontSize: "14px"
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", fontSize: "14px" }}>Clock In</label>
                <input
                  type="datetime-local"
                  value={newRecord.clock_in ? formatDateTimeLocal(newRecord.clock_in) : ""}
                  onChange={(e) =>
                    setNewRecord({
                      ...newRecord,
                      clock_in: e.target.value
                        ? dateTimeLocalToIsoInTimeZone(e.target.value, SERVER_TIMEZONE)
                        : null,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e0",
                    fontSize: "14px"
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", fontSize: "14px" }}>Clock Out</label>
                <input
                  type="datetime-local"
                  value={newRecord.clock_out ? formatDateTimeLocal(newRecord.clock_out) : ""}
                  onChange={(e) =>
                    setNewRecord({
                      ...newRecord,
                      clock_out: e.target.value
                        ? dateTimeLocalToIsoInTimeZone(e.target.value, SERVER_TIMEZONE)
                        : null,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e0",
                    fontSize: "14px"
                  }}
                />
              </div>
            </div>
            <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
              <button
                onClick={addNewRecord}
                style={{
                  background: "linear-gradient(135deg, #27ae60 0%, #2ecc71 100%)",
                  color: "#fff",
                  border: "none",
                  padding: "10px 20px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600"
                }}
              >
                Save
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                style={{
                  background: "#e74c3c",
                  color: "#fff",
                  border: "none",
                  padding: "10px 20px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className={styles.attendanceSummaryFilters}>
          <input
            type="text"
            placeholder="Search employee name..."
            value={searchName}
            onChange={e => setSearchName(e.target.value)}
            className={styles.attendanceSummaryInput}
            style={{ width: 220 }}
          />
          <select
            value={selectedDepartment}
            onChange={e => setSelectedDepartment(e.target.value)}
            className={styles.attendanceSummaryDate}
            style={{ width: 180 }}
          >
            <option value="">All Departments</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.name}>{dept.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            placeholder="From Date"
            className={styles.attendanceSummaryDate}
          />
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            placeholder="To Date"
            className={styles.attendanceSummaryDate}
          />
          <button onClick={downloadExcel} className={styles.attendanceSummaryXLSButton} title="Download Excel">
            <FaFileExcel size={20} />
            <span>Export Excel</span>
          </button>
        </div>

        {/* Table */}
        <div className={`${styles.attendanceSummaryTableWrapper} ${styles.manageAttendanceTableWrapper}`} style={{ width: "980px", overflowX: "auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", fontSize: "16px", color: "#718096" }}>
              Loading...
            </div>
          ) : (
            <table className={`${styles.attendanceSummaryTable} ${styles.manageAttendanceStickyTable}`}>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Full Name</th>
                  <th>P.Name</th>
                  <th>Department</th>
                  <th>Date</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Total Hours</th>
                  <th>Late</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttendance.length === 0 ? (
                  <tr>
                    <td colSpan={10} className={styles.attendanceSummaryNoRecords}>
                      No records found.
                    </td>
                  </tr>
                ) : (
                  filteredAttendance.map((a) => (
                    <tr key={a.id}>
                      <td>{a.employee_id}</td>
                      <td>
                        {a.isEditing ? (
                          <input
                            type="text"
                            value={a.employee_name}
                            onChange={(e) => updateField(a.id!, "employee_name", e.target.value)}
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          a.employee_name
                        )}
                      </td>
                      <td>{a.pseudonym || '-'}</td>
                      <td>{a.department_name || '-'}</td>
                      <td>
                        {a.isEditing ? (
                          <input
                            type="date"
                            value={a.date ? getDateStringInTimeZone(a.date, SERVER_TIMEZONE) : ""}
                            onChange={(e) => updateField(a.id!, "date", e.target.value)}
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          a.date || ""
                        )}
                      </td>
                      <td>
                        {a.isEditing ? (
                          <input
                            type="datetime-local"
                            value={formatDateTimeLocal(a.clock_in)}
                            onChange={(e) =>
                              updateField(
                                a.id!,
                                "clock_in",
                                e.target.value
                                  ? dateTimeLocalToIsoInTimeZone(e.target.value, SERVER_TIMEZONE)
                                  : null
                              )
                            }
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          a.clock_in ? getTimeStringInTimeZone(a.clock_in, SERVER_TIMEZONE) : ""
                        )}
                      </td>
                      <td>
                        {a.isEditing ? (
                          <input
                            type="datetime-local"
                            value={formatDateTimeLocal(a.clock_out)}
                            onChange={(e) =>
                              updateField(
                                a.id!,
                                "clock_out",
                                e.target.value
                                  ? dateTimeLocalToIsoInTimeZone(e.target.value, SERVER_TIMEZONE)
                                  : null
                              )
                            }
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          a.clock_out ? getTimeStringInTimeZone(a.clock_out, SERVER_TIMEZONE) : ""
                        )}
                      </td>
                      <td>
                        {a.clock_in && a.clock_out ? 
                          (() => {
                            const start = toKarachiEpochMs(a.clock_in);
                            const end = toKarachiEpochMs(a.clock_out);
                            if (start === null || end === null) return "";
                            const totalSeconds = Math.floor((end - start) / 1000);
                            return formatDuration(Math.max(0, totalSeconds));
                          })() : ""
                        }
                      </td>
                      <td style={{ color: a.is_late ? "#e74c3c" : "#27ae60", fontWeight: "600" }}>
                        {a.is_late ? `Late ${formatLateTime(a.late_minutes || 0)}` : "On Time"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                          {a.isEditing ? (
                            <>
                              <button
                                onClick={() => saveRecord(a)}
                                style={{
                                  background: "#27ae60",
                                  color: "#fff",
                                  border: "none",
                                  padding: "6px 12px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px"
                                }}
                                title="Save"
                              >
                                <FaSave /> Save
                              </button>
                              <button
                                onClick={() => toggleEdit(a.id!)}
                                style={{
                                  background: "#95a5a6",
                                  color: "#fff",
                                  border: "none",
                                  padding: "6px 12px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  fontSize: "12px"
                                }}
                                title="Cancel"
                              >
                                <FaTimes />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => toggleEdit(a.id!)}
                                style={{
                                  background: "#3498db",
                                  color: "#fff",
                                  border: "none",
                                  padding: "6px 12px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px"
                                }}
                                title="Edit"
                              >
                                <FaEdit /> Edit
                              </button>
                              <button
                                onClick={() => deleteRecord(a.id!)}
                                style={{
                                  background: "#e74c3c",
                                  color: "#fff",
                                  border: "none",
                                  padding: "6px 12px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  fontSize: "12px"
                                }}
                                title="Delete"
                              >
                                <FaTimes />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: "20px", fontSize: "14px", color: "#718096" }}>
          Total Records: {filteredAttendance.length}
        </div>
      </div>
    </LayoutDashboard>
  );
}
