"use client";
import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import leaveStyles from "../../leave/leave.module.css";
import adminStyles from "../admin-page.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { FaFileExcel, FaSave, FaEdit, FaTimes, FaPlus } from "react-icons/fa";
import * as XLSX from 'xlsx';
import {
  getDateTimeLocalInTimeZone,
  getTimeStringInTimeZone,
  getDateStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
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

// Helper to format duration (whole seconds — matches summary pages: 00h 18m 57s)
function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600).toString().padStart(2, "0");
  const m = Math.floor((total % 3600) / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
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
  const [allBreaks, setAllBreaks] = useState<BreakRecord[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchName, setSearchName] = useState("");
  const deferredSearchName = useDeferredValue(searchName);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedBreakType, setSelectedBreakType] = useState<string>("");
  /** Default: current day only — expand range when user picks dates */
  const today = getLocalDateString();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRecord, setNewRecord] = useState<Partial<BreakRecord>>({
    employee_id: "",
    date: today,
    break_type: 'break',
    break_start: null,
    break_end: null
  });
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  // Fetch all employees once
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

  // Fetch break records for selected date range only (API-filtered)
  const fetchBreaks = async () => {
    setLoading(true);
    try {
      const effectiveFromDate = fromDate || toDate || today;
      const effectiveToDate = toDate || fromDate || today;
      const params = new URLSearchParams({
        fromDate: effectiveFromDate,
        toDate: effectiveToDate,
      });
      const qs = `?${params.toString()}`;

      const [breaksRes, prayerBreaksRes] = await Promise.all([
        fetch(`/api/breaks${qs}`, { cache: "no-store" }),
        fetch(`/api/prayer_breaks${qs}`, { cache: "no-store" }),
      ]);
      const [breaksData, prayerBreaksData] = await Promise.all([
        breaksRes.json(),
        prayerBreaksRes.json(),
      ]);

      let regularBreaks: BreakRecord[] = [];
      if (breaksData.success && breaksData.breaks) {
        regularBreaks = breaksData.breaks.map((b: any) => ({
          id: b.id,
          employee_id: String(b.employee_id),
          employee_name: b.employee_name || "",
          pseudonym: b.pseudonym || '-',
          department_name: b.department_name || '-',
          date: formatDateOnly(b.date || b.break_start),
          break_type: 'break' as const,
          break_start: b.break_start,
          break_end: b.break_end,
          break_duration: b.break_duration,
          isEditing: false
        }));
      }

      let prayerBreaks: BreakRecord[] = [];
      if (prayerBreaksData.success && prayerBreaksData.prayer_breaks) {
        prayerBreaks = prayerBreaksData.prayer_breaks.map((pb: any) => ({
          id: pb.id,
          employee_id: String(pb.employee_id),
          employee_name: pb.employee_name || "",
          pseudonym: pb.pseudonym || '-',
          department_name: pb.department_name || '-',
          date: formatDateOnly(pb.date || pb.prayer_break_start),
          break_type: 'prayer' as const,
          break_start: pb.prayer_break_start,
          break_end: pb.prayer_break_end,
          break_duration: pb.prayer_break_duration,
          isEditing: false
        }));
      }

      const combined = [...regularBreaks, ...prayerBreaks].sort((a, b) => {
        const aTime = new Date(a.break_start || a.date).getTime();
        const bTime = new Date(b.break_start || b.date).getTime();
        return bTime - aTime;
      });

      setAllBreaks(combined);
    } catch (error) {
      console.error("Error fetching breaks:", error);
      setAllBreaks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBreaks();
  }, [fromDate, toDate]);

  const breaks = useMemo(() => {
    const empMap = new Map<string, { pseudonym: string; department_name: string }>();
    employees.forEach((emp: any) => {
      empMap.set(String(emp.id), {
        pseudonym: emp.pseudonym || '-',
        department_name: emp.department_name || '-',
      });
    });

    let rows = allBreaks.map((b) => {
      const emp = empMap.get(b.employee_id);
      if (!emp) return b;
      return {
        ...b,
        pseudonym: emp.pseudonym !== '-' ? emp.pseudonym : b.pseudonym,
        department_name: emp.department_name !== '-' ? emp.department_name : b.department_name,
      };
    });

    const term = deferredSearchName.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (b) =>
          b.employee_name?.toLowerCase().includes(term) ||
          String(b.employee_id || "").includes(term) ||
          (b.pseudonym || "").toLowerCase().includes(term)
      );
    }
    if (selectedDepartment) {
      rows = rows.filter((b) => b.department_name === selectedDepartment);
    }
    if (selectedBreakType) {
      rows = rows.filter((b) => b.break_type === selectedBreakType);
    }
    return rows;
  }, [allBreaks, employees, deferredSearchName, selectedDepartment, selectedBreakType]);

  // Toggle edit mode
  const toggleEdit = (id: number) => {
    setAllBreaks(prev =>
      prev.map(b => (b.id === id ? { ...b, isEditing: !b.isEditing } : b))
    );
  };

  // Update field value
  const updateField = (id: number, field: keyof BreakRecord, value: any) => {
    setAllBreaks(prev =>
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
        toastSuccess(`${record.break_type === 'break' ? 'Break' : 'Prayer Break'} updated successfully!`);
        toggleEdit(record.id!);
        fetchBreaks(); // Refresh to get latest data
      } else {
        toastError("Error updating break: " + data.error);
      }
    } catch (error) {
      console.error("Error saving break:", error);
      toastError("Error saving break");
    }
  };

  // Add new break record
  const addNewRecord = async () => {
    if (!newRecord.employee_id || !newRecord.date) {
      toastInfo("Please select employee and date");
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
        toastSuccess(`${newRecord.break_type === 'break' ? 'Break' : 'Prayer Break'} added successfully!`);
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
        toastError("Error adding break: " + data.error);
      }
    } catch (error) {
      console.error("Error adding break:", error);
      toastError("Error adding break");
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
        toastSuccess(`${record.break_type === 'break' ? 'Break' : 'Prayer Break'} deleted successfully!`);
        fetchBreaks();
      } else {
        toastError("Error deleting break: " + data.error);
      }
    } catch (error) {
      console.error("Error deleting break:", error);
      toastError("Error deleting break");
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
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={styles.breakSummaryContainer}>
          <div className={adminStyles.pageHeader}>
            <h1 className={adminStyles.pageHeaderTitle}>Manage Breaks</h1>
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className={adminStyles.btnGreen}
            >
              <FaPlus /> Add New Break
            </button>
          </div>

          {showAddForm ? (
            <div className={styles.mgmtAttAddPanel}>
              <h3 className={styles.mgmtAttAddTitle}>Add New Break Record</h3>
              <div className={styles.mgmtAttAddGrid}>
                <div>
                  <label className={styles.mgmtAttAddLabel}>Employee</label>
                  <select
                    value={newRecord.employee_id}
                    onChange={(e) => setNewRecord({ ...newRecord, employee_id: e.target.value })}
                    className={leaveStyles.toolbarSelect}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select Employee</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.first_name} {emp.last_name} ({emp.employee_code || emp.id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={styles.mgmtAttAddLabel}>Break Type</label>
                  <select
                    value={newRecord.break_type}
                    onChange={(e) =>
                      setNewRecord({
                        ...newRecord,
                        break_type: e.target.value as "break" | "prayer",
                      })
                    }
                    className={leaveStyles.toolbarSelect}
                    style={{ width: "100%" }}
                  >
                    <option value="break">Regular Break</option>
                    <option value="prayer">Prayer Break</option>
                  </select>
                </div>
                <div>
                  <label className={styles.mgmtAttAddLabel}>Date</label>
                  <input
                    type="date"
                    value={newRecord.date}
                    onChange={(e) => setNewRecord({ ...newRecord, date: e.target.value })}
                    className={leaveStyles.toolbarSelect}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label className={styles.mgmtAttAddLabel}>Start Time</label>
                  <input
                    type="datetime-local"
                    value={
                      newRecord.break_start ? formatDateTimeLocal(newRecord.break_start) : ""
                    }
                    onChange={(e) =>
                      setNewRecord({
                        ...newRecord,
                        break_start: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                    className={leaveStyles.toolbarSelect}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label className={styles.mgmtAttAddLabel}>End Time</label>
                  <input
                    type="datetime-local"
                    value={newRecord.break_end ? formatDateTimeLocal(newRecord.break_end) : ""}
                    onChange={(e) =>
                      setNewRecord({
                        ...newRecord,
                        break_end: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                    className={leaveStyles.toolbarSelect}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
              <div className={styles.mgmtAttAddActions}>
                <button
                  type="button"
                  onClick={addNewRecord}
                  className={`${styles.mgmtAttBtn} ${styles.mgmtAttBtnSave}`}
                  style={{ padding: "8px 14px", fontSize: 13 }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className={`${styles.mgmtAttBtn} ${styles.mgmtAttBtnDelete}`}
                  style={{ padding: "8px 14px", fontSize: 13 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className={leaveStyles.toolbar}>
            <div className={leaveStyles.searchWrap}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className={leaveStyles.toolbarSearch}
                placeholder="Search by name or pseudo name"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className={leaveStyles.toolbarSelect}
              aria-label="Filter by department"
            >
              <option value="">All Departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.name}>
                  {dept.name}
                </option>
              ))}
            </select>
            <select
              value={selectedBreakType}
              onChange={(e) => setSelectedBreakType(e.target.value)}
              className={leaveStyles.toolbarSelect}
              aria-label="Filter by break type"
            >
              <option value="">All Break Types</option>
              <option value="break">Regular Break</option>
              <option value="prayer">Prayer Break</option>
            </select>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={leaveStyles.toolbarSelect}
              aria-label="From date"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={leaveStyles.toolbarSelect}
              aria-label="To date"
            />
            <div className={leaveStyles.toolbarActions}>
              <button
                type="button"
                onClick={downloadExcel}
                className={styles.breakSummaryXLSButton}
                title="Download Excel"
              >
                <FaFileExcel size={14} />
                <span>Export Excel</span>
              </button>
            </div>
          </div>

          <div className={leaveStyles.reqTableShell}>
            <div className={styles.mgmtAttScroll}>
              {loading ? (
                <div className={leaveStyles.loading}>Loading breaks…</div>
              ) : (
                <table className={`${leaveStyles.reqTable} ${styles.mgmtBreaksTableFit}`}>
                  <thead>
                    <tr>
                      <th>ID</th>
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
                        <td colSpan={10} className={leaveStyles.reqEmpty}>
                          No records found.
                        </td>
                      </tr>
                    ) : (
                      breaks.map((b) => (
                        <tr key={`${b.break_type}-${b.id}`}>
                          <td className={leaveStyles.reqId}>{b.employee_id}</td>
                          <td>
                            {b.isEditing ? (
                              <input
                                type="text"
                                value={b.employee_name}
                                onChange={(e) =>
                                  updateField(b.id!, "employee_name", e.target.value)
                                }
                                className={styles.mgmtAttCellInput}
                              />
                            ) : (
                              <EmployeeTableNameCell
                                name={b.employee_name}
                                employeeId={b.employee_id}
                                photo={getPhoto(b.employee_id)}
                                onOpen={() => openFromRow(b)}
                              />
                            )}
                          </td>
                          <td title={b.pseudonym || ""}>{b.pseudonym || "—"}</td>
                          <td title={b.department_name || ""}>{b.department_name || "—"}</td>
                          <td>
                            <span
                              className={`${styles.mgmtBreakTypeBadge} ${
                                b.break_type === "break"
                                  ? styles.mgmtBreakTypeRegular
                                  : styles.mgmtBreakTypePrayer
                              }`}
                            >
                              {b.break_type === "break" ? "Break" : "Prayer"}
                            </span>
                          </td>
                          <td>
                            {b.isEditing ? (
                              <input
                                type="date"
                                value={
                                  b.date ? new Date(b.date).toISOString().split("T")[0] : ""
                                }
                                onChange={(e) => updateField(b.id!, "date", e.target.value)}
                                className={styles.mgmtAttCellInput}
                              />
                            ) : b.date ? (
                              getDateStringInTimeZone(b.date, SERVER_TIMEZONE)
                            ) : (
                              ""
                            )}
                          </td>
                          <td>
                            {b.isEditing ? (
                              <input
                                type="datetime-local"
                                value={formatDateTimeLocal(b.break_start)}
                                onChange={(e) =>
                                  updateField(
                                    b.id!,
                                    "break_start",
                                    e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : null,
                                  )
                                }
                                className={styles.mgmtAttCellInput}
                              />
                            ) : b.break_start ? (
                              getTimeStringInTimeZone(b.break_start, SERVER_TIMEZONE)
                            ) : (
                              ""
                            )}
                          </td>
                          <td>
                            {b.isEditing ? (
                              <input
                                type="datetime-local"
                                value={formatDateTimeLocal(b.break_end)}
                                onChange={(e) =>
                                  updateField(
                                    b.id!,
                                    "break_end",
                                    e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : null,
                                  )
                                }
                                className={styles.mgmtAttCellInput}
                              />
                            ) : b.break_end ? (
                              getTimeStringInTimeZone(b.break_end, SERVER_TIMEZONE)
                            ) : (
                              ""
                            )}
                          </td>
                          <td>
                            {b.break_duration
                              ? formatDuration(b.break_duration)
                              : b.break_start && b.break_end
                                ? (() => {
                                    const start = new Date(b.break_start).getTime();
                                    const end = new Date(b.break_end).getTime();
                                    const totalSeconds = Math.floor((end - start) / 1000);
                                    return formatDuration(totalSeconds);
                                  })()
                                : ""}
                          </td>
                          <td>
                            <div className={styles.mgmtAttActions}>
                              {b.isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => saveRecord(b)}
                                    className={`${styles.mgmtAttBtn} ${styles.mgmtAttBtnSave}`}
                                    title="Save"
                                    aria-label="Save"
                                  >
                                    <FaSave />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleEdit(b.id!)}
                                    className={`${styles.mgmtAttBtn} ${styles.mgmtAttBtnCancel}`}
                                    title="Cancel"
                                    aria-label="Cancel"
                                  >
                                    <FaTimes />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => toggleEdit(b.id!)}
                                    className={`${styles.mgmtAttBtn} ${styles.mgmtAttBtnEdit}`}
                                    title="Edit"
                                    aria-label="Edit"
                                  >
                                    <FaEdit />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteRecord(b)}
                                    className={`${styles.mgmtAttBtn} ${styles.mgmtAttBtnDelete}`}
                                    title="Delete"
                                    aria-label="Delete"
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
          </div>

          <div className={styles.mgmtAttMeta}>Total Records: {breaks.length}</div>
        </div>
      </div>
      {popup}
    </OptionalAdminShell>
  );
}

