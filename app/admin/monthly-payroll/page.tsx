"use client";

import React, { useEffect, useState } from "react";
import { fetchAdvanceSalary } from "./advanceSalaryUtils";
import { fetchLoanSalary } from "./loanSalaryUtils";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../break-summary/break-summary.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
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



/** Extra work beyond assigned shift before OT is shown/counted (1 hour) — same as Monthly Attendance */
const OVERTIME_MIN_SECONDS = 60 * 60;

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

  /** Paid hours for OT rate: ~5h shift → 5; normal shift → 9. */
  function getPaidHoursPerDayFromShift(
    shiftStart: string | null | undefined,
    shiftEnd: string | null | undefined
  ): number {
    const secs = getAssignedShiftSeconds(shiftStart, shiftEnd);
    if (secs == null || secs <= 0) return 9;
    const hours = secs / 3600;
    // Short shifts (e.g. developer) are ~5h
    if (hours <= 5.5) return 5;
    return 9;
  }

  // Calculate overtime — ≥1h past assigned shift (match production Monthly Attendance)
  function calculateOvertime(
    totalSeconds: number,
    assignedShiftSeconds: number | null,
  ): number | null {
    if (!assignedShiftSeconds || assignedShiftSeconds <= 0) return null;
    const overtime = totalSeconds - assignedShiftSeconds;
    if (overtime >= OVERTIME_MIN_SECONDS) return overtime;
    return null;
  }

  /** Sum OT the same way Monthly Attendance Extra Hours does: floor each day to h/m then add minutes */
  function sumEmployeeOvertimeMinutes(employee: any, days: { dateKey: string }[] | undefined): number {
    let totalMinutes = 0;
    if (!days?.length) return 0;
    days.forEach((day) => {
      const records = employee.byDate?.[day.dateKey] || [];
      (records as any[]).forEach((record) => {
        const label = formatDurationHM(record.overtime);
        if (!label || label === "-") return;
        const match = label.match(/(\d+)\s*h\s*(\d+)\s*m/i);
        if (!match) return;
        totalMinutes += parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      });
    });
    return totalMinutes;
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
  /** employee_id → paid hours/day for OT (5 or 8) from shift assignment */
  const [paidHoursPerDayMap, setPaidHoursPerDayMap] = useState<Record<string, number>>({});
  
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
  /** Editable tax + manual deductions per employee — Final updates live when changed */
  const [taxByEmployee, setTaxByEmployee] = useState<Record<string, number>>({});
  const [breakExceedDedByEmployee, setBreakExceedDedByEmployee] = useState<Record<string, number>>({});
  const [kpisDedByEmployee, setKpisDedByEmployee] = useState<Record<string, number>>({});
  const [otherDedByEmployee, setOtherDedByEmployee] = useState<Record<string, number>>({});
  /** CTD + Fuel + Unpaid days — persisted in monthly_payroll_adjustments */
  const [ctdByEmployee, setCtdByEmployee] = useState<Record<string, number>>({});
  const [fuelByEmployee, setFuelByEmployee] = useState<Record<string, number>>({});
  /** Override map; missing key = use system-calculated unpaid days */
  const [unpaidDaysByEmployee, setUnpaidDaysByEmployee] = useState<Record<string, number>>({});
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  function setManualAmount(
    setter: React.Dispatch<React.SetStateAction<Record<string, number>>>,
    employeeId: string,
    raw: string
  ) {
    const next = Number(raw);
    setter((prev) => ({
      ...prev,
      [employeeId]: Number.isFinite(next) && next > 0 ? next : 0,
    }));
  }

  function parsePositiveMoney(raw: string | number | undefined): number {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function parseUnpaidDaysValue(raw: string | number | undefined): number {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /** Monthly override if saved; otherwise employee default fuel from Allowances. */
  function getFuelAllowanceForEmployee(employee: { employeeId?: string }) {
    const empId = String(employee.employeeId ?? "");
    if (Object.prototype.hasOwnProperty.call(fuelByEmployee, empId)) {
      return fuelByEmployee[empId] ?? 0;
    }
    return defaultFuelByEmployee[empId] ?? 0;
  }

  /** Monthly override if saved; otherwise employee default CTD from Allowances. */
  function getCtdForEmployee(employee: { employeeId?: string }) {
    const empId = String(employee.employeeId ?? "");
    if (Object.prototype.hasOwnProperty.call(ctdByEmployee, empId)) {
      return ctdByEmployee[empId] ?? 0;
    }
    return defaultCtdByEmployee[empId] ?? 0;
  }

  /** System unpaid days from attendance deduction % (e.g. 400% → 4 days). */
  function getSystemUnpaidDays(employee: any): number {
    const hasAttendance = Object.keys(employee.byDate || {}).length > 0;
    if (!hasAttendance) return 0;
    return calculateTotalDeduction(employee) / 100;
  }

  /** HR override if saved; otherwise system-calculated value. */
  function getUnpaidDaysForEmployee(employee: any): number {
    const empId = String(employee.employeeId ?? "");
    if (Object.prototype.hasOwnProperty.call(unpaidDaysByEmployee, empId)) {
      return unpaidDaysByEmployee[empId] ?? 0;
    }
    return getSystemUnpaidDays(employee);
  }

  function setUnpaidDaysAmount(employeeId: string, raw: string) {
    setUnpaidDaysByEmployee((prev) => ({
      ...prev,
      [employeeId]: parseUnpaidDaysValue(raw),
    }));
  }

  function saveUnpaidDaysAmount(employeeId: string, raw?: string) {
    if (!selectedMonth) return;
    const unpaid_days =
      raw !== undefined
        ? parseUnpaidDaysValue(raw)
        : (unpaidDaysByEmployee[employeeId] ?? 0);
    void fetch("/api/monthly-payroll-adjustments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: employeeId, month: selectedMonth, unpaid_days }),
    }).catch((err) => console.error("Unpaid days save failed", err));
  }

  function setFuelAmount(employeeId: string, raw: string) {
    setFuelByEmployee((prev) => ({ ...prev, [employeeId]: parsePositiveMoney(raw) }));
  }

  function saveFuelAmount(employeeId: string, raw?: string) {
    if (!selectedMonth) return;
    const fuel_allowance =
      raw !== undefined ? parsePositiveMoney(raw) : (fuelByEmployee[employeeId] ?? 0);
    void fetch("/api/monthly-payroll-adjustments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: employeeId, month: selectedMonth, fuel_allowance }),
    }).catch((err) => console.error("Fuel save failed", err));
  }

  function setCtdAmount(employeeId: string, raw: string) {
    setCtdByEmployee((prev) => ({ ...prev, [employeeId]: parsePositiveMoney(raw) }));
  }

  function saveCtdAmount(employeeId: string, raw?: string) {
    if (!selectedMonth) return;
    const ctd =
      raw !== undefined ? parsePositiveMoney(raw) : (ctdByEmployee[employeeId] ?? 0);
    void fetch("/api/monthly-payroll-adjustments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: employeeId, month: selectedMonth, ctd }),
    }).catch((err) => console.error("CTD save failed", err));
  }

  const manualInputStyle: React.CSSProperties = {
    width: 88,
    padding: "4px 6px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontWeight: 600,
    color: "#dc2626",
  };

  const fuelInputStyle: React.CSSProperties = {
    ...manualInputStyle,
    color: "#007a5a",
  };

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
            // Calculate overtime using assigned shift seconds (same as Monthly Attendance / 10.40)
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

  // Fetch shift assignment allow_overtime + paid hours/day from shift timings
  const fetchOverTimeSettings = async () => {
    try {
      const response = await fetch("/api/hrm-shifts-assignments", { cache: "no-store" });
      const data = await response.json();

      if (data.success && data.employees) {
        const otMap: Record<string, boolean> = {};
        const hoursMap: Record<string, number> = {};
        data.employees.forEach((emp: any) => {
          const empId = String(emp.id);
          // Latest assignment (returned by API) determines OT allowance
          if (emp.allow_overtime !== undefined && emp.allow_overtime !== null) {
            otMap[empId] = emp.allow_overtime === 1 || emp.allow_overtime === true;
          }
          hoursMap[empId] = getPaidHoursPerDayFromShift(emp.start_time, emp.end_time);
        });
        setAllowOvertimeMap(otMap);
        setPaidHoursPerDayMap(hoursMap);
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
    if (!selectedMonth) {
      setCtdByEmployee({});
      setFuelByEmployee({});
      setUnpaidDaysByEmployee({});
      return;
    }
    let cancelled = false;
    fetch(`/api/monthly-payroll-adjustments?month=${encodeURIComponent(selectedMonth)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const ctdMap: Record<string, number> = {};
        const fuelMap: Record<string, number> = {};
        const unpaidMap: Record<string, number> = {};
        if (data.success && Array.isArray(data.adjustments)) {
          data.adjustments.forEach(
            (row: {
              employee_id?: string | number;
              ctd?: number | null;
              fuel_allowance?: number | null;
              unpaid_days?: number | null;
            }) => {
              const id = String(row.employee_id ?? "").trim();
              if (!id) return;
              if (row.ctd !== null && row.ctd !== undefined) {
                ctdMap[id] = parsePositiveMoney(row.ctd);
              }
              if (row.fuel_allowance !== null && row.fuel_allowance !== undefined) {
                fuelMap[id] = parsePositiveMoney(row.fuel_allowance);
              }
              if (row.unpaid_days !== null && row.unpaid_days !== undefined) {
                unpaidMap[id] = parseUnpaidDaysValue(row.unpaid_days);
              }
            }
          );
        }
        setCtdByEmployee(ctdMap);
        setFuelByEmployee(fuelMap);
        setUnpaidDaysByEmployee(unpaidMap);
      })
      .catch((err) => {
        console.error("Payroll adjustments fetch failed", err);
        if (!cancelled) {
          setCtdByEmployee({});
          setFuelByEmployee({});
          setUnpaidDaysByEmployee({});
        }
      });
    return () => {
      cancelled = true;
    };
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
    const dataToExport = filteredEmployees.map(emp => {
      const row = getPayrollBreakdown(emp, {
        taxAmount: taxByEmployee[emp.employeeId] ?? 0,
        breakExceedDed: breakExceedDedByEmployee[emp.employeeId] ?? 0,
        kpisDed: kpisDedByEmployee[emp.employeeId] ?? 0,
        otherDed: otherDedByEmployee[emp.employeeId] ?? 0,
        ctd: getCtdForEmployee(emp),
        fuelAllowance: getFuelAllowanceForEmployee(emp),
        unpaidDays: getUnpaidDaysForEmployee(emp),
      });
      return {
      "ID": emp.employeeId,
      "Employee Name": emp.employeeName,
      "Pseudonym": emp.pseudonym,
      "Department": emp.departmentName,
      "Basic Salary": row.basicSalary || '--',
      "Fuel Allowance": row.fuelAllowance || 0,
      "T.W Days": row.workingDays || '--',
      "T.Unpaid Days": row.unpaidDaysDisplay,
      "O. T Hours": row.otHoursLabel,
      "O. T Salary": row.otSalary,
      "6H Train Amt": getCommissionDisplay(emp.employeeId, "train_6h_amt"),
      "Arrears": getCommissionDisplay(emp.employeeId, "arrears"),
      "KPI Add": getCommissionDisplay(emp.employeeId, "kpi_add"),
      "Commission": getCommissionDisplay(emp.employeeId, "commission"),
      "Existing Client Incentive": getCommissionDisplay(emp.employeeId, "existing_client_incentive"),
      "Trainer Incentive": getCommissionDisplay(emp.employeeId, "trainer_incentive"),
      "Floor Incentive": getCommissionDisplay(emp.employeeId, "floor_incentive"),
      "Gross Salary": row.grossSalary,
      "Unpaid Days Salary": row.unpaidDaysSalary,
      "Break Exceed Ded.": row.breakExceedDed,
      "KPIs Ded.": row.kpisDed,
      "Other Ded": row.otherDed,
      "CTD": row.ctd,
      "Loan/Advance": row.loanAdvance,
      "Total Deductions": row.totalDeductions,
      "Net before Tax": row.netBeforeTax,
      "Tax": row.tax,
      "Net Salary": row.netSalary,
      "Final Salary": row.finalSalary,
    };
    });

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
  /** Default fuel / CTD from Add Employee → Allowances */
  const [defaultFuelByEmployee, setDefaultFuelByEmployee] = React.useState<Record<string, number>>({});
  const [defaultCtdByEmployee, setDefaultCtdByEmployee] = React.useState<Record<string, number>>({});
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
          const fuelDefaults: Record<string, number> = {};
          const ctdDefaults: Record<string, number> = {};
          data.salaries.forEach((row: any) => {
            if (row.employee_id != null && row.amount !== undefined && row.amount !== null) {
              const amt = Number(row.amount);
              if (Number.isFinite(amt) && amt > 0) {
                map[String(row.employee_id)] = amt;
              }
            }
            if (row.employee_id != null && row.fuel_allowance != null && row.fuel_allowance !== "") {
              const fuel = Number(row.fuel_allowance);
              if (Number.isFinite(fuel) && fuel > 0) {
                fuelDefaults[String(row.employee_id)] = fuel;
              }
            }
            if (
              row.employee_id != null &&
              row.company_transport_deduction != null &&
              row.company_transport_deduction !== ""
            ) {
              const ctd = Number(row.company_transport_deduction);
              if (Number.isFinite(ctd) && ctd > 0) {
                ctdDefaults[String(row.employee_id)] = ctd;
              }
            }
          });
          setSalaryMap(map);
          setDefaultFuelByEmployee(fuelDefaults);
          setDefaultCtdByEmployee(ctdDefaults);
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
      const allowOT = allowOvertimeMap[empId] === true;
      const paidHoursPerDay = paidHoursPerDayMap[empId] ?? 9;
      return {
        employeeId: empId,
        employeeName: (emp.first_name && emp.last_name) ? `${emp.first_name} ${emp.last_name}` : (emp.employee_name || "-"),
        pseudonym: emp.pseudonym || "-",
        departmentName: emp.department_name || "-",
        basicSalary,
        allowOvertime: allowOT,
        paidHoursPerDay,
        byDate: att ? att.byDate : {},
        dateMeta: att ? att.dateMeta : {},
      };
    });
  }, [attendance, allEmployees, salaryMap, allowOvertimeMap, paidHoursPerDayMap]);

  // Calculate total overtime (extra hours) for the SELECTED MONTH — same rules as Monthly Attendance
  function getEmployeeTotalOvertime(emp: any) {
    // If employee doesn't have overtime allowed, show "--"
    if (!emp.allowOvertime) {
      return "--";
    }

    const totalMinutes = sumEmployeeOvertimeMinutes(emp, monthInfo.days);
    if (totalMinutes <= 0) return "-";
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const m = (totalMinutes % 60).toString().padStart(2, "0");
    return `${h}h ${m}m`;
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
    if (amount === null) return "0";
    return formatAmountValue(amount);
  }

  function parseMoneyCell(value: any): number {
    if (value === null || value === undefined || value === "--" || value === "-" || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function formatOtHoursLabel(hours: number) {
    if (!(hours > 0)) return "0h 00m";
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  }

  /**
   * Full payroll row from live system data.
   * OT: Per hour = Basic ÷ Working Days ÷ Hours/Day; OT Salary = Per hour × OT hours.
   * Final = Gross − Total Deductions − Tax. Manual columns (Fuel, CTD, etc.) feed live.
   */
  function getPayrollBreakdown(
    employee: any,
    opts: {
      taxAmount?: number;
      breakExceedDed?: number;
      kpisDed?: number;
      otherDed?: number;
      ctd?: number;
      fuelAllowance?: number;
      unpaidDays?: number;
    } = {}
  ) {
    const taxAmount = opts.taxAmount ?? 0;
    const hasAttendance = Object.keys(employee.byDate || {}).length > 0;

    const basicSalary = Number(employee.basicSalary ?? 0) || 0;
    const fuelAllowance =
      opts.fuelAllowance !== undefined
        ? parsePositiveMoney(opts.fuelAllowance)
        : 0;
    const paidHoursPerDay =
      Number(employee.paidHoursPerDay) > 0 ? Number(employee.paidHoursPerDay) : 9;

    const workingDays = hasAttendance
      ? getTotalWorkingDays(employee, monthInfo, approvedLeavesMap)
      : 0;

    const systemUnpaidDays = hasAttendance ? calculateTotalDeduction(employee) / 100 : 0;
    const unpaidDays =
      opts.unpaidDays !== undefined
        ? parseUnpaidDaysValue(opts.unpaidDays)
        : systemUnpaidDays;

    let otHours = 0;
    let otHoursLabel = "--";
    if (!employee.allowOvertime) {
      otHoursLabel = "--";
    } else if (hasAttendance) {
      const totalMinutes = sumEmployeeOvertimeMinutes(employee, monthInfo.days);
      const otH = Math.floor(totalMinutes / 60);
      const otM = totalMinutes % 60;
      otHours = otH + otM / 60;
      otHoursLabel = totalMinutes > 0 ? formatOtHoursLabel(otHours) : "0h 00m";
    }

    let otSalary = 0;
    if (employee.allowOvertime !== false) {
      if (basicSalary > 0 && workingDays > 0 && otHours > 0) {
        const perHourRate = basicSalary / workingDays / paidHoursPerDay;
        otSalary = Math.round(perHourRate * otHours);
      }
    }

    const trainAmt = getCommissionAmount(employee.employeeId, "train_6h_amt") ?? 0;
    const arrears = getCommissionAmount(employee.employeeId, "arrears") ?? 0;
    const kpiAdd = getCommissionAmount(employee.employeeId, "kpi_add") ?? 0;
    const commission = getCommissionAmount(employee.employeeId, "commission") ?? 0;
    const existingClientIncentive = getCommissionAmount(employee.employeeId, "existing_client_incentive") ?? 0;
    const trainerIncentive = getCommissionAmount(employee.employeeId, "trainer_incentive") ?? 0;
    const floorIncentive = getCommissionAmount(employee.employeeId, "floor_incentive") ?? 0;

    const grossSalary =
      basicSalary +
      fuelAllowance +
      otSalary +
      trainAmt +
      arrears +
      kpiAdd +
      commission +
      existingClientIncentive +
      trainerIncentive +
      floorIncentive;

    const unpaidDaysSalary =
      basicSalary > 0 && workingDays > 0 && unpaidDays > 0
        ? Math.round((basicSalary / workingDays) * unpaidDays)
        : 0;

    const breakExceedDed = Number.isFinite(opts.breakExceedDed) && (opts.breakExceedDed as number) > 0
      ? (opts.breakExceedDed as number)
      : 0;
    const kpisDed = Number.isFinite(opts.kpisDed) && (opts.kpisDed as number) > 0
      ? (opts.kpisDed as number)
      : 0;
    const otherDed = Number.isFinite(opts.otherDed) && (opts.otherDed as number) > 0
      ? (opts.otherDed as number)
      : 0;
    const ctd = Number.isFinite(opts.ctd) && (opts.ctd as number) > 0
      ? (opts.ctd as number)
      : 0;

    const adv = Number(advanceSalaryMap[employee.employeeId] ?? 0);
    const loan = Number(loanSalaryMap[employee.employeeId] ?? 0);
    const loanAdvance =
      (Number.isFinite(adv) ? adv : 0) + (Number.isFinite(loan) ? loan : 0);

    const totalDeductions =
      unpaidDaysSalary + breakExceedDed + kpisDed + otherDed + ctd + loanAdvance;

    const netBeforeTax = grossSalary - totalDeductions;
    const tax = Number.isFinite(taxAmount) && taxAmount > 0 ? taxAmount : 0;
    const netSalary = netBeforeTax - tax;
    const finalSalary = netSalary;

    const unpaidDaysDisplay = Number.isInteger(unpaidDays)
      ? String(unpaidDays)
      : unpaidDays.toFixed(1).replace(/\.0$/, "");

    return {
      basicSalary,
      fuelAllowance,
      workingDays,
      unpaidDays,
      unpaidDaysDisplay,
      otHours,
      otHoursLabel,
      otSalary,
      grossSalary,
      unpaidDaysSalary,
      breakExceedDed,
      kpisDed,
      otherDed,
      ctd,
      loanAdvance,
      totalDeductions,
      netBeforeTax,
      tax,
      netSalary,
      finalSalary,
    };
  }

  function getEmployeeOTSalary(employee: any) {
    return String(getPayrollBreakdown(employee).otSalary);
  }

  function getEmployeeGrossSalary(employee: any) {
    const g = getPayrollBreakdown(employee).grossSalary;
    return g > 0 ? formatAmountValue(g) : "--";
  }

  function getUnpaidDaysSalary(employee: any) {
    return String(getPayrollBreakdown(employee).unpaidDaysSalary);
  }

  // Filter attendanceByEmployee for table and export
  const filteredEmployees = attendanceByEmployee.filter((emp: any) => {
    const matchesName = searchName ? (emp.employeeName || "").toLowerCase().includes(searchName.toLowerCase()) : true;
    const matchesDept = selectedDepartment ? (emp.departmentName || "").toLowerCase() === selectedDepartment.toLowerCase() : true;
    return matchesName && matchesDept;
  });

  return (
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer}>
        <div style={{ marginBottom: 20 }}>
          <h1 className={styles.pageTitle}>Monthly Payroll</h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            View and manage all employee payroll records
          </p>
        </div>

        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className={styles.breakSummaryInput}
          />
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className={styles.breakSummaryInput}
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.name || dept.department_name}>
                {dept.name || dept.department_name}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>Month:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className={styles.breakSummaryDate}
              style={{ minWidth: '160px' }}
            />
          </div>
          <button
            onClick={() => {
              fetchAttendance();
              fetchCommissions(selectedMonth);
            }}
            className={styles.breakSummaryXLSButton}
          >
            Search
          </button>
          <button onClick={downloadExcel} className={styles.breakSummaryXLSButton}>
            <FaFileExcel /> Export Excel
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 20, color: "#64748b", textAlign: "center" }}>
            Loading attendance records...
          </div>
        ) : null}

        <div style={{ marginTop: 24 }}>
          <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginBottom: 12 }}>
            {monthInfo.label && `Payroll for ${monthInfo.label}`}
          </h3>
          <div className={styles.breakSummaryTableWrapper}>
          <table className={styles.breakSummaryTable} style={{ minWidth: 2000 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Employee Name</th>
                <th>Pseudonym</th>
                <th>Department</th>
                <th>Basic Salary</th>
                <th>Fuel Allowance</th>
                <th>T.W Days</th>
                <th>T.Unpaid Days</th>
                <th>O.T Hours</th>
                <th>O.T Salary</th>
                <th>6H Train Amt</th>
                <th>Arrears</th>
                <th>KPI Add</th>
                <th>Commission</th>
                <th>Existing Client Incentive</th>
                <th>Trainer Incentive</th>
                <th>Floor Incentive</th>
                <th>Gross Salary</th>
                <th>Unpaid Days Salary</th>
                <th>Break Exceed Ded.</th>
                <th>KPIs Ded.</th>
                <th>Other Ded (fine,etc.)</th>
                <th>CTD</th>
                <th>Loan/Advance</th>
                <th>Total Deductions</th>
                <th>Net. Salary before Tax</th>
                <th>Tax</th>
                <th>Net Salary</th>
                <th>Final Salary</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees && filteredEmployees.length > 0 ? (
                filteredEmployees.map((employee) => {
                  const empId = employee.employeeId;
                  const taxVal = taxByEmployee[empId] ?? 0;
                  const breakVal = breakExceedDedByEmployee[empId] ?? 0;
                  const kpisVal = kpisDedByEmployee[empId] ?? 0;
                  const otherVal = otherDedByEmployee[empId] ?? 0;
                  const ctdVal = getCtdForEmployee(employee);
                  const fuelVal = getFuelAllowanceForEmployee(employee);
                  const unpaidVal = getUnpaidDaysForEmployee(employee);
                  const row = getPayrollBreakdown(employee, {
                    taxAmount: taxVal,
                    breakExceedDed: breakVal,
                    kpisDed: kpisVal,
                    otherDed: otherVal,
                    ctd: ctdVal,
                    fuelAllowance: fuelVal,
                    unpaidDays: unpaidVal,
                  });
                  return (
                    <tr key={employee.employeeId}>
                      <td className={styles.cellMuted}>{employee.employeeId}</td>
                      <td>
                        <EmployeeTableNameCell
                          name={employee.employeeName}
                          employeeId={employee.employeeId}
                          photo={getPhoto(employee.employeeId)}
                          onOpen={() =>
                            openFromRow({
                              employee_id: employee.employeeId,
                              employee_name: employee.employeeName,
                              pseudonym: employee.pseudonym,
                              department_name: employee.departmentName,
                            })
                          }
                        />
                      </td>
                      <td>{employee.pseudonym}</td>
                      <td>{employee.departmentName}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>
                        {row.basicSalary > 0 ? formatWithCommas(row.basicSalary) : '--'}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={fuelVal}
                          onChange={(e) => setFuelAmount(empId, e.target.value)}
                          onBlur={(e) => saveFuelAmount(empId, e.target.value)}
                          style={fuelInputStyle}
                          title="Fuel Allowance — editable, saved for this month"
                        />
                      </td>
                      <td>{row.workingDays > 0 ? row.workingDays : '--'}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={unpaidVal}
                          onChange={(e) => setUnpaidDaysAmount(empId, e.target.value)}
                          onBlur={(e) => saveUnpaidDaysAmount(empId, e.target.value)}
                          style={manualInputStyle}
                          title={`System unpaid days: ${getSystemUnpaidDays(employee)} — editable override`}
                        />
                      </td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{row.otHoursLabel}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(row.otSalary)}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "train_6h_amt"))}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "arrears"))}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "kpi_add"))}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "commission"))}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "existing_client_incentive"))}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "trainer_incentive"))}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(getCommissionDisplay(employee.employeeId, "floor_incentive"))}</td>
                      <td style={{ color: '#007a5a', fontWeight: 700 }}>{formatWithCommas(row.grossSalary)}</td>
                      <td style={{ color: '#dc2626', fontWeight: 600 }}>{formatWithCommas(row.unpaidDaysSalary)}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={breakVal}
                          onChange={(e) => setManualAmount(setBreakExceedDedByEmployee, empId, e.target.value)}
                          style={manualInputStyle}
                          title="Break Exceed Ded. — totals update live"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={kpisVal}
                          onChange={(e) => setManualAmount(setKpisDedByEmployee, empId, e.target.value)}
                          style={manualInputStyle}
                          title="KPIs Ded. — totals update live"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={otherVal}
                          onChange={(e) => setManualAmount(setOtherDedByEmployee, empId, e.target.value)}
                          style={manualInputStyle}
                          title="Other Ded — totals update live"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={ctdVal}
                          onChange={(e) => setCtdAmount(empId, e.target.value)}
                          onBlur={(e) => saveCtdAmount(empId, e.target.value)}
                          style={manualInputStyle}
                          title="CTD — editable; default from Allowances, saved for this month when changed"
                        />
                      </td>
                      <td style={{ color: '#dc2626', fontWeight: 600 }}>{formatWithCommas(row.loanAdvance)}</td>
                      <td style={{ color: '#dc2626', fontWeight: 600 }}>{formatWithCommas(row.totalDeductions)}</td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(row.netBeforeTax)}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={taxVal}
                          onChange={(e) => setManualAmount(setTaxByEmployee, empId, e.target.value)}
                          style={manualInputStyle}
                          title="Tax — Final updates when you change this"
                        />
                      </td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(row.netSalary)}</td>
                      <td style={{ color: '#007a5a', fontWeight: 700 }}>{formatWithCommas(row.finalSalary)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={29} className={styles.breakSummaryNoRecords}>No records found</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
      {popup}
    </LayoutDashboard>
  );
}

