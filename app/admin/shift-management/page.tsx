"use client";
import React, { useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "./shift-management.module.css";
import {
  FaClock,
  FaCheckCircle,
  FaTimesCircle,
  FaSave,
} from "react-icons/fa";

interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  status: string;
  shift_name?: string;
  start_time?: string;
  end_time?: string;
  assigned_date?: string;
  assignment_id?: number;
  allow_overtime?: number;
  department_name?: string;
  pseudonym?: string;
}

interface Department {
  id: number;
  name: string;
}

interface MasterShift {
  id: number;
  name: string;
  shift_in: string;
  shift_out: string;
  overtime_daily: number;
  working_days: string;
}

// Convert 24-hour time to 12-hour format with AM/PM
const formatTimeTo12Hour = (time: string): string => {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

export default function ShiftManagementPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [masterShifts, setMasterShifts] = useState<MasterShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [selectedScope, setSelectedScope] = useState<string>(""); // all, dept-<id>, emp-<id>
  const [selectedAll, setSelectedAll] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedMasterShift, setSelectedMasterShift] = useState<string>("");
  const [shiftName, setShiftName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAssignmentId, setEditAssignmentId] = useState<number | null>(null);
  const [editShiftName, setEditShiftName] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editAllowOvertime, setEditAllowOvertime] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [targetSearch, setTargetSearch] = useState("");
  
  // Overtime Target Selection States
  const [overtimeScope, setOvertimeScope] = useState<string>("");
  const [overtimeSelectedAll, setOvertimeSelectedAll] = useState(false);
  const [overtimeSelectedEmployeeIds, setOvertimeSelectedEmployeeIds] = useState<number[]>([]);
  const [overtimeDropdownOpen, setOvertimeDropdownOpen] = useState(false);
  const [overtimeTargetSearch, setOvertimeTargetSearch] = useState("");
  const [updatingOvertimeId, setUpdatingOvertimeId] = useState<number | null>(null);

  useEffect(() => {
    fetchEmployees();
    fetchDepartments();
    fetchMasterShifts();
  }, []);

  // Keep selections in sync when "all" is toggled or list changes
  useEffect(() => {
    if (selectedAll) {
      setSelectedEmployeeIds(employees.map(e => e.id));
    }
  }, [selectedAll, employees]);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/hrm-shifts-assignments");
      const data = await res.json();
      if (!data.success || !Array.isArray(data.employees)) {
        setError(data.error || "Failed to fetch employees");
        return;
      }

      // Start with base shift-management API data first so table always shows.
      const baseEmployees: Employee[] = data.employees.map((emp: any) => ({
        ...emp,
        first_name: emp.first_name || "",
        last_name: emp.last_name || "",
      }));

      // Fetch employee list for department (best effort).
      const deptMap = new Map<number, string>();
      const employeeInfoMap = new Map<number, { first_name?: string; last_name?: string; status?: string; pseudonym?: string }>();
      try {
        const empListRes = await fetch("/api/employee-list");
        const empListData = await empListRes.json();
        if (empListData.success && Array.isArray(empListData.employees)) {
          empListData.employees.forEach((emp: any) => {
            deptMap.set(Number(emp.id), emp.department_name || "-");
            employeeInfoMap.set(Number(emp.id), {
              first_name: emp.first_name || "",
              last_name: emp.last_name || "",
              status: emp.status || "",
              pseudonym: emp.pseudonym || "-",
            });
          });
        }
      } catch {
        // keep defaults if enrichment fails
      }

      // Fetch attendance data to get pseudonym (best effort).
      const pseudonymMap = new Map<number, string>();
      try {
        const attendanceRes = await fetch("/api/attendance?fromDate=2020-01-01&toDate=2099-12-31");
        const attendanceData = await attendanceRes.json();
        if (attendanceData.success && Array.isArray(attendanceData.attendance)) {
          attendanceData.attendance.forEach((att: any) => {
            const empId = Number(att.employee_id);
            if (!pseudonymMap.has(empId)) {
              pseudonymMap.set(empId, att.pseudonym || "-");
            }
          });
        }
      } catch {
        // keep defaults if enrichment fails
      }

      // Merge enrichment maps
      const enrichedEmployees = baseEmployees.map((emp: Employee) => ({
        ...emp,
        first_name: emp.first_name || employeeInfoMap.get(Number(emp.id))?.first_name || "",
        last_name: emp.last_name || employeeInfoMap.get(Number(emp.id))?.last_name || "",
        status: emp.status || employeeInfoMap.get(Number(emp.id))?.status || "",
        department_name: deptMap.get(Number(emp.id)) || emp.department_name || "-",
        pseudonym:
          pseudonymMap.get(Number(emp.id)) ||
          emp.pseudonym ||
          employeeInfoMap.get(Number(emp.id))?.pseudonym ||
          "-",
      }));
      setEmployees(enrichedEmployees);
    } catch (err) {
      setError("Failed to fetch employees");
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const res = await fetch("/api/departments");
      const data = await res.json();
      if (data.success && Array.isArray(data.departments)) {
        setDepartments(data.departments);
      } else if (Array.isArray(data)) {
        // Fallback for old API format
        setDepartments(data);
      }
    } catch (err) {
      console.error("Failed to fetch departments:", err);
    }
  };
  const fetchMasterShifts = async () => {
    try {
      const res = await fetch("/api/master-shifts");
      const data = await res.json();
      if (data.success) {
        setMasterShifts(data.shifts || []);
      }
    } catch (err) {
      console.error("Error fetching master shifts:", err);
    }
  };

  const handleMasterShiftChange = (shiftId: string) => {
    setSelectedMasterShift(shiftId);
    const shift = masterShifts.find(s => s.id === parseInt(shiftId));
    if (shift) {
      setShiftName(shift.name);
      setStartTime(shift.shift_in);
      setEndTime(shift.shift_out);
    }
  };
  const handleAssignShift = async () => {
    const hasManualEmployees = selectedEmployeeIds.length > 0;

    if (!selectedAll && !selectedScope && !hasManualEmployees) {
      setError("Please select target (all / department / employees)");
      return;
    }

    if (!shiftName || !startTime || !endTime) {
      setError("Please fill all fields");
      return;
    }

    const isAll = selectedAll || selectedScope === "all";
    const isDept = selectedScope.startsWith("dept-");

    const payload: any = {
      shift_name: shiftName,
      start_time: startTime,
      end_time: endTime,
    };

    if (isAll) {
      payload.assign_all = true;
    } else if (isDept) {
      payload.department_id = parseInt(selectedScope.replace("dept-", ""));
    } else if (hasManualEmployees) {
      payload.employee_ids = selectedEmployeeIds;
    } else {
      setError("Invalid selection");
      return;
    }

    setAssigningId(null);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/hrm-shifts-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(`Shift assigned successfully!`);
        setShiftName("");
        setStartTime("");
        setEndTime("");
        setSelectedScope("");
        setSelectedAll(false);
        setSelectedEmployeeIds([]);
        fetchEmployees(); // Refresh list
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.error || "Failed to assign shift");
      }
    } catch (err) {
      setError("Failed to assign shift");
    } finally {
      setAssigningId(null);
    }
  };

  const handleEditShift = (emp: Employee) => {
    setEditingId(emp.id);
    setEditAssignmentId(emp.assignment_id || null);
    setEditShiftName(emp.shift_name || "");
    setEditStartTime(emp.start_time || "");
    setEditEndTime(emp.end_time || "");
    setEditAllowOvertime((emp as any).allow_overtime !== false);
    setError("");
  };

  const handleUpdateShift = async () => {
    if (!editAssignmentId) {
      setError("Assignment ID is required");
      return;
    }
    if (!editStartTime || !editEndTime) {
      setError("Please fill both start and end times");
      return;
    }

    try {
      const res = await fetch("/api/hrm-shifts-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editAssignmentId,
          shift_name: editShiftName,
          start_time: editStartTime,
          end_time: editEndTime,
          allow_overtime: editAllowOvertime,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccess("Shift timing updated successfully!");
        setEditingId(null);
        fetchEmployees();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.error || "Failed to update shift");
      }
    } catch (err) {
      setError("Failed to update shift");
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditAssignmentId(null);
    setEditShiftName("");
    setEditStartTime("");
    setEditEndTime("");
    setEditAllowOvertime(true);
    setError("");
  };

  const toggleEmployeeSelection = (empId: number) => {
    setSelectedAll(false);
    setSelectedScope("");
    setSelectedEmployeeIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const toggleOvertimeEmployeeSelection = (empId: number) => {
    setOvertimeSelectedAll(false);
    setOvertimeScope("");
    setOvertimeSelectedEmployeeIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const handleAllowOvertime = async () => {
    const hasManualEmployees = overtimeSelectedEmployeeIds.length > 0;

    if (!overtimeSelectedAll && !overtimeScope && !hasManualEmployees) {
      setError("Please select target for overtime (all / department / employees)");
      return;
    }

    const isAll = overtimeSelectedAll || overtimeScope === "all";
    const isDept = overtimeScope.startsWith("dept-");

    setUpdatingOvertimeId(null);
    setError("");
    setSuccess("");

    try {
      let targetEmployees: number[] = [];

      if (isAll) {
        targetEmployees = employees.map(e => e.id);
      } else if (isDept) {
        const deptId = parseInt(overtimeScope.replace("dept-", ""));
        targetEmployees = employees
          .filter(e => {
            const empListItem = employees.find(emp => emp.id === e.id);
            return empListItem && empListItem.department_name === departments.find(d => d.id === deptId)?.name;
          })
          .map(e => e.id);
      } else {
        targetEmployees = overtimeSelectedEmployeeIds;
      }

      if (targetEmployees.length === 0) {
        setError("No target employees found for selected filter");
        return;
      }

      const res = await fetch("/api/hrm-shifts-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_ids: targetEmployees,
          allow_overtime: true,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Failed to allow overtime for selected employees");
        return;
      }

      setSuccess("Overtime allowed for selected employees!");
      setOvertimeScope("");
      setOvertimeSelectedAll(false);
      setOvertimeSelectedEmployeeIds([]);
      fetchEmployees(); // Refresh list
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError("Failed to update overtime settings");
    } finally {
      setUpdatingOvertimeId(null);
    }
  };

  const handleDisallowOvertime = async () => {
    const hasManualEmployees = overtimeSelectedEmployeeIds.length > 0;

    if (!overtimeSelectedAll && !overtimeScope && !hasManualEmployees) {
      setError("Please select target (all / department / employees)");
      return;
    }

    const isAll = overtimeSelectedAll || overtimeScope === "all";
    const isDept = overtimeScope.startsWith("dept-");

    setUpdatingOvertimeId(null);
    setError("");
    setSuccess("");

    try {
      let targetEmployees: number[] = [];

      if (isAll) {
        targetEmployees = employees.map(e => e.id);
      } else if (isDept) {
        const deptId = parseInt(overtimeScope.replace("dept-", ""));
        targetEmployees = employees
          .filter(e => {
            const empListItem = employees.find(emp => emp.id === e.id);
            return empListItem && empListItem.department_name === departments.find(d => d.id === deptId)?.name;
          })
          .map(e => e.id);
      } else {
        targetEmployees = overtimeSelectedEmployeeIds;
      }

      if (targetEmployees.length === 0) {
        setError("No target employees found for selected filter");
        return;
      }

      const res = await fetch("/api/hrm-shifts-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_ids: targetEmployees,
          allow_overtime: false,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Failed to disallow overtime for selected employees");
        return;
      }

      setSuccess("Overtime disabled for selected employees!");
      setOvertimeScope("");
      setOvertimeSelectedAll(false);
      setOvertimeSelectedEmployeeIds([]);
      fetchEmployees(); // Refresh list
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError("Failed to update overtime settings");
    } finally {
      setUpdatingOvertimeId(null);
    }
  };  const handleDeleteShift = async (emp: Employee) => {
    if (!emp.assignment_id) {
      setError("No shift assignment found");
      return;
    }

    if (!confirm(`Are you sure you want to delete shift assignment for ${emp.first_name} ${emp.last_name}?`)) {
      return;
    }

    try {
      const res = await fetch("/api/hrm-shifts-assignments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: emp.assignment_id }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccess("Shift assignment deleted successfully!");
        fetchEmployees();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.error || "Failed to delete shift");
      }
    } catch (err) {
      setError("Failed to delete shift");
    }
  };

  const getStatusColor = (status: string) => {
    return status === "enabled" || status === "active"
      ? styles.statusActive
      : styles.statusInactive;
  };

  const filteredEmployees = employees.filter((emp) => {
    // Filter by search text
    const matchesSearch = 
      emp.first_name?.toLowerCase().includes(search.toLowerCase()) ||
      emp.last_name?.toLowerCase().includes(search.toLowerCase()) ||
      emp.id?.toString().includes(search) ||
      `${emp.first_name} ${emp.last_name}`
        .toLowerCase()
        .includes(search.toLowerCase());
    
    // Filter by selected department if a department is selected
    if (selectedScope.startsWith("dept-")) {
      const selectedDeptId = parseInt(selectedScope.replace("dept-", ""));
      const selectedDept = departments.find(d => d.id === selectedDeptId);
      const matchesDepartment = emp.department_name === selectedDept?.name;
      return matchesSearch && matchesDepartment;
    }
    
    // If no department selected or "all" selected, just use search filter
    return matchesSearch;
  });

  return (
    <LayoutDashboard>
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>
            <FaClock style={{ color: "#667eea" }} />
            Shift Management
          </h1>
          <p className={styles.pageSubtitle}>
            Assign shifts and timings to employees
          </p>
        </div>

        {success && <div className={styles.successMessage}>✓ {success}</div>}
        {error && (
          <div className={styles.error}>
            <FaTimesCircle /> {error}
          </div>
        )}

        <div className={styles.searchContainer}>
          <input
            type="text"
            placeholder="Search employees by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
          <span className={styles.searchCount}>
            {filteredEmployees.length} / {employees.length} employees
          </span>
        </div>

        <div className={styles.controlsContainer}>
          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>Select Target</label>
            <div className={styles.customDropdown}>
              <div
                className={styles.dropdownToggle}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                {selectedAll ? (
                  <span className={styles.selectedBadge}>✓ All employees selected</span>
                ) : selectedScope.startsWith("dept-") ? (
                  `Department: ${departments.find(d => d.id === parseInt(selectedScope.replace("dept-", "")))?.name}`
                ) : selectedEmployeeIds.length > 0 ? (
                  `${selectedEmployeeIds.length} employee${selectedEmployeeIds.length > 1 ? "s" : ""} selected`
                ) : selectedScope === "" ? (
                  "-- Choose Target --"
                ) : (
                  "-- Choose Target --"
                )}
              </div>
              {dropdownOpen && (
                <div className={styles.dropdownMenu}>
                  <input
                    type="text"
                    placeholder="Search employees..."
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value.toLowerCase())}
                    className={styles.dropdownSearch}
                    autoFocus
                  />
                  <div className={styles.dropdownContent}>
                    <div
                      className={`${styles.dropdownOption} ${selectedAll ? styles.dropdownOptionSelected : ""}`}
                      onClick={() => {
                        setSelectedAll(true);
                        setSelectedScope("all");
                        setSelectedEmployeeIds(employees.map(e => e.id));
                        setDropdownOpen(false);
                        setTargetSearch("");
                      }}
                    >
                      <div className={styles.optionRow}>
                        <span
                          className={`${styles.optionCheckbox} ${selectedAll ? styles.optionCheckboxChecked : ""}`}
                        >
                          {selectedAll ? "✓" : ""}
                        </span>
                        <span>Assign to all employees</span>
                      </div>
                    </div>
                    
                    {departments.length > 0 && (
                      <React.Fragment key="target-departments-group">
                        <div className={styles.dropdownGroup}>Departments</div>
                        {departments.map((d, idx) => (
                          <div
                            key={`target-dept-${d.id}-${idx}`}
                            className={`${styles.dropdownOption} ${selectedScope === `dept-${d.id}` ? styles.dropdownOptionSelected : ""}`}
                            onClick={() => {
                              setSelectedScope(`dept-${d.id}`);
                              setSelectedAll(false);
                              setSelectedEmployeeIds([]);
                              setDropdownOpen(false);
                              setTargetSearch("");
                            }}
                          >
                            <div className={styles.optionRow}>
                              <span
                                className={`${styles.optionCheckbox} ${selectedScope === `dept-${d.id}` ? styles.optionCheckboxChecked : ""}`}
                              >
                                {selectedScope === `dept-${d.id}` ? "✓" : ""}
                              </span>
                              <span>📁 {d.name}</span>
                            </div>
                          </div>
                        ))}
                      </React.Fragment>
                    )}

                    <div className={styles.dropdownGroup}>Employees</div>
                    {employees
                      .filter(emp =>
                        emp.first_name?.toLowerCase().includes(targetSearch) ||
                        emp.last_name?.toLowerCase().includes(targetSearch) ||
                        emp.id?.toString().includes(targetSearch)
                      )
                      .map((emp, idx) => (
                        <div
                          key={`target-emp-${emp.id}-${idx}`}
                          className={`${styles.dropdownOption} ${selectedAll || selectedEmployeeIds.includes(emp.id) ? styles.dropdownOptionSelected : ""}`}
                          onClick={() => {
                            toggleEmployeeSelection(emp.id);
                            if (emp?.shift_name) {
                              setShiftName(emp.shift_name);
                              setStartTime(emp.start_time || "");
                              setEndTime(emp.end_time || "");
                            }
                          }}
                        >
                          <div className={styles.optionRow}>
                            <span
                              className={`${styles.optionCheckbox} ${selectedAll || selectedEmployeeIds.includes(emp.id) ? styles.optionCheckboxChecked : ""}`}
                            >
                              {selectedAll || selectedEmployeeIds.includes(emp.id) ? "✓" : ""}
                            </span>
                            <span>{emp.id} - {emp.first_name} {emp.last_name}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>Select Predefined Shift (Optional)</label>
            <select
              value={selectedMasterShift}
              onChange={(e) => handleMasterShiftChange(e.target.value)}
              className={styles.controlInput}
            >
              <option value="">-- Select from Shift Scheduler --</option>
              {masterShifts.map((shift, idx) => (
                <option key={`master-shift-${shift.id}-${idx}`} value={shift.id}>
                  {shift.name} ({shift.shift_in} - {shift.shift_out})
                </option>
              ))}
            </select>
          </div>

          <div className={styles.divider}>OR Enter Manually</div>

          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>Shift Name</label>
            <input
              type="text"
              placeholder="e.g., Morning, Afternoon, Night"
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
              className={styles.controlInput}
            />
          </div>

          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={styles.controlInput}
            />
          </div>

          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>End Time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={styles.controlInput}
            />
          </div>

          <button
            onClick={handleAssignShift}
            className={styles.assignButton}
            disabled={assigningId !== null}
          >
            <FaSave /> {assigningId !== null ? "Assigning..." : "Assign"}
          </button>
        </div>

        {/* OVERTIME ALLOWANCE SECTION */}
        <div style={{ marginTop: "35px", backgroundColor: "#F7FAFC", borderRadius: "10px", padding: "20px", border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "200px" }}>
              <FaClock style={{ color: "#ED8936", fontSize: "16px" }} />
              <span style={{ fontSize: "13px", fontWeight: "600", color: "#2D3748" }}>Select Target for Over Time</span>
            </div>

            <div style={{ flex: 1, minWidth: "250px" }}>
              <div className={styles.customDropdown}>
                <div
                  className={styles.dropdownToggle}
                  onClick={() => setOvertimeDropdownOpen(!overtimeDropdownOpen)}
                  style={{ padding: "9px 12px", fontSize: "13px", borderRadius: "6px" }}
                >
                  {overtimeSelectedAll ? (
                    <span style={{ color: "#48BB78", fontWeight: "600" }}>✓ All</span>
                  ) : overtimeScope.startsWith("dept-") ? (
                    `Dept: ${departments.find(d => d.id === parseInt(overtimeScope.replace("dept-", "")))?.name || "..."}`
                  ) : overtimeSelectedEmployeeIds.length > 0 ? (
                    `${overtimeSelectedEmployeeIds.length} emp${overtimeSelectedEmployeeIds.length > 1 ? "s" : ""}`
                  ) : (
                    "-- Choose --"
                  )}
                </div>

                {overtimeDropdownOpen && (
                  <div className={styles.dropdownMenu} style={{ maxHeight: "350px", overflowY: "auto" }}>
                    <input
                      type="text"
                      placeholder="Search..."
                      value={overtimeTargetSearch}
                      onChange={(e) => setOvertimeTargetSearch(e.target.value.toLowerCase())}
                      className={styles.dropdownSearch}
                      autoFocus
                      style={{ padding: "8px 10px", fontSize: "13px", marginBottom: "6px" }}
                    />

                    <div className={styles.dropdownContent}>
                      <div
                        className={`${styles.dropdownOption} ${overtimeSelectedAll ? styles.dropdownOptionSelected : ""}`}
                        onClick={() => {
                          setOvertimeSelectedAll(true);
                          setOvertimeScope("all");
                          setOvertimeSelectedEmployeeIds(employees.map(e => e.id));
                          setOvertimeDropdownOpen(false);
                          setOvertimeTargetSearch("");
                        }}
                        style={{ padding: "8px 10px", fontSize: "13px" }}
                      >
                        <div className={styles.optionRow}>
                          <span className={`${styles.optionCheckbox} ${overtimeSelectedAll ? styles.optionCheckboxChecked : ""}`}>
                            {overtimeSelectedAll ? "✓" : ""}
                          </span>
                          <span>All employees</span>
                        </div>
                      </div>

                      {departments.length > 0 && (
                        <React.Fragment key="overtime-departments-group">
                          <div className={styles.dropdownGroup}>Departments</div>
                          {departments.map((d, idx) => (
                            <div
                              key={`ot-dept-${d.id}-${idx}`}
                              className={`${styles.dropdownOption} ${overtimeScope === `dept-${d.id}` ? styles.dropdownOptionSelected : ""}`}
                              onClick={() => {
                                setOvertimeScope(`dept-${d.id}`);
                                setOvertimeSelectedAll(false);
                                setOvertimeSelectedEmployeeIds([]);
                                setOvertimeDropdownOpen(false);
                                setOvertimeTargetSearch("");
                              }}
                              style={{ padding: "8px 10px", fontSize: "13px" }}
                            >
                              <div className={styles.optionRow}>
                                <span className={`${styles.optionCheckbox} ${overtimeScope === `dept-${d.id}` ? styles.optionCheckboxChecked : ""}`}>
                                  {overtimeScope === `dept-${d.id}` ? "✓" : ""}
                                </span>
                                <span>{d.name}</span>
                              </div>
                            </div>
                          ))}
                        </React.Fragment>
                      )}

                      <div className={styles.dropdownGroup}>Employees</div>
                      {employees
                        .filter(emp =>
                          emp.first_name?.toLowerCase().includes(overtimeTargetSearch) ||
                          emp.last_name?.toLowerCase().includes(overtimeTargetSearch) ||
                          emp.id?.toString().includes(overtimeTargetSearch)
                        )
                        .map((emp, idx) => (
                          <div
                            key={`ot-emp-${emp.id}-${idx}`}
                            className={`${styles.dropdownOption} ${overtimeSelectedEmployeeIds.includes(emp.id) ? styles.dropdownOptionSelected : ""}`}
                            onClick={() => toggleOvertimeEmployeeSelection(emp.id)}
                            style={{ padding: "8px 10px", fontSize: "13px" }}
                          >
                            <div className={styles.optionRow}>
                              <span className={`${styles.optionCheckbox} ${overtimeSelectedEmployeeIds.includes(emp.id) ? styles.optionCheckboxChecked : ""}`}>
                                {overtimeSelectedEmployeeIds.includes(emp.id) ? "✓" : ""}
                              </span>
                              <span>{emp.id} - {emp.first_name} {emp.last_name}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleAllowOvertime}
              disabled={updatingOvertimeId !== null}
              style={{
                padding: "8px 14px",
                fontSize: "13px",
                backgroundColor: "#48BB78",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: updatingOvertimeId !== null ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
                transition: "all 0.2s ease",
                opacity: updatingOvertimeId !== null ? 0.65 : 1,
                boxShadow: "0 2px 6px rgba(72, 187, 120, 0.15)",
                whiteSpace: "nowrap"
              }}
              onMouseEnter={(e) => {
                if (updatingOvertimeId === null) {
                  e.currentTarget.style.backgroundColor = "#38A169";
                  e.currentTarget.style.boxShadow = "0 3px 10px rgba(72, 187, 120, 0.25)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#48BB78";
                e.currentTarget.style.boxShadow = "0 2px 6px rgba(72, 187, 120, 0.15)";
              }}
            >
              <FaCheckCircle style={{ fontSize: "12px" }} />
              <span>{updatingOvertimeId !== null ? "..." : "Allow"}</span>
            </button>
          </div>
        </div>

        <div className={styles.tableContainer} style={{ marginTop: "20px", overflowY: "auto", maxHeight: "74vh" }}>
          <table className={styles.employeeTable}>
            <thead style={{ position: "sticky", top: 0, zIndex: 12 }}>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Pseudonym</th>
                <th>Department</th>
                <th>Status</th>
                <th>Shift</th>
                  <th>Shift Timing</th>
                  <th>Overtime?</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", padding: "20px" }}>
                      No employees found
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp, idx) => (
                    <tr key={`row-emp-${emp.id}-${idx}`}>
                      <td className={styles.employeeCode}>
                        {emp.id}
                      </td>
                      <td className={styles.employeeName}>
                        {emp.first_name} {emp.last_name}
                      </td>
                      <td>{emp.pseudonym || '-'}</td>
                      <td>{emp.department_name || '-'}</td>
                      <td>
                        <span className={getStatusColor(emp.status)}>
                          {emp.status === "enabled" || emp.status === "active"
                            ? "Active"
                            : "Inactive"}
                        </span>
                      </td>
                      <td>
                        {editingId === emp.id ? (
                          <input
                            type="text"
                            value={editShiftName}
                            onChange={(e) => setEditShiftName(e.target.value)}
                            className={styles.controlInput}
                            placeholder="e.g., Morning, Afternoon"
                          />
                        ) : emp.shift_name ? (
                          <span className={styles.shiftName}>
                            {emp.shift_name}
                          </span>
                        ) : (
                          <span className={styles.noShift}>Not assigned</span>
                        )}
                      </td>
                      <td>
                        {editingId === emp.id ? (
                          <div className={styles.editTimeInputs}>
                            <input
                              type="time"
                              value={editStartTime}
                              onChange={(e) => setEditStartTime(e.target.value)}
                              className={styles.timeInput}
                            />
                            <span className={styles.timeSeparator}>-</span>
                            <input
                              type="time"
                              value={editEndTime}
                              onChange={(e) => setEditEndTime(e.target.value)}
                              className={styles.timeInput}
                            />
                          </div>
                        ) : (
                          <div className={styles.shiftInfo}>
                            {emp.start_time && emp.end_time ? (
                              <span className={styles.shiftTime}>
                                {formatTimeTo12Hour(emp.start_time)} - {formatTimeTo12Hour(emp.end_time)}
                              </span>
                            ) : (
                              <span className={styles.noShift}>-</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        {editingId === emp.id ? (
                          <input
                            type="checkbox"
                            checked={editAllowOvertime}
                            onChange={(e) => setEditAllowOvertime(e.target.checked)}
                            style={{ cursor: "pointer", width: "18px", height: "18px" }}
                          />
                        ) : (
                          <span style={{ fontSize: "18px", color: (emp as any).allow_overtime === 1 || (emp as any).allow_overtime === true ? "#48BB78" : "#999" }}>
                            {(emp as any).allow_overtime === 1 || (emp as any).allow_overtime === true ? "✓" : "-"}
                          </span>
                        )}
                      </td>
                      <td className={styles.actionsCell}>
                        {editingId === emp.id ? (
                          <div className={styles.actionButtons}>
                            <button
                              onClick={() => handleUpdateShift()}
                              className={styles.saveButton}
                              title="Save"
                            >
                              ✓
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className={styles.cancelButton}
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </div>
                        ) : emp.start_time && emp.end_time ? (
                          <div className={styles.actionButtons}>
                            <button
                              onClick={() => handleEditShift(emp)}
                              className={styles.editButton}
                              title="Edit timing"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => handleDeleteShift(emp)}
                              className={styles.deleteButton}
                              title="Delete shift"
                            >
                              🗑
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </div>
    </LayoutDashboard>
  );
}
