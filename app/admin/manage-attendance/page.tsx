"use client";
import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../break-summary/break-summary.module.css";
import adminStyles from "../admin-page.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
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
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
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
  const deferredSearchName = useDeferredValue(searchName);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  /** Default: current day only — expand range when user picks dates */
  const today = getLocalDateString();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRecord, setNewRecord] = useState<Partial<AttendanceRecord>>({
    employee_id: "",
    date: today,
    clock_in: null,
    clock_out: null
  });
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

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

  // Fetch attendance for selected date range only (not on every search keystroke)
  const fetchAttendance = () => {
    setLoading(true);
    let url = "/api/attendance";
    const params = new URLSearchParams();
    const effectiveFromDate = fromDate || toDate || today;
    const effectiveToDate = toDate || fromDate || today;
    params.append("fromDate", effectiveFromDate);
    params.append("toDate", effectiveToDate);
    url += `?${params.toString()}`;
    fetch(url, { cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const records = (data.attendance || []).map((r: AttendanceRecord) => ({
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
  }, [fromDate, toDate]);

  const filteredAttendance = useMemo(() => {
    let rows = [...attendance].sort(compareAttendanceRows);
    if (selectedDepartment) {
      rows = rows.filter((a) => a.department_name === selectedDepartment);
    }
    const term = deferredSearchName.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (a) =>
          a.employee_name?.toLowerCase().includes(term) ||
          String(a.employee_id || "").includes(term) ||
          (a.pseudonym || "").toLowerCase().includes(term)
      );
    }
    return rows;
  }, [attendance, deferredSearchName, selectedDepartment]);

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
        toastSuccess("Attendance updated successfully!");
        toggleEdit(record.id!);
        fetchAttendance(); // Refresh to get latest data with late calculation
      } else {
        toastError("Error updating attendance: " + data.error);
      }
    } catch (error) {
      console.error("Error saving attendance:", error);
      toastError("Error saving attendance");
    }
  };

  // Add new attendance record
  const addNewRecord = async () => {
    if (!newRecord.employee_id || !newRecord.date) {
      toastInfo("Please select employee and date");
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
        toastSuccess("Attendance added successfully!");
        setShowAddForm(false);
        setNewRecord({
          employee_id: "",
          date: getLocalDateString(),
          clock_in: null,
          clock_out: null
        });
        fetchAttendance();
      } else {
        toastError("Error adding attendance: " + data.error);
      }
    } catch (error) {
      console.error("Error adding attendance:", error);
      toastError("Error adding attendance");
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
        toastSuccess("Attendance deleted successfully!");
        fetchAttendance();
      } else {
        toastError("Error deleting attendance: " + data.error);
      }
    } catch (error) {
      console.error("Error deleting attendance:", error);
      toastError("Error deleting attendance");
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
      <div className={adminStyles.page}>
        <div className={styles.breakSummaryContainer}>
        <div className={adminStyles.pageHeader}>
          <h1 className={adminStyles.pageHeaderTitle}>Manage Attendance</h1>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className={adminStyles.btnGreen}
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
        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name or pseudo name..."
            value={searchName}
            onChange={e => setSearchName(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 220 }}
          />
          <select
            value={selectedDepartment}
            onChange={e => setSelectedDepartment(e.target.value)}
            className={styles.breakSummaryDate}
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
            className={styles.breakSummaryDate}
          />
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            placeholder="To Date"
            className={styles.breakSummaryDate}
          />
          <button onClick={downloadExcel} className={styles.breakSummaryXLSButton} title="Download Excel">
            <FaFileExcel size={20} />
            <span>Export Excel</span>
          </button>
        </div>

        {/* Table */}
        <div className={styles.breakSummaryTableWrapper}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", fontSize: "16px", color: "#718096" }}>
              Loading...
            </div>
          ) : (
            <table className={styles.breakSummaryTable}>
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
                    <td colSpan={10} className={styles.breakSummaryNoRecords}>
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
                          <EmployeeTableNameCell
                            name={a.employee_name}
                            employeeId={a.employee_id}
                            photo={getPhoto(a.employee_id)}
                            onOpen={() => openFromRow(a)}
                          />
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
      </div>
      {popup}
    </LayoutDashboard>
  );
}
