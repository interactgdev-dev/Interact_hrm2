"use client";
import React, { useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";
import { FaFileExcel, FaSave, FaEdit, FaTimes, FaPlus } from "react-icons/fa";
import * as XLSX from 'xlsx';
import {
  getDateTimeLocalInTimeZone,
  getTimeStringInTimeZone,
  getDateStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";

// Helper to format duration
function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

// Helper to format datetime for datetime-local input using server timezone
function formatDateTimeLocal(dateTimeString: string | null): string {
  if (!dateTimeString) return "";
  return getDateTimeLocalInTimeZone(dateTimeString, SERVER_TIMEZONE);
}

interface BreakRecord {
  id?: number;
  employee_id: string;
  employee_name: string;
  pseudonym?: string;
  department_name?: string;
  date: string;
  break_type: 'break' | 'prayer';
  break_start: string | null;
  break_end: string | null;
  break_duration: number | null;
  isEditing?: boolean;
}

export default function ManageBreaksPage() {
  const [breaks, setBreaks] = useState<BreakRecord[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchName, setSearchName] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedBreakType, setSelectedBreakType] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]); // Default to today
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRecord, setNewRecord] = useState<Partial<BreakRecord>>({
    employee_id: "",
    date: new Date().toISOString().split('T')[0],
    break_type: 'break',
    break_start: null,
    break_end: null
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

  // Fetch break records
  const fetchBreaks = async () => {
    setLoading(true);
    try {
      // Fetch regular breaks
      let breaksUrl = "/api/breaks";
      const breaksRes = await fetch(breaksUrl);
      const breaksData = await breaksRes.json();
      
      // Fetch prayer breaks
      let prayerBreaksUrl = "/api/prayer_breaks";
      const prayerBreaksRes = await fetch(prayerBreaksUrl);
      const prayerBreaksData = await prayerBreaksRes.json();

      // Fetch employee list to enrich with pseudonym and department
      const empListRes = await fetch("/api/employee-list");
      const empListData = await empListRes.json();
      const empMap = new Map();
      if (empListData.success) {
        empListData.employees.forEach((emp: any) => {
          empMap.set(emp.id.toString(), {
            pseudonym: emp.pseudonym || '-',
            department_name: emp.department_name || '-'
          });
        });
      }

      // Process regular breaks
      let regularBreaks: BreakRecord[] = [];
      if (breaksData.success && breaksData.breaks) {
        regularBreaks = breaksData.breaks.map((b: any) => {
          const empData = empMap.get(b.employee_id.toString());
          return {
            id: b.id,
            employee_id: b.employee_id.toString(),
            employee_name: b.employee_name || "",
            pseudonym: empData?.pseudonym || b.pseudonym || '-',
            department_name: empData?.department_name || b.department_name || '-',
            date: b.date || (b.break_start ? new Date(b.break_start).toISOString().split('T')[0] : ""),
            break_type: 'break' as const,
            break_start: b.break_start,
            break_end: b.break_end,
            break_duration: b.break_duration,
            isEditing: false
          };
        });
      }

      // Process prayer breaks
      let prayerBreaks: BreakRecord[] = [];
      if (prayerBreaksData.success && prayerBreaksData.prayer_breaks) {
        prayerBreaks = prayerBreaksData.prayer_breaks.map((pb: any) => {
          const empData = empMap.get(pb.employee_id.toString());
          return {
            id: pb.id,
            employee_id: pb.employee_id.toString(),
            employee_name: pb.employee_name || "",
            pseudonym: empData?.pseudonym || pb.pseudonym || '-',
            department_name: empData?.department_name || pb.department_name || '-',
            date: pb.date || (pb.prayer_break_start ? new Date(pb.prayer_break_start).toISOString().split('T')[0] : ""),
            break_type: 'prayer' as const,
            break_start: pb.prayer_break_start,
            break_end: pb.prayer_break_end,
            break_duration: pb.prayer_break_duration,
            isEditing: false
          };
        });
      }

      // Combine both break types
      let allBreaks = [...regularBreaks, ...prayerBreaks];

      // Apply filters
      if (fromDate && toDate) {
        allBreaks = allBreaks.filter(b => {
          const breakDate = b.date;
          return breakDate >= fromDate && breakDate <= toDate;
        });
      }

      if (searchName) {
        allBreaks = allBreaks.filter(b =>
          b.employee_name?.toLowerCase().includes(searchName.toLowerCase())
        );
      }

      if (selectedDepartment) {
        allBreaks = allBreaks.filter(b =>
          b.department_name === selectedDepartment
        );
      }

      if (selectedBreakType) {
        allBreaks = allBreaks.filter(b => b.break_type === selectedBreakType);
      }

      // Sort by latest start time
      allBreaks.sort((a, b) => {
        const aTime = new Date(a.break_start || a.date).getTime();
        const bTime = new Date(b.break_start || b.date).getTime();
        return bTime - aTime;
      });

      setBreaks(allBreaks);
    } catch (error) {
      console.error("Error fetching breaks:", error);
      setBreaks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBreaks();
  }, [fromDate, toDate, searchName, selectedDepartment, selectedBreakType]);

  // Toggle edit mode
  const toggleEdit = (id: number) => {
    setBreaks(prev =>
      prev.map(b => (b.id === id ? { ...b, isEditing: !b.isEditing } : b))
    );
  };

  // Update field value
  const updateField = (id: number, field: keyof BreakRecord, value: any) => {
    setBreaks(prev =>
      prev.map(b => (b.id === id ? { ...b, [field]: value } : b))
    );
  };

  // Save break record
  const saveRecord = async (record: BreakRecord) => {
    try {
      const endpoint = record.break_type === 'break' ? "/api/breaks" : "/api/prayer_breaks";
      const bodyData: any = {
        id: record.id,
        employee_id: record.employee_id,
        employee_name: record.employee_name,
        date: record.date
      };

      if (record.break_type === 'break') {
        bodyData.break_start = record.break_start;
        bodyData.break_end = record.break_end;
      } else {
        bodyData.prayer_break_start = record.break_start;
        bodyData.prayer_break_end = record.break_end;
      }

      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData)
      });

      const data = await response.json();
      
      if (data.success) {
        alert(`${record.break_type === 'break' ? 'Break' : 'Prayer Break'} updated successfully!`);
        toggleEdit(record.id!);
        fetchBreaks(); // Refresh to get latest data
      } else {
        alert("Error updating break: " + data.error);
      }
    } catch (error) {
      console.error("Error saving break:", error);
      alert("Error saving break");
    }
  };

  // Add new break record
  const addNewRecord = async () => {
    if (!newRecord.employee_id || !newRecord.date) {
      alert("Please select employee and date");
      return;
    }

    try {
      const employee = employees.find(e => e.id === Number(newRecord.employee_id));
      const employeeName = employee ? 
        `${employee.first_name} ${employee.last_name}`.trim() 
        : "";
      
      const endpoint = newRecord.break_type === 'break' ? "/api/breaks" : "/api/prayer_breaks";
      const bodyData: any = {
        employee_id: newRecord.employee_id,
        employee_name: employeeName,
        date: newRecord.date
      };

      if (newRecord.break_type === 'break') {
        bodyData.break_start = newRecord.break_start;
        bodyData.break_end = newRecord.break_end;
      } else {
        bodyData.prayer_break_start = newRecord.break_start;
        bodyData.prayer_break_end = newRecord.break_end;
      }
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData)
      });

      const data = await response.json();
      
      if (data.success) {
        alert(`${newRecord.break_type === 'break' ? 'Break' : 'Prayer Break'} added successfully!`);
        setShowAddForm(false);
        setNewRecord({
          employee_id: "",
          date: new Date().toISOString().split('T')[0],
          break_type: 'break',
          break_start: null,
          break_end: null
        });
        fetchBreaks();
      } else {
        alert("Error adding break: " + data.error);
      }
    } catch (error) {
      console.error("Error adding break:", error);
      alert("Error adding break");
    }
  };

  // Delete break record
  const deleteRecord = async (record: BreakRecord) => {
    if (!confirm(`Are you sure you want to delete this ${record.break_type === 'break' ? 'break' : 'prayer break'} record?`)) return;

    try {
      const endpoint = record.break_type === 'break' ? "/api/breaks" : "/api/prayer_breaks";
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id })
      });

      const data = await response.json();
      
      if (data.success) {
        alert(`${record.break_type === 'break' ? 'Break' : 'Prayer Break'} deleted successfully!`);
        fetchBreaks();
      } else {
        alert("Error deleting break: " + data.error);
      }
    } catch (error) {
      console.error("Error deleting break:", error);
      alert("Error deleting break");
    }
  };

  // Download Excel
  const downloadExcel = () => {
    const data = breaks.map(b => {
      let duration = "";
      if (b.break_duration) {
        duration = formatDuration(b.break_duration);
      } else if (b.break_start && b.break_end) {
        const start = new Date(b.break_start).getTime();
        const end = new Date(b.break_end).getTime();
        const totalSeconds = Math.floor((end - start) / 1000);
        duration = formatDuration(totalSeconds);
      }
      
      return {
        "Id": b.employee_id,
        "Full Name": b.employee_name,
        "P.Name": b.pseudonym || '-',
        "Department": b.department_name || '-',
        "Type": b.break_type === 'break' ? 'Break' : 'Prayer Break',
        "Date": b.date ? new Date(b.date).toLocaleDateString() : "",
        "Start Time": b.break_start ? new Date(b.break_start).toLocaleString() : "",
        "End Time": b.break_end ? new Date(b.break_end).toLocaleString() : "",
        "Duration": duration
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 10 }, // ID
      { wch: 22 }, // Name
      { wch: 14 }, // P.Name
      { wch: 18 }, // Department
      { wch: 14 }, // Type
      { wch: 14 }, // Date
      { wch: 20 }, // Start
      { wch: 20 }, // End
      { wch: 14 }  // Duration
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Breaks");
    XLSX.writeFile(wb, `Breaks_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <LayoutDashboard>
      <div style={{ padding: "20px" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ color: "#0052CC", fontWeight: 700, fontSize: "1.75rem", letterSpacing: "0.3px", margin: 0 }}>
            Manage Breaks
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
            <FaPlus /> Add New Break
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
            <h3 style={{ marginTop: 0, marginBottom: "16px", color: "#0052CC" }}>Add New Break Record</h3>
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
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", fontSize: "14px" }}>Break Type</label>
                <select
                  value={newRecord.break_type}
                  onChange={(e) => setNewRecord({ ...newRecord, break_type: e.target.value as 'break' | 'prayer' })}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e0",
                    fontSize: "14px"
                  }}
                >
                  <option value="break">Regular Break</option>
                  <option value="prayer">Prayer Break</option>
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
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", fontSize: "14px" }}>Start Time</label>
                <input
                  type="datetime-local"
                  value={newRecord.break_start ? formatDateTimeLocal(newRecord.break_start) : ""}
                  onChange={(e) => setNewRecord({ ...newRecord, break_start: e.target.value ? new Date(e.target.value).toISOString() : null })}
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
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", fontSize: "14px" }}>End Time</label>
                <input
                  type="datetime-local"
                  value={newRecord.break_end ? formatDateTimeLocal(newRecord.break_end) : ""}
                  onChange={(e) => setNewRecord({ ...newRecord, break_end: e.target.value ? new Date(e.target.value).toISOString() : null })}
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
          <select
            value={selectedBreakType}
            onChange={e => setSelectedBreakType(e.target.value)}
            className={styles.attendanceSummaryDate}
            style={{ width: 150 }}
          >
            <option value="">All Break Types</option>
            <option value="break">Regular Break</option>
            <option value="prayer">Prayer Break</option>
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
        <div className={`${styles.attendanceSummaryTableWrapper} ${styles.manageBreaksTableWrapper}`}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", fontSize: "16px", color: "#718096" }}>
              Loading...
            </div>
          ) : (
            <table className={`${styles.attendanceSummaryTable} ${styles.manageBreaksStickyTable}`}>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Full Name</th>
                  <th>P.Name</th>
                  <th>Department</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Start Time</th>
                  <th>End Time</th>
                  <th>Duration</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {breaks.length === 0 ? (
                  <tr>
                    <td colSpan={10} className={styles.attendanceSummaryNoRecords}>
                      No records found.
                    </td>
                  </tr>
                ) : (
                  breaks.map((b) => (
                    <tr key={`${b.break_type}-${b.id}`}>
                      <td>{b.employee_id}</td>
                      <td>
                        {b.isEditing ? (
                          <input
                            type="text"
                            value={b.employee_name}
                            onChange={(e) => updateField(b.id!, "employee_name", e.target.value)}
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          b.employee_name
                        )}
                      </td>
                      <td>{b.pseudonym || '-'}</td>
                      <td>{b.department_name || '-'}</td>
                      <td>
                        <span style={{
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: "600",
                          background: b.break_type === 'break' ? '#e3f2fd' : '#f3e5f5',
                          color: b.break_type === 'break' ? '#1976d2' : '#7b1fa2'
                        }}>
                          {b.break_type === 'break' ? 'Break' : 'Prayer'}
                        </span>
                      </td>
                      <td>
                        {b.isEditing ? (
                          <input
                            type="date"
                            value={b.date ? new Date(b.date).toISOString().split('T')[0] : ""}
                            onChange={(e) => updateField(b.id!, "date", e.target.value)}
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          b.date ? getDateStringInTimeZone(b.date, SERVER_TIMEZONE) : ""
                        )}
                      </td>
                      <td>
                        {b.isEditing ? (
                          <input
                            type="datetime-local"
                            value={formatDateTimeLocal(b.break_start)}
                            onChange={(e) => updateField(b.id!, "break_start", e.target.value ? new Date(e.target.value).toISOString() : null)}
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          b.break_start ? getTimeStringInTimeZone(b.break_start, SERVER_TIMEZONE) : ""
                        )}
                      </td>
                      <td>
                        {b.isEditing ? (
                          <input
                            type="datetime-local"
                            value={formatDateTimeLocal(b.break_end)}
                            onChange={(e) => updateField(b.id!, "break_end", e.target.value ? new Date(e.target.value).toISOString() : null)}
                            style={{ width: "100%", padding: "4px", fontSize: "13px" }}
                          />
                        ) : (
                          b.break_end ? getTimeStringInTimeZone(b.break_end, SERVER_TIMEZONE) : ""
                        )}
                      </td>
                      <td>
                        {b.break_duration ? formatDuration(b.break_duration) :
                          (b.break_start && b.break_end ? 
                            (() => {
                              const start = new Date(b.break_start).getTime();
                              const end = new Date(b.break_end).getTime();
                              const totalSeconds = Math.floor((end - start) / 1000);
                              return formatDuration(totalSeconds);
                            })() : ""
                          )
                        }
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                          {b.isEditing ? (
                            <>
                              <button
                                onClick={() => saveRecord(b)}
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
                                onClick={() => toggleEdit(b.id!)}
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
                                onClick={() => toggleEdit(b.id!)}
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
                                onClick={() => deleteRecord(b)}
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
          Total Records: {breaks.length}
        </div>
      </div>
    </LayoutDashboard>
  );
}

