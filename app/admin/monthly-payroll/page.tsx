"use client";

import React, { useEffect, useState } from "react";
import { fetchAdvanceSalary } from "./advanceSalaryUtils";
import { fetchLoanSalary } from "./loanSalaryUtils";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";
import { FaFileExcel } from "react-icons/fa";
import * as XLSX from 'xlsx';
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";

// ...existing code...

interface AttendanceRecord {
  id: number;
  employee_id: string;
  employee_name: string;
  pseudonym: string;
  department_name: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: string;
  is_late: boolean;
  late_minutes: number | null;
}

interface CalendarDayOverride {
  date: string;
  status: "off" | "working";
  note?: string | null;
}

interface EmployeeCommissionRow {
  employee_id: string | number;
  month: string;
  train_6h_amt: number;
  arrears: number;
  kpi_add: number;
  commission: number;
  existing_client_incentive: number;
  trainer_incentive: number;
  floor_incentive: number;
}

type CommissionAmountField =
  | "train_6h_amt"
  | "arrears"
  | "kpi_add"
  | "commission"
  | "existing_client_incentive"
  | "trainer_incentive"
  | "floor_incentive";

export default function MonthlyAttendancePage() {
    // Calculate total working days for the month (excluding leaves and off days)
    function getTotalWorkingDays(employee: any, monthInfo: any, approvedLeavesMap: any) {
      let count = 0;
      if (!monthInfo || !monthInfo.days) return count;
      monthInfo.days.forEach((day: any) => {
        const workingDay = isWorkingDay(day.dateKey);
        // Exclude off days and approved leaves
        if (workingDay) {
          const isLeave = approvedLeavesMap[employee.employeeId]?.[day.dateKey];
          if (!isLeave) count++;
        }
      });
      return count;
    }
  // Format hours and minutes only (remove seconds)
  function formatHoursMins(duration: string) {
    // Expects format: 01h 38m 02s
    const match = duration.match(/(\d{2})h (\d{2})m/);
    if (match) {
      return `${match[1]}h ${match[2]}m`;
    }
    return duration;
  }

  // Calculate overtime in seconds (actual - shift duration)
  // Calculate assigned shift duration in seconds
  function getAssignedShiftSeconds(shiftStart: string | null | undefined, shiftEnd: string | null | undefined): number | null {
    const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
    if (!shiftStart || !shiftEnd ||
        typeof shiftStart !== 'string' || typeof shiftEnd !== 'string' ||
        !timeRegex.test(shiftStart) || !timeRegex.test(shiftEnd)) {
      return null;
    }
    const [startH, startM] = shiftStart.split(":").map(Number);
    const [endH, endM] = shiftEnd.split(":").map(Number);
    if (
      isNaN(startH) || isNaN(startM) ||
      isNaN(endH) || isNaN(endM)
    ) return null;
    let shiftSeconds = (endH * 3600 + endM * 60) - (startH * 3600 + startM * 60);
    if (shiftSeconds < 0) shiftSeconds += 24 * 3600;
    return shiftSeconds;
  }

  // Calculate overtime in seconds (actual - shift duration)
  function calculateOvertime(totalSeconds: number, assignedShiftSeconds: number | null): number | null {
    if (!assignedShiftSeconds || assignedShiftSeconds <= 0) return null;
    const overtime = totalSeconds - assignedShiftSeconds;
    return overtime > 0 ? overtime : 0;
  }

  function formatDurationHM(seconds: number | null) {
    if (!seconds || seconds <= 0) return "-";
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    return `${h}h ${m}m`;
  }

  const [attendance, setAttendance] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchName, setSearchName] = useState("");


    // After attendanceByEmployee is defined (around line 660):
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [allowOvertimeMap, setAllowOvertimeMap] = useState<Record<string, boolean>>({});
  
  // Set default dates - start of current month to today
  const today = new Date();
  const todayStr = getDateStringInTimeZone(today, SERVER_TIMEZONE);
  const firstDayOfMonth = `${todayStr.slice(0, 7)}-01`;
  
  const [fromDate, setFromDate] = useState(firstDayOfMonth);
  const [toDate, setToDate] = useState(todayStr);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );
  const [calendarOverrides, setCalendarOverrides] = useState<Record<string, CalendarDayOverride>>({});
  const [approvedLeavesMap, setApprovedLeavesMap] = useState<Record<string, Record<string, boolean>>>({});
  const [commissionsMap, setCommissionsMap] = useState<Record<string, EmployeeCommissionRow>>({});

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

  // Fetch attendance records
  const fetchAttendance = () => {
    setLoading(true);
    let url = "/api/attendance";
    const params = new URLSearchParams();
    
    if (fromDate) params.append("fromDate", fromDate);
    if (toDate) params.append("toDate", toDate);
    // Department filter: match by department name (not id)
    if (selectedDepartment) params.append("departmentName", selectedDepartment);
    // Name filter: match by employee name (case-insensitive)
    if (searchName) params.append("employeeName", searchName);
    
    if (params.toString()) {
      url += "?" + params.toString();
    }

    fetch(url, { cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // First, build a map of employee_id -> most recent valid shift timings
          const empShiftMap: Record<string, {start: string, end: string, seconds: number}> = {};
          (data.attendance || []).forEach((record: any) => {
            const assignedShiftSeconds = getAssignedShiftSeconds(record.shift_start_time, record.shift_end_time);
            if (
              record.employee_id &&
              record.shift_start_time && record.shift_end_time &&
              assignedShiftSeconds && assignedShiftSeconds > 0
            ) {
              empShiftMap[record.employee_id] = {
                start: record.shift_start_time,
                end: record.shift_end_time,
                seconds: assignedShiftSeconds
              };
            }
          });

          let records = (data.attendance || []).map((record: any) => {
            // Calculate total seconds from clock_in and clock_out
            const totalSeconds = record.total_seconds && record.total_seconds > 0 
              ? record.total_seconds 
              : calculateTotalSeconds(record.clock_in, record.clock_out);
            // Use record's shift timings, or fallback to most recent for this employee
            let assignedShiftSeconds = getAssignedShiftSeconds(record.shift_start_time, record.shift_end_time);
            if ((!assignedShiftSeconds || assignedShiftSeconds <= 0) && empShiftMap[record.employee_id]) {
              assignedShiftSeconds = empShiftMap[record.employee_id].seconds;
            }
            // Calculate overtime using assigned shift seconds
            const overtimeSeconds = calculateOvertime(totalSeconds, assignedShiftSeconds);
            return {
              ...record,
              total_hours: formatDuration(totalSeconds),
              assigned_shift_seconds: assignedShiftSeconds,
              overtime: overtimeSeconds,
              is_late: record.is_late,
              late_minutes: record.late_minutes || 0
            };
          });
          // Client-side filter for department and name (in case API doesn't filter)
          if (selectedDepartment) {
            records = records.filter((r: any) => (r.department_name || "").toLowerCase() === selectedDepartment.toLowerCase());
          }
          if (searchName) {
            records = records.filter((r: any) => (r.employee_name || "").toLowerCase().includes(searchName.toLowerCase()));
          }
          setAttendance(records);

          // Fetch approved leaves for employees in the date range
          const uniqueEmployees = [...new Set(records.map((r: any) => String(r.employee_id)))] as string[];
          if (uniqueEmployees.length > 0) {
            fetchApprovedLeaves(uniqueEmployees, fromDate, toDate);
          }
        }
      })
      .catch(err => console.error("Error fetching attendance:", err))
      .finally(() => setLoading(false));
  };

  // Fetch approved leaves for given employees and date range
  const fetchApprovedLeaves = async (employeeIds: string[], from: string, to: string) => {
    try {
      const params = new URLSearchParams();
      params.append("employees", employeeIds.join(","));
      params.append("fromDate", from);
      params.append("toDate", to);

      const response = await fetch(`/api/leaves?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();

      if (data.success && data.leaves) {
        // console.log('leaves from backend:', data.leaves);
        // Build map of employee_id -> date -> true (for approved leaves)
        const leavesMap: Record<string, Record<string, boolean>> = {};

        data.leaves.forEach((leave: any) => {
          if (leave.status === "approved") {
            const empId = String(leave.employee_id);
            if (!leavesMap[empId]) {
              leavesMap[empId] = {};
            }

            // Parse dates and mark all dates within the range
            const startDate = new Date(leave.start_date);
            const endDate = new Date(leave.end_date);
            let currentDate = new Date(startDate);

            while (currentDate <= endDate) {
              // Use local date string (not UTC) for correct mapping
              const dateKey = currentDate.getFullYear() + '-' +
                String(currentDate.getMonth() + 1).padStart(2, '0') + '-' +
                String(currentDate.getDate()).padStart(2, '0');
              leavesMap[empId][dateKey] = true;
              currentDate.setDate(currentDate.getDate() + 1);
            }
          }
        });

        // console.log('approvedLeavesMap:', leavesMap);
        setApprovedLeavesMap(leavesMap);
      }
    } catch (err) {
      console.error("Error fetching approved leaves:", err);
    }
  };

  // Fetch shift assignment allow_overtime flags for all employees
  const fetchOverTimeSettings = async () => {
    try {
      const response = await fetch("/api/hrm-shifts-assignments", { cache: "no-store" });
      const data = await response.json();

      if (data.success && data.employees) {
        // Build map of employee_id -> allow_overtime
        const otMap: Record<string, boolean> = {};
        data.employees.forEach((emp: any) => {
          const empId = String(emp.id);
          // Latest assignment (returned by API) determines OT allowance
          if (emp.allow_overtime !== undefined && emp.allow_overtime !== null) {
            otMap[empId] = emp.allow_overtime === 1 || emp.allow_overtime === true;
          }
        });
        setAllowOvertimeMap(otMap);
      }
    } catch (err) {
      console.error("Error fetching overtime settings:", err);
    }
  };

  const fetchCommissions = async (month: string) => {
    if (!month) {
      setCommissionsMap({});
      return;
    }

    try {
      const response = await fetch(`/api/commissions?month=${month}`, { cache: "no-store" });
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        const map: Record<string, EmployeeCommissionRow> = {};
        data.data.forEach((row: any) => {
          const empId = String(row.employee_id);
          map[empId] = {
            employee_id: row.employee_id,
            month: row.month,
            train_6h_amt: Number(row.train_6h_amt ?? 0),
            arrears: Number(row.arrears ?? 0),
            kpi_add: Number(row.kpi_add ?? 0),
            commission: Number(row.commission ?? 0),
            existing_client_incentive: Number(row.existing_client_incentive ?? 0),
            trainer_incentive: Number(row.trainer_incentive ?? 0),
            floor_incentive: Number(row.floor_incentive ?? 0),
          };
        });
        setCommissionsMap(map);
      } else {
        setCommissionsMap({});
      }
    } catch (err) {
      console.error("Error fetching commissions:", err);
      setCommissionsMap({});
    }
  };

  // Sync filters with page: fetch data whenever any filter changes
  useEffect(() => {
    fetchAttendance();
    fetchOverTimeSettings();
  }, [fromDate, toDate, selectedDepartment, searchName]);

  useEffect(() => {
    if (!selectedMonth) return;
    const [yearStr, monthStr] = selectedMonth.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!year || !month) return;
    const lastDay = new Date(year, month, 0).getDate();
    const firstDate = `${yearStr}-${monthStr}-01`;
    const lastDate = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
    setFromDate(firstDate);
    setToDate(lastDate);
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) return;
    fetchCommissions(selectedMonth);
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) return;
    fetch(`/api/calendar?month=${selectedMonth}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.success) return;
        const map: Record<string, CalendarDayOverride> = {};
        (data.days || []).forEach((d: CalendarDayOverride) => {
          map[d.date] = d;
        });
        setCalendarOverrides(map);
      })
      .catch((err) => console.error("calendar fetch", err));
  }, [selectedMonth]);

  function calculateTotalSeconds(clockIn: string | null, clockOut: string | null): number {
    if (!clockIn || !clockOut) return 0;
    
    const inTime = new Date(clockIn);
    const outTime = new Date(clockOut);
    
    const diffMilliseconds = outTime.getTime() - inTime.getTime();
    if (diffMilliseconds < 0) return 0;
    
    return Math.floor(diffMilliseconds / 1000);
  }

  function formatDuration(seconds: number) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}h ${m}m ${s}s`;
  }

  function formatTime(timeString: string | null) {
    if (!timeString) return "-";
    return getTimeStringInTimeZone(timeString, SERVER_TIMEZONE);
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    });
  }

  function formatDateKey(dateKey: string) {
    if (!dateKey) return "-";
    const [year, month, day] = dateKey.split("-");
    if (!year || !month || !day) return dateKey;
    return `${month}/${day}/${year}`;
  }

  function formatLateTime(minutes: number | null) {
    if (!minutes || minutes === 0) return "-";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `Late ${h}h ${m}m`;
  }

  function getDateKey(dateValue: string) {
    if (!dateValue) return "";
    const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.exec(dateValue);
    if (dateOnlyMatch) return dateValue;
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return dateValue.split("T")[0] || "";
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getRecordDateKey(record: any) {
    return getDateKey(record.clock_in || record.clock_out || record.date || "");
  }

  function calculateTotalDeduction(employee: any) {
    let totalDeduction = 0;
    monthInfo.days.forEach((day) => {
      const dayRecords = employee.byDate[day.dateKey] || [];
      const meta = employee.dateMeta[day.dateKey];
      const workingDay = isWorkingDay(day.dateKey);
      
      let dayDeduction = 0;
      if (dayRecords.length === 0) {
        // No records for this day
        if (workingDay) {
          // Check for approved leave
          if (
            approvedLeavesMap[employee.employeeId] &&
            approvedLeavesMap[employee.employeeId][day.dateKey]
          ) {
            dayDeduction = 0; // Approved leave, no deduction
          } else {
            dayDeduction = 100; // Absent on working day
          }
        }
      } else {
        // Has records, use meta deduction
        if (meta?.deduction) {
          dayDeduction = parseInt(meta.deduction) || 0;
        }
      }
      totalDeduction += dayDeduction;
    });
    return totalDeduction;
  }

  function isWorkingDay(dateKey: string) {
    if (!dateKey) return false;
    const override = calendarOverrides[dateKey];
    if (override) return override.status === "working";
    const [yearStr, monthStr, dayStr] = dateKey.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const day = Number(dayStr);
    if (!year || monthIndex < 0 || !day) return false;
    const date = new Date(year, monthIndex, day);
    const weekday = date.getDay();
    return weekday !== 0 && weekday !== 6;
  }

  function downloadExcel() {
    // Export the same data as shown in the table (filteredEmployees)
    // Export the same data as shown in the table (filteredEmployees)
    const dataToExport = filteredEmployees.map(emp => ({
      "ID": emp.employeeId,
      "Employee Name": emp.employeeName,
      "Pseudonym": emp.pseudonym,
      "Department": emp.departmentName,
      "Basic Salary": emp.basicSalary !== undefined ? emp.basicSalary : '--',
      "T.W Days": Object.keys(emp.byDate).length > 0 ? getTotalWorkingDays(emp, monthInfo, approvedLeavesMap) : '--',
      "T.Unpaid Days": Object.keys(emp.byDate).length > 0 ? (() => { const val = calculateTotalDeduction(emp) / 100; return Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, ''); })() : '--',
      "O. T Hours": Object.keys(emp.byDate).length > 0 ? getEmployeeTotalOvertime(emp) : '--',
      "O. T Salary": getEmployeeOTSalary(emp),
      "6H Train Amt": getCommissionDisplay(emp.employeeId, "train_6h_amt"),
      "Arrears": getCommissionDisplay(emp.employeeId, "arrears"),
      "KPI Add": getCommissionDisplay(emp.employeeId, "kpi_add"),
      "Commission": getCommissionDisplay(emp.employeeId, "commission"),
      "Existing Client Incentive": getCommissionDisplay(emp.employeeId, "existing_client_incentive"),
      "Trainer Incentive": getCommissionDisplay(emp.employeeId, "trainer_incentive"),
      "Floor Incentive": getCommissionDisplay(emp.employeeId, "floor_incentive"),
      "Gross Salary": getEmployeeGrossSalary(emp),
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Monthly Payroll");
    worksheet['!cols'] = [
      { wch: 8 },
      { wch: 24 },
      { wch: 15 },
      { wch: 18 },
      { wch: 15 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 25 },
      { wch: 20 },
      { wch: 18 },
      { wch: 15 }
    ];
    const fileName = `monthly-payroll-${getDateStringInTimeZone(new Date(), SERVER_TIMEZONE)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  // Export single employee's month table
  function downloadEmployeeExcel(employee: any) {
    // Build table rows for this employee for the selected month
    const rows: any[] = [];
    if (!monthInfo.days) return;
    monthInfo.days.forEach((day) => {
      const dayRecords = employee.byDate[day.dateKey] || [];
      const meta = employee.dateMeta[day.dateKey];
      const workingDay = isWorkingDay(day.dateKey);
      if (dayRecords.length === 0) {
        // Check for approved leave
        let statusLabel = workingDay ? "Absent" : "Off";
        let deduction = workingDay ? "100%" : "";
        if (
          workingDay &&
          approvedLeavesMap[employee.employeeId] &&
          approvedLeavesMap[employee.employeeId][day.dateKey]
        ) {
          statusLabel = "Leave";
          deduction = "0%";
        }
        rows.push({
          Day: day.weekday,
          Date: formatDateKey(day.dateKey),
          "Clock In": "---",
          "Clock Out": "---",
          "Total W.H": "---",
          "Assigned W.H": "---",
          OverTime: "---",
          "Tardy Count": meta?.runningLate ? meta.runningLate : "",
          Status: statusLabel,
          Deduction: deduction
        });
      } else {
        dayRecords.forEach((record: any, index: number) => {
          // Use the same formatting as the table
          rows.push({
            Day: day.weekday,
            Date: formatDateKey(day.dateKey),
            "Clock In": formatTime(record.clock_in),
            "Clock Out": formatTime(record.clock_out),
            "Total W.H": record.total_hours ? formatHoursMins(record.total_hours) : "---",
            "Assigned W.H": record.assigned_working_hours ? formatHoursMins(record.assigned_working_hours) : (record.assigned_shift_seconds ? formatDurationHM(record.assigned_shift_seconds) : "---"),
            OverTime: record.overtime ? formatDurationHM(record.overtime) : "---",
            "Tardy Count": meta?.runningLate ? meta.runningLate : "",
            Status: meta?.statusLabel || "",
            Deduction: meta?.deduction || ""
          });
        });
      }
    });
    // Calculate total deduction (same as in table)
    let totalDeduction = 0;
    rows.forEach((row) => {
      if (row.Deduction && typeof row.Deduction === 'string' && row.Deduction.endsWith('%')) {
        const val = parseFloat(row.Deduction.replace('%', ''));
        if (!isNaN(val)) totalDeduction += val;
      }
    });

    // Add summary rows for Total Deduction, Extra Hours, and Total Working Days
    rows.push(
      {
        Day: '',
        Date: '',
        "Clock In": '',
        "Clock Out": '',
        "Total W.H": '',
        "Assigned W.H": '',
        OverTime: '',
        "Tardy Count": '',
        Status: 'Total Deduction:',
        Deduction: `${totalDeduction}%`
      },
      {
        Day: '',
        Date: '',
        "Clock In": '',
        "Clock Out": '',
        "Total W.H": '',
        "Assigned W.H": '',
        OverTime: '',
        "Tardy Count": '',
        Status: 'Extra Hours:',
        Deduction: `${getEmployeeTotalOvertime(employee)}`
      },
      {
        Day: '',
        Date: '',
        "Clock In": '',
        "Clock Out": '',
        "Total W.H": '',
        "Assigned W.H": '',
        OverTime: '',
        "Tardy Count": '',
        Status: 'Total Working Days:',
        Deduction: `${getTotalWorkingDays(employee, monthInfo, approvedLeavesMap)}`
      }
    );

    // Add employee info as header rows ABOVE the table headers
    // First, extract table headers from the first data row
    const tableHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
    // Build a blank row for spacing
    const blankRow: any = {};
    tableHeaders.forEach(h => blankRow[h] = '');
    // Build header rows as objects with only first column filled
    const headerRows = [
      { [tableHeaders[0]]: `Employee Name: ${employee.employeeName}` },
      { [tableHeaders[0]]: `Pseudonym: ${employee.pseudonym}` },
      { [tableHeaders[0]]: `Department: ${employee.departmentName}` },
      blankRow
    ];
    // Add table headers as the next row
    const headerRowObj: any = {};
    tableHeaders.forEach(h => { headerRowObj[h] = h; });
    const allRows = [...headerRows, headerRowObj, ...rows];

    const worksheet = XLSX.utils.json_to_sheet(allRows, { skipHeader: true });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, employee.employeeName);
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 13 },
      { wch: 13 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 }
    ];
    const fileName = `attendance-${employee.employeeName.replace(/\s+/g, "_")}-${selectedMonth}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  const monthInfo = React.useMemo(() => {
    if (!selectedMonth) return { label: "", days: [] as { day: number; dateKey: string; weekday: string }[] };
    const [yearStr, monthStr] = selectedMonth.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    if (!year || monthIndex < 0) return { label: "", days: [] };
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const label = new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const dateKey = `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}`;
      const weekday = new Date(year, monthIndex, day).toLocaleDateString("en-US", { weekday: "short" });
      return { day, dateKey, weekday };
    });
    return { label, days };
  }, [selectedMonth]);

  // New logic: Always show all employees from DB, merge attendance if present
  const [allEmployees, setAllEmployees] = React.useState<any[]>([]);
  const [salaryMap, setSalaryMap] = React.useState<Record<string, number>>({});
  const [advanceSalaryMap, setAdvanceSalaryMap] = React.useState<Record<string, number>>({});
  const [loanSalaryMap, setLoanSalaryMap] = React.useState<Record<string, number>>({});
  // Fetch advance salary for selected month
  React.useEffect(() => {
    if (!selectedMonth) return;
    fetchAdvanceSalary(selectedMonth).then(setAdvanceSalaryMap);
    fetchLoanSalary(selectedMonth).then(setLoanSalaryMap);
  }, [selectedMonth]);

  // Fetch all employees and their salary (amount, any component)
  React.useEffect(() => {
    // Fetch all employees
    fetch('/api/employee-list')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.employees)) {
          setAllEmployees(data.employees);
        } else {
          setAllEmployees([]);
        }
      })
      .catch(() => setAllEmployees([]));
    // Fetch all salaries (all components, show amount)
    fetch('/api/employee_salaries/all')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.salaries)) {
          const map: Record<string, number> = {};
          data.salaries.forEach((row: any) => {
            if (row.employee_id && row.amount !== undefined) {
              map[String(row.employee_id)] = row.amount;
            }
          });
          setSalaryMap(map);
        }
      });
  }, []);

  const attendanceByEmployee = React.useMemo(() => {
    // Build attendance map as before
    const attMap: Record<string, {
      byDate: Record<string, any[]>;
      dateMeta: Record<string, { runningLate: number; statusLabel: string; statusColor: string; deduction: string }>;
      attendanceRecord: any;
    }> = {};
    attendance.forEach((record: any) => {
      if (!record.employee_id) return;
      const empId = record.employee_id;
      if (!attMap[empId]) {
        attMap[empId] = { byDate: {}, dateMeta: {}, attendanceRecord: record };
      }
      const dateKey = getRecordDateKey(record);
      if (!dateKey) return;
      if (!attMap[empId].byDate[dateKey]) attMap[empId].byDate[dateKey] = [];
      attMap[empId].byDate[dateKey].push(record);
    });
    // Calculate dateMeta as before
    Object.entries(attMap).forEach(([empId, employee]) => {
      const allRecords = Object.values(employee.byDate).flat();
      const sorted = [...allRecords].sort((a: any, b: any) => {
        const aKey = getRecordDateKey(a);
        const bKey = getRecordDateKey(b);
        return aKey.localeCompare(bKey);
      });
      let runningLate = 0;
      const seenDates = new Set<string>();
      sorted.forEach((record: any) => {
        const dateKey = getRecordDateKey(record);
        if (!dateKey || seenDates.has(dateKey)) return;
        seenDates.add(dateKey);
        let statusLabel = "On Time";
        let statusColor = "#276749";
        let deduction = "";
        if (record.is_late) {
          runningLate += 1;
          statusLabel = "Tardy";
          statusColor = "#E53E3E";
          if (runningLate === 4) statusLabel = "Half Day";
          else if (runningLate >= 5) statusLabel = "Full Day";
        }
        if (statusLabel === "Tardy") deduction = "0%";
        else if (statusLabel === "Half Day") deduction = "50%";
        else if (statusLabel === "Full Day") deduction = "100%";
        employee.dateMeta[dateKey] = { runningLate, statusLabel, statusColor, deduction };
      });
    });
    // Merge all employees with attendance
    return allEmployees.map(emp => {
      const empId = String(emp.id || emp.employee_id);
      const att = attMap[empId];
      // Always show salary from salaryMap (amount, any component)
      const basicSalary = salaryMap[empId];
      const allowOT = allowOvertimeMap[empId] !== false;
      return {
        employeeId: empId,
        employeeName: (emp.first_name && emp.last_name) ? `${emp.first_name} ${emp.last_name}` : (emp.employee_name || "-"),
        pseudonym: emp.pseudonym || "-",
        departmentName: emp.department_name || "-",
        basicSalary,
        allowOvertime: allowOT,
        byDate: att ? att.byDate : {},
        dateMeta: att ? att.dateMeta : {},
      };
    });
  }, [attendance, allEmployees, salaryMap, allowOvertimeMap]);

  // Calculate total overtime (extra hours) for the SELECTED MONTH ONLY for an employee
  function getEmployeeTotalOvertime(emp: any) {
    // If employee doesn't have overtime allowed, show "--"
    if (!emp.allowOvertime) {
      return "--";
    }
    
    let totalSeconds = 0;
    // Only sum overtime for dates in the selected month
    if (monthInfo.days && monthInfo.days.length > 0) {
      monthInfo.days.forEach((day) => {
        const records = emp.byDate[day.dateKey] || [];
        (records as any[]).forEach((record) => {
          if (record.overtime && typeof record.overtime === 'number' && record.overtime > 0) {
            totalSeconds += record.overtime;
          }
        });
      });
    }
    if (totalSeconds <= 0) return "-";
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
    return `${h}h ${m}m`;
  }

  // Calculate O.T Salary for the SELECTED MONTH ONLY for an employee
  function getEmployeeOTSalary(employee: any) {
    let otSalary = '--';
    // Check if overtime is allowed for this employee
    if (employee.allowOvertime && Object.keys(employee.byDate).length > 0) {
      // Get O.T seconds ONLY FOR SELECTED MONTH
      let totalOvertimeSeconds = 0;
      if (monthInfo.days && monthInfo.days.length > 0) {
        monthInfo.days.forEach((day) => {
          const records = employee.byDate[day.dateKey] || [];
          (records as any[]).forEach((record) => {
            if (record.overtime && typeof record.overtime === 'number' && record.overtime > 0) {
              totalOvertimeSeconds += record.overtime;
            }
          });
        });
      }
      // Convert seconds to hours (fractional)
      const overtimeHours = totalOvertimeSeconds / 3600;
      // Get working days
      const totalWorkingDays = getTotalWorkingDays(employee, monthInfo, approvedLeavesMap);
      // Get basic salary
      const basicSalary = employee.basicSalary;
      // Working hours per day: 5 if pseudonym is 'Developer', else 9
      let workingHoursPerDay = 9;
      if (employee.pseudonym && typeof employee.pseudonym === 'string' && employee.pseudonym.trim().toLowerCase() === 'developer') {
        workingHoursPerDay = 5;
      }
      if (basicSalary && totalWorkingDays && overtimeHours > 0) {
        const perHourSalary = basicSalary / totalWorkingDays / workingHoursPerDay;
        otSalary = Math.round(perHourSalary * overtimeHours).toString();
      }
    }
    return otSalary;
  }

  function formatAmountValue(value: number) {
    if (!Number.isFinite(value)) return "--";
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2).replace(/\.00$/, "");
  }

  // Display helper: add thousand separators (e.g. 1,000 / 10,000)
  function formatWithCommas(value: any) {
    if (value === null || value === undefined || value === "--" || value === "") return "--";
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (Number.isInteger(n)) return n.toLocaleString("en-US");
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function getCommissionAmount(employeeId: string | number, field: CommissionAmountField): number | null {
    const commissionData = commissionsMap[String(employeeId)];
    if (!commissionData) return null;
    const amount = Number(commissionData[field] ?? 0);
    return Number.isNaN(amount) ? 0 : amount;
  }

  function getCommissionDisplay(employeeId: string | number, field: CommissionAmountField) {
    const amount = getCommissionAmount(employeeId, field);
    if (amount === null) return "--";
    return formatAmountValue(amount);
  }

  function getEmployeeGrossSalary(employee: any) {
    const trainAmt = getCommissionAmount(employee.employeeId, "train_6h_amt");
    const arrears = getCommissionAmount(employee.employeeId, "arrears");
    const kpiAdd = getCommissionAmount(employee.employeeId, "kpi_add");
    const commission = getCommissionAmount(employee.employeeId, "commission");
    const existingClientIncentive = getCommissionAmount(employee.employeeId, "existing_client_incentive");
    const trainerIncentive = getCommissionAmount(employee.employeeId, "trainer_incentive");
    const floorIncentive = getCommissionAmount(employee.employeeId, "floor_incentive");

    const hasCommissionRow =
      trainAmt !== null ||
      arrears !== null ||
      kpiAdd !== null ||
      commission !== null ||
      existingClientIncentive !== null ||
      trainerIncentive !== null ||
      floorIncentive !== null;

    if (!hasCommissionRow) return "--";

    const basicSalary = Number(employee.basicSalary ?? 0) || 0;
    const otSalaryParsed = Number(getEmployeeOTSalary(employee));
    const otSalary = Number.isNaN(otSalaryParsed) ? 0 : otSalaryParsed;

    const grossSalary =
      basicSalary +
      otSalary +
      (trainAmt ?? 0) +
      (arrears ?? 0) +
      (kpiAdd ?? 0) +
      (commission ?? 0) +
      (existingClientIncentive ?? 0) +
      (trainerIncentive ?? 0) +
      (floorIncentive ?? 0);

    return formatAmountValue(grossSalary);
  }

  // Calculate Unpaid Days Salary for an employee
  // Developer (P.Name = 'Developer') ki shift 5 hours ki hai, baqi sab ki 9 hours ki hai.
  function getUnpaidDaysSalary(employee: any) {
    const basicSalary = Number(employee.basicSalary ?? 0);
    const totalWorkingDays = Object.keys(employee.byDate).length > 0 ? getTotalWorkingDays(employee, monthInfo, approvedLeavesMap) : 0;
    // Unpaid days = totalDeduction / 100
    const unpaidDays = Object.keys(employee.byDate).length > 0 ? (calculateTotalDeduction(employee) / 100) : 0;
    // Working hours per day logic:
    // Agar employee ka pseudonym (P.Name) 'Developer' hai to shift 5 hours ki hai.
    // Baqi sab employees ki shift 9 hours ki hai.
    let workingHoursPerDay = 9;
    if (employee.pseudonym && typeof employee.pseudonym === 'string' && employee.pseudonym.trim().toLowerCase() === 'developer') {
      workingHoursPerDay = 5;
    }
    // Formula: Daily Salary = Basic Salary / Total Working Days
    // Unpaid Days Salary = Daily Salary * Unpaid Days
    if (basicSalary > 0 && totalWorkingDays > 0 && unpaidDays > 0) {
      const dailySalary = basicSalary / totalWorkingDays;
      const unpaidDaysSalary = dailySalary * unpaidDays;
      return Math.round(unpaidDaysSalary).toString();
    }
    return '--';
  }

  // Filter attendanceByEmployee for table and export
  const filteredEmployees = attendanceByEmployee.filter((emp: any) => {
    const matchesName = searchName ? (emp.employeeName || "").toLowerCase().includes(searchName.toLowerCase()) : true;
    const matchesDept = selectedDepartment ? (emp.departmentName || "").toLowerCase() === selectedDepartment.toLowerCase() : true;
    return matchesName && matchesDept;
  });

  return (
    <LayoutDashboard>
      <div className={styles.attendanceSummaryContainer}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#22223B", margin: 0 }}>
            Monthly Payroll
          </h1>
          <p style={{ color: "#4A5568", fontSize: "0.9rem", marginTop: 4 }}>
            View and manage all employee payroll records
          </p>
        </div>

        <div className={styles.attendanceSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className={styles.attendanceSummaryInput}
          />
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className={styles.attendanceSummaryInput}
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.name || dept.department_name}>
                {dept.name || dept.department_name}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#4A5568', fontWeight: 500, whiteSpace: 'nowrap' }}>Month:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className={styles.attendanceSummaryDate}
              style={{ minWidth: '160px' }}
            />
          </div>
          <button
            onClick={() => {
              fetchAttendance();
              fetchCommissions(selectedMonth);
            }}
            className={styles.attendanceSummaryXLSButton}
            style={{ background: "linear-gradient(135deg, #0052CC 0%, #00B8A9 100%)" }}
          >
            Search
          </button>
          <button onClick={downloadExcel} className={styles.attendanceSummaryXLSButton}>
            <FaFileExcel /> Export Excel
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 20, color: "#4A5568", textAlign: "center" }}>
            Loading attendance records...
          </div>
        ) : null}

        {/* Cards summary (hidden, not deleted) */}
        {/*
        <div className={styles.attendanceCardsGrid}>
          {attendanceByEmployee.length === 0 ? (
            <div className={styles.attendanceSummaryNoRecords}>No attendance records found</div>
          ) : (
            attendanceByEmployee.map((employee) => (
              <div key={employee.employeeId} className={styles.attendanceEmployeeCard}>
                <div className={styles.attendanceEmployeeHeader}>
                  <div>
                    <div className={styles.attendanceEmployeeName}>{employee.employeeName}</div>
                    <div className={styles.attendanceEmployeeMeta}>
                      {employee.pseudonym} · {employee.departmentName}
                    </div>
                  </div>
                  <div className={styles.attendanceEmployeeActions}>
                    <div className={styles.attendanceEmployeeIdProminent}>Emp. ID {employee.employeeId}</div>
                  </div>
                </div>
                <div style={{ padding: 12 }}>
                  <div><b>T.Unpaid Days (Deduction):</b> {Object.keys(employee.byDate).length > 0 ? (() => { const val = calculateTotalDeduction(employee) / 100; return Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, ''); })() : '--'}</div>
                  <div><b>T.W Days:</b> {Object.keys(employee.byDate).length > 0 ? getTotalWorkingDays(employee, monthInfo, approvedLeavesMap) : '--'}</div>
                  <div><b>O.T Hours:</b> {Object.keys(employee.byDate).length > 0 ? getEmployeeTotalOvertime(employee) : '--'}</div>
                </div>
              </div>
            ))
          )}
        </div>
        */}

        <div style={{ marginTop: 40, position: 'relative', width: '100%', maxWidth: '100%', minWidth: 0 }}>
          <h3 style={{ color: '#22223B', marginBottom: 10 }}>{monthInfo.label && `Payroll for ${monthInfo.label}`}</h3>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '62vh', border: '1px solid #e2e8f0', borderRadius: 8, width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <table className={styles.payrollStickyHeaderTable} style={{ width: '1900px', tableLayout: 'auto', borderRadius: 8, background: '#fff', color: '#fff', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 12 }}>
              <tr>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '50px' }}>ID</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '140px' }}>Employee Name</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '100px' }}>Pseudonym</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '110px' }}>Department</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '100px' }}>Basic Salary</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '80px' }}>T.W Days</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '100px' }}>T.Unpaid Days</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '90px' }}>O.T Hours</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '90px' }}>O.T Salary</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '100px' }}>6H Train Amt</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '90px' }}>Arrears</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '80px' }}>KPI Add</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '100px' }}>Commission</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '160px' }}>Existing Client Incentive</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '120px' }}>Trainer Incentive</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '110px' }}>Floor Incentive</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '100px' }}>Gross Salary</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '110px' }}>Unpaid Days Salary</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '110px' }}>Break Exceed Ded.</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '90px' }}>KPIs Ded.</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '120px' }}>Other Ded (fine,etc.)</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '120px' }}>Loan/Advance</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '120px' }}>Total Deductions</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '140px' }}>Net. Salary before Tax</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '80px' }}>Tax</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '120px' }}>Net Salary</th>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', width: '120px' }}>Final Salary</th>
              </tr>
            </thead>
            <tbody style={{ background: '#fff', color: '#22223B' }}>
              {filteredEmployees && filteredEmployees.length > 0 ? (
                filteredEmployees.map((employee) => {
                  const advSalary = advanceSalaryMap[employee.employeeId];
                  const loanSalary = loanSalaryMap[employee.employeeId];
                  const adv = Number(advSalary ?? 0);
                  const loan = Number(loanSalary ?? 0);
                  const hasAdv = advSalary !== undefined && Number.isFinite(adv);
                  const hasLoan = loanSalary !== undefined && Number.isFinite(loan);
                  const loanAdvanceValue =
                    hasAdv || hasLoan
                      ? (hasAdv ? adv : 0) + (hasLoan ? loan : 0)
                      : "--";
                  return (
                    <tr key={employee.employeeId} style={{ background: '#fff', color: '#22223B' }}>
                      <td style={{ padding: '10px 8px', width: '50px' }}>{employee.employeeId}</td>
                      <td style={{ padding: '10px 8px', width: '140px' }}>{employee.employeeName}</td>
                      <td style={{ padding: '10px 8px', width: '100px' }}>{employee.pseudonym}</td>
                      <td style={{ padding: '10px 8px', width: '110px' }}>{employee.departmentName}</td>
                      <td style={{ padding: '10px 8px', width: '100px', color: '#00A651', fontWeight: 600 }}>{employee.basicSalary !== undefined ? formatWithCommas(employee.basicSalary) : '--'}</td>
                      <td style={{ padding: '10px 8px', width: '80px' }}>{Object.keys(employee.byDate).length > 0 ? getTotalWorkingDays(employee, monthInfo, approvedLeavesMap) : '--'}</td>
                      <td style={{ padding: '10px 8px', width: '100px', color: '#FF1F1F', fontWeight: 600 }}>{Object.keys(employee.byDate).length > 0 ? (() => { const val = calculateTotalDeduction(employee) / 100; return Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, ''); })() : '--'}</td>
                      <td style={{ padding: '10px 8px', width: '90px', color: '#00A651', fontWeight: 600 }}>{Object.keys(employee.byDate).length > 0 ? getEmployeeTotalOvertime(employee) : '--'}</td>
                      <td style={{ padding: '10px 8px', width: '90px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getEmployeeOTSalary(employee))}</td>
                      <td style={{ padding: '10px 8px', width: '100px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "train_6h_amt"))}</td>
                      <td style={{ padding: '10px 8px', width: '90px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "arrears"))}</td>
                      <td style={{ padding: '10px 8px', width: '80px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "kpi_add"))}</td>
                      <td style={{ padding: '10px 8px', width: '100px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "commission"))}</td>
                      <td style={{ padding: '10px 8px', width: '160px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "existing_client_incentive"))}</td>
                      <td style={{ padding: '10px 8px', width: '120px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "trainer_incentive"))}</td>
                      <td style={{ padding: '10px 8px', width: '110px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "floor_incentive"))}</td>
                      <td style={{ padding: '10px 8px', width: '100px', color: '#00A651', fontWeight: 600 }}>{formatWithCommas(getEmployeeGrossSalary(employee))}</td>
                      <td style={{ padding: '10px 8px', width: '110px', color: '#FF1F1F', fontWeight: 600 }}>{formatWithCommas(getUnpaidDaysSalary(employee))}</td>
                      <td style={{ padding: '10px 8px', width: '110px', color: '#FF1F1F', fontWeight: 600 }}>{'--'}</td>
                      <td style={{ padding: '10px 8px', width: '90px', color: '#FF1F1F', fontWeight: 600 }}>{'--'}</td>
                      <td style={{ padding: '10px 8px', width: '120px', color: '#FF1F1F', fontWeight: 600 }}>{'--'}</td>
                      <td style={{ padding: '10px 8px', width: '120px', color: '#FF1F1F', fontWeight: 600 }}>{formatWithCommas(loanAdvanceValue)}</td>
                      <td style={{ padding: '10px 8px', width: '120px', color: '#FF1F1F', fontWeight: 600 }}>{'--'}</td>
                      <td style={{ padding: '10px 8px', width: '140px', color: '#FF1F1F', fontWeight: 600 }}>{'--'}</td>
                      <td style={{ padding: '10px 8px', width: '80px', color: '#FF1F1F', fontWeight: 600 }}>{'--'}</td>
                      <td style={{ padding: '10px 8px', width: '120px', color: '#00A651', fontWeight: 600 }}>{'--'}</td>
                      <td style={{ padding: '10px 8px', width: '120px', color: '#00A651', fontWeight: 600 }}>{'--'}</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={27} style={{ textAlign: 'center', padding: 16 }}>No records found</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </LayoutDashboard>
  );
}

