"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchAdvanceSalary, fetchPayrollLoanAdvance } from "./advanceSalaryUtils";
import { fetchLoanSalary } from "./loanSalaryUtils";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { FaFileExcel, FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import finalizeModal from "./finalize-modal.module.css";
import fh from "../employee-financial-history/financial-history.module.css";
import { orgDeptChipLabel } from "@/app/admin/roles-permissions/system-control-data";
import * as XLSX from 'xlsx';
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
import { resolveBillableOvertimeSeconds, isOvertimeAllowed } from "../../../lib/attendance-overtime";
import {
  deductionForAttendanceStatus,
  normalizeAttendanceStatus,
} from "../../../lib/attendance-status";
import {
  approvedLeaveOnDay,
  attendanceFromApprovedLeaveDay,
  buildApprovedLeavesMap,
  type ApprovedLeavesMap,
} from "../../../lib/leave-duration";
import {
  aggregateDayPunches,
  classifyDayAttendance,
  STATUS_FIRST_HALF_DAY,
  STATUS_SECOND_HALF_DAY,
} from "../../../lib/monthly-attendance-status";
import { compareAttendanceRows } from "../../../lib/attendance-sort";
import {
  medicalDeductionForPackage,
  normalizeMedicalPackage,
  type MedicalPackageId,
} from "@/lib/medical-package";
import { monthlySalaryTaxFromGross } from "@/lib/pakistan-salary-tax";

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
    // Month working days: Mon–Fri (or calendar "working"), minus calendar "off" only.
    // Full-day leave does NOT reduce this — leave stays paid against the month base.
    function getTotalWorkingDays(monthInfo: any) {
      let count = 0;
      if (!monthInfo || !monthInfo.days) return count;
      monthInfo.days.forEach((day: any) => {
        if (isWorkingDay(day.dateKey)) count++;
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

  /**
   * Paid hours/day for per-hour rate (Basic ÷ W.Days ÷ hours).
   * From employee profile Working Hours; default 9 when missing/invalid.
   */
  function getPaidHoursPerDayFromProfile(workingHours: unknown): number {
    const n = Number(workingHours);
    if (Number.isFinite(n) && n > 0) return n;
    return 9;
  }

  /**
   * Per-hour rate: Basic ÷ Working Days ÷ Hours/day.
   * Drop decimals (no round-off) — e.g. 47.619… → 47; full day = 47 × 5 = 235.
   */
  function truncPerHourRate(basic: number, workingDays: number, hoursPerDay: number): number {
    if (!(basic > 0) || !(workingDays > 0) || !(hoursPerDay > 0)) return 0;
    return Math.floor(basic / workingDays / hoursPerDay);
  }

  // Same OT rule as Monthly Attendance: allow_overtime + ≥1h past shift (worked hours).
  function calculateOvertime(
    totalSeconds: number,
    assignedShiftSeconds: number | null,
    opts?: {
      allowOvertime?: boolean | number | string | null;
      autoClockOut?: boolean | number | string | null;
    },
  ): number | null {
    return resolveBillableOvertimeSeconds({
      totalSeconds,
      assignedShiftSeconds,
      allowOvertime: opts?.allowOvertime,
      // Match Monthly Attendance Extra Hours — do not blank OT on auto clock-out.
      autoClockOut: false,
      minSeconds: OVERTIME_MIN_SECONDS,
    });
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
  const [searchPseudo, setSearchPseudo] = useState("");


    // After attendanceByEmployee is defined (around line 660):
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [allowOvertimeMap, setAllowOvertimeMap] = useState<Record<string, boolean>>({});
  /** employee_id → paid hours/day from profile Working Hours (default 9) */
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
  const [approvedLeavesMap, setApprovedLeavesMap] = useState<ApprovedLeavesMap>({});
  const [commissionsMap, setCommissionsMap] = useState<Record<string, EmployeeCommissionRow>>({});
  /** Editable tax + manual deductions per employee — Final updates live when changed */
  const [taxByEmployee, setTaxByEmployee] = useState<Record<string, number>>({});
  const [breakExceedDedByEmployee, setBreakExceedDedByEmployee] = useState<Record<string, number>>({});
  const [kpisDedByEmployee, setKpisDedByEmployee] = useState<Record<string, number>>({});
  const [otherDedByEmployee, setOtherDedByEmployee] = useState<Record<string, number>>({});
  /** CTD + Fuel + Unpaid + Claims — persisted in monthly_payroll_adjustments */
  const [ctdByEmployee, setCtdByEmployee] = useState<Record<string, number>>({});
  const [fuelByEmployee, setFuelByEmployee] = useState<Record<string, number>>({});
  const [claimsByEmployee, setClaimsByEmployee] = useState<Record<string, number>>({});
  /** Package from Allowances → drives Medical Dedc column */
  const [medicalPackageByEmployee, setMedicalPackageByEmployee] = useState<
    Record<string, MedicalPackageId>
  >({});
  /** Session-only unpaid override (after HR edits). Default = live Monthly Attendance calc. */
  const [unpaidDaysByEmployee, setUnpaidDaysByEmployee] = useState<Record<string, number>>({});
  /** Only persist unpaid override after the user edits the field (avoid locking system value on blur). */
  const unpaidEditedRef = React.useRef<Set<string>>(new Set());
  /** Only persist fuel/CTD after the user edits (avoid blur-saving 0 over Allowances default). */
  const fuelEditedRef = React.useRef<Set<string>>(new Set());
  const ctdEditedRef = React.useRef<Set<string>>(new Set());
  /** Tax defaults from PK slabs on Gross; only lock after HR edits the Tax cell. */
  const taxEditedRef = React.useRef<Set<string>>(new Set());
  /** Same manual status map as Monthly Attendance (drives live T.Unpaid Days). */
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Record<string, string>>>({});
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

  /** Normalize "097" / 97 / "97" so Allowances defaults match payroll rows. */
  function payrollIdKeys(raw: string | number | undefined | null): string[] {
    const s = String(raw ?? "").trim();
    if (!s) return [];
    const keys = [s];
    if (/^\d+$/.test(s)) {
      const n = String(Number(s));
      if (n !== s) keys.push(n);
    }
    return keys;
  }

  function lookupMoneyMap(
    map: Record<string, number>,
    empId: string,
  ): number | undefined {
    for (const k of payrollIdKeys(empId)) {
      if (Object.prototype.hasOwnProperty.call(map, k)) return map[k] ?? 0;
    }
    return undefined;
  }

  /**
   * Monthly override (positive) wins; otherwise Allowances default.
   * Monthly 0 is ignored so accidental blur-saves don't wipe the default.
   */
  function getFuelAllowanceForEmployee(employee: { employeeId?: string }) {
    const empId = String(employee.employeeId ?? "");
    const monthly = lookupMoneyMap(fuelByEmployee, empId);
    if (monthly != null && monthly > 0) return monthly;
    const def = lookupMoneyMap(defaultFuelByEmployee, empId);
    return def != null && def > 0 ? def : 0;
  }

  /** Monthly override if saved (>0); otherwise employee default CTD from Allowances. */
  function getCtdForEmployee(employee: { employeeId?: string }) {
    const empId = String(employee.employeeId ?? "");
    const monthly = lookupMoneyMap(ctdByEmployee, empId);
    if (monthly != null && monthly > 0) return monthly;
    const def = lookupMoneyMap(defaultCtdByEmployee, empId);
    return def != null && def > 0 ? def : 0;
  }

  /** Live unpaid days from Monthly Attendance deduction % (e.g. 400% → 4 days). */
  function getSystemUnpaidDays(employee: any): number {
    return calculateTotalDeduction(employee) / 100;
  }

  /**
   * Default: live from attendance (+ status overrides).
   * Saved DB unpaid_days are ignored so Payroll stays in sync with Monthly Attendance.
   * Only a same-session edit (unpaidEditedRef) can temporarily override.
   */
  function getUnpaidDaysForEmployee(employee: any): number {
    const empId = String(employee.employeeId ?? "");
    if (
      unpaidEditedRef.current.has(empId) &&
      Object.prototype.hasOwnProperty.call(unpaidDaysByEmployee, empId)
    ) {
      return unpaidDaysByEmployee[empId] ?? 0;
    }
    return getSystemUnpaidDays(employee);
  }

  function setUnpaidDaysAmount(employeeId: string, raw: string) {
    unpaidEditedRef.current.add(String(employeeId));
    setUnpaidDaysByEmployee((prev) => ({
      ...prev,
      [employeeId]: parseUnpaidDaysValue(raw),
    }));
  }

  function saveUnpaidDaysAmount(employeeId: string, raw?: string) {
    if (!selectedMonth) return;
    if (!unpaidEditedRef.current.has(String(employeeId))) return;
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
    fuelEditedRef.current.add(String(employeeId));
    const v = parsePositiveMoney(raw);
    setFuelByEmployee((prev) => {
      const next = { ...prev };
      for (const k of payrollIdKeys(employeeId)) next[k] = v;
      return next;
    });
  }

  function saveFuelAmount(employeeId: string, raw?: string) {
    if (!selectedMonth) return;
    if (!fuelEditedRef.current.has(String(employeeId))) return;
    const fuel_allowance =
      raw !== undefined ? parsePositiveMoney(raw) : (fuelByEmployee[employeeId] ?? 0);
    void fetch("/api/monthly-payroll-adjustments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: employeeId, month: selectedMonth, fuel_allowance }),
    }).catch((err) => console.error("Fuel save failed", err));
  }

  function setCtdAmount(employeeId: string, raw: string) {
    ctdEditedRef.current.add(String(employeeId));
    const v = parsePositiveMoney(raw);
    setCtdByEmployee((prev) => {
      const next = { ...prev };
      for (const k of payrollIdKeys(employeeId)) next[k] = v;
      return next;
    });
  }

  function saveCtdAmount(employeeId: string, raw?: string) {
    if (!selectedMonth) return;
    if (!ctdEditedRef.current.has(String(employeeId))) return;
    const ctd =
      raw !== undefined ? parsePositiveMoney(raw) : (ctdByEmployee[employeeId] ?? 0);
    void fetch("/api/monthly-payroll-adjustments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: employeeId, month: selectedMonth, ctd }),
    }).catch((err) => console.error("CTD save failed", err));
  }

  function getClaimsForEmployee(employee: { employeeId?: string }) {
    const empId = String(employee.employeeId ?? "");
    return claimsByEmployee[empId] ?? 0;
  }

  function getMedicalDedcForEmployee(employee: { employeeId?: string }) {
    const empId = String(employee.employeeId ?? "");
    let pkg: MedicalPackageId | null = null;
    for (const k of payrollIdKeys(empId)) {
      if (medicalPackageByEmployee[k]) {
        pkg = medicalPackageByEmployee[k];
        break;
      }
    }
    return medicalDeductionForPackage(pkg);
  }

  function setClaimsAmount(employeeId: string, raw: string) {
    setClaimsByEmployee((prev) => ({ ...prev, [employeeId]: parsePositiveMoney(raw) }));
  }

  function saveClaimsAmount(employeeId: string, raw?: string) {
    if (!selectedMonth) return;
    const medical_claims =
      raw !== undefined ? parsePositiveMoney(raw) : (claimsByEmployee[employeeId] ?? 0);
    void fetch("/api/monthly-payroll-adjustments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: employeeId,
        month: selectedMonth,
        medical_claims,
      }),
    }).catch((err) => console.error("Claims save failed", err));
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

    Promise.all([
      fetch(url, { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/hrm-shifts-assignments", { cache: "no-store" })
        .then((res) => res.json())
        .catch(() => null),
    ])
      .then(([data, shiftData]) => {
        if (data.success) {
          const otFromShifts: Record<string, boolean> = { ...allowOvertimeMap };
          const empShiftMap: Record<
            string,
            { start: string; end: string; seconds: number }
          > = {};
          if (shiftData?.success && Array.isArray(shiftData.employees)) {
            const nextOt: Record<string, boolean> = {};
            shiftData.employees.forEach((emp: any) => {
              const empId = String(emp.id);
              if (emp.allow_overtime !== undefined && emp.allow_overtime !== null) {
                nextOt[empId] = emp.allow_overtime === 1 || emp.allow_overtime === true;
                otFromShifts[empId] = nextOt[empId];
              }
              const secs = getAssignedShiftSeconds(emp.start_time, emp.end_time);
              if (secs && secs > 0) {
                empShiftMap[empId] = {
                  start: emp.start_time,
                  end: emp.end_time,
                  seconds: secs,
                };
              }
            });
            setAllowOvertimeMap((prev) => ({ ...prev, ...nextOt }));
          }

          (data.attendance || []).forEach((record: any) => {
            const assignedShiftSeconds = getAssignedShiftSeconds(
              record.shift_start_time,
              record.shift_end_time,
            );
            if (
              record.employee_id &&
              record.shift_start_time &&
              record.shift_end_time &&
              assignedShiftSeconds &&
              assignedShiftSeconds > 0
            ) {
              empShiftMap[String(record.employee_id)] = {
                start: record.shift_start_time,
                end: record.shift_end_time,
                seconds: assignedShiftSeconds,
              };
            }
          });

          let records = (data.attendance || []).map((record: any) => {
            const empId = String(record.employee_id ?? "");
            const totalSeconds =
              record.total_seconds && record.total_seconds > 0
                ? record.total_seconds
                : calculateTotalSeconds(record.clock_in, record.clock_out);
            let assignedShiftSeconds = getAssignedShiftSeconds(
              record.shift_start_time,
              record.shift_end_time,
            );
            if ((!assignedShiftSeconds || assignedShiftSeconds <= 0) && empShiftMap[empId]) {
              assignedShiftSeconds = empShiftMap[empId].seconds;
            }
            const allowFromRecord = record.allow_overtime;
            const allowFromMap = otFromShifts[empId];
            const allowOT =
              allowFromRecord != null && allowFromRecord !== ""
                ? isOvertimeAllowed(allowFromRecord)
                : allowFromMap === true;
            const overtimeSeconds = calculateOvertime(totalSeconds, assignedShiftSeconds, {
              allowOvertime: allowOT ? 1 : 0,
            });
            return {
              ...record,
              allow_overtime: allowOT ? 1 : 0,
              total_hours: formatDuration(totalSeconds),
              assigned_shift_seconds: assignedShiftSeconds,
              overtime: overtimeSeconds,
              is_late: record.is_late,
              late_minutes: record.late_minutes || 0,
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

          if (fromDate && toDate) {
            fetchApprovedLeaves(fromDate, toDate);
          }
        }
      })
      .catch(err => console.error("Error fetching attendance:", err))
      .finally(() => setLoading(false));
  };

  // Month-wide approved leaves (includes employees with no clock-in rows).
  const fetchApprovedLeaves = async (from: string, to: string) => {
    try {
      const params = new URLSearchParams();
      params.append("status", "approved");
      params.append("fromDate", from);
      params.append("toDate", to);

      const response = await fetch(`/api/leaves?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();

      if (data.success && data.leaves) {
        setApprovedLeavesMap(
          buildApprovedLeavesMap(data.leaves as Array<Record<string, unknown>>, {
            normalizeDateKey: (raw: string) => {
              const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw || ""));
              return m ? m[1] : "";
            },
            addDays: (dateKey: string, days: number) => {
              const [y, m, d] = dateKey.split("-").map(Number);
              const next = new Date(Date.UTC(y, m - 1, d + days));
              return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
            },
          }),
        );
      }
    } catch (err) {
      console.error("Error fetching approved leaves:", err);
    }
  };

  // Fetch shift assignment allow_overtime (paid hours/day come from profile Working Hours)
  const fetchOverTimeSettings = async () => {
    try {
      const response = await fetch("/api/hrm-shifts-assignments", { cache: "no-store" });
      const data = await response.json();

      if (data.success && data.employees) {
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
    if (!selectedMonth) {
      setCtdByEmployee({});
      setFuelByEmployee({});
      setClaimsByEmployee({});
      setUnpaidDaysByEmployee({});
      unpaidEditedRef.current = new Set();
      return;
    }
    unpaidEditedRef.current = new Set();
    fuelEditedRef.current = new Set();
    ctdEditedRef.current = new Set();
    taxEditedRef.current = new Set();
    setTaxByEmployee({});
    let cancelled = false;
    fetch(`/api/monthly-payroll-adjustments?month=${encodeURIComponent(selectedMonth)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const ctdMap: Record<string, number> = {};
        const fuelMap: Record<string, number> = {};
        const claimsMap: Record<string, number> = {};
        if (data.success && Array.isArray(data.adjustments)) {
          data.adjustments.forEach(
            (row: {
              employee_id?: string | number;
              ctd?: number | null;
              fuel_allowance?: number | null;
              medical_claims?: number | null;
            }) => {
              const id = String(row.employee_id ?? "").trim();
              if (!id) return;
              // Only positive monthly overrides — 0 means “use Allowances default”.
              if (row.ctd !== null && row.ctd !== undefined) {
                const ctd = parsePositiveMoney(row.ctd);
                if (ctd > 0) {
                  for (const k of payrollIdKeys(id)) ctdMap[k] = ctd;
                }
              }
              if (row.fuel_allowance !== null && row.fuel_allowance !== undefined) {
                const fuel = parsePositiveMoney(row.fuel_allowance);
                if (fuel > 0) {
                  for (const k of payrollIdKeys(id)) fuelMap[k] = fuel;
                }
              }
              if (row.medical_claims !== null && row.medical_claims !== undefined) {
                const claims = parsePositiveMoney(row.medical_claims);
                if (claims > 0) {
                  for (const k of payrollIdKeys(id)) claimsMap[k] = claims;
                }
              }
              // unpaid_days from DB intentionally ignored — T.Unpaid Days is live from attendance.
            }
          );
        }
        setCtdByEmployee(ctdMap);
        setFuelByEmployee(fuelMap);
        setClaimsByEmployee(claimsMap);
        setUnpaidDaysByEmployee({});
        unpaidEditedRef.current = new Set();
      })
      .catch((err) => {
        console.error("Payroll adjustments fetch failed", err);
        if (!cancelled) {
          setCtdByEmployee({});
          setFuelByEmployee({});
          setClaimsByEmployee({});
          setUnpaidDaysByEmployee({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  // Live status overrides from Monthly Attendance (manual On Time / Absent / Half Day, …)
  useEffect(() => {
    if (!fromDate || !toDate) {
      setStatusOverrides({});
      return;
    }
    let cancelled = false;
    fetch(
      `/api/monthly-attendance-status-overrides?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, Record<string, string>> = {};
        if (data.success && Array.isArray(data.overrides)) {
          // Day-level (attendance_id=0) wins for payroll unpaid calc.
          // Session-only overrides fill a day only when no day-level row exists.
          const sessionFill: Array<{ eid: string; dk: string; status: string }> = [];
          data.overrides.forEach(
            (o: {
              employee_id?: string;
              attendance_date?: string;
              status_label?: string;
              attendance_id?: number | null;
            }) => {
              const eid = String(o.employee_id ?? "").trim();
              const dk = String(o.attendance_date ?? "").trim().slice(0, 10);
              if (!eid || !dk) return;
              const status = normalizeAttendanceStatus(String(o.status_label || ""));
              const attId = Number(o.attendance_id || 0);
              if (Number.isFinite(attId) && attId > 0) {
                sessionFill.push({ eid, dk, status });
                return;
              }
              if (!map[eid]) map[eid] = {};
              map[eid][dk] = status;
            },
          );
          sessionFill.forEach(({ eid, dk, status }) => {
            if (!map[eid]) map[eid] = {};
            if (!map[eid][dk]) map[eid][dk] = status;
          });
        }
        setStatusOverrides(map);
      })
      .catch(() => {
        if (!cancelled) setStatusOverrides({});
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

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
    // Asia/Karachi — matches Monthly Attendance / Mongo BSON midnight dates
    return getDateStringInTimeZone(parsed, SERVER_TIMEZONE);
  }

  function getRecordDateKey(record: any) {
    // Prefer stored attendance date (calendar day) over clock_in (UTC shift risk)
    const rawDate = record?.date != null ? String(record.date) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
    if (rawDate) {
      const fromDate = getDateKey(rawDate);
      if (fromDate) return fromDate;
    }
    return getDateKey(record.clock_in || record.clock_out || "");
  }

  /** Same rule as Monthly Attendance: future days (after today PKT) are not Absent yet. */
  function isFutureAttendanceDay(dateKey: string) {
    if (!dateKey) return false;
    const todayKey = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    return dateKey > todayKey;
  }

  /**
   * Sum day deduction % for T.Unpaid Days (= total / 100).
   * Same rules as Monthly Attendance Total Deduction (incl. status overrides).
   */
  function calculateTotalDeduction(employee: any) {
    let totalDeduction = 0;
    const empId = String(employee.employeeId ?? "");
    monthInfo.days.forEach((day) => {
      const dayRecords = employee.byDate?.[day.dateKey] || [];
      const meta = employee.dateMeta?.[day.dateKey];
      const workingDay = isWorkingDay(day.dateKey);
      const leaveKind = approvedLeaveOnDay(approvedLeavesMap, empId, day.dateKey);
      const override = statusOverrides[empId]?.[day.dateKey];

      let dayDeduction = 0;
      if (leaveKind || override === "Leave") {
        dayDeduction = leaveKind
          ? parseInt(
              String(attendanceFromApprovedLeaveDay(leaveKind).deduction).replace(/%/g, ""),
              10,
            ) || 0
          : 0;
      } else if (dayRecords.length === 0) {
        if (override) {
          dayDeduction =
            parseInt(
              String(deductionForAttendanceStatus(override, 0)).replace(/%/g, ""),
              10,
            ) || 0;
        } else if (workingDay && !isFutureAttendanceDay(day.dateKey)) {
          dayDeduction = 100;
        }
      } else if (meta?.deduction) {
        dayDeduction = parseInt(String(meta.deduction).replace(/%/g, ""), 10) || 0;
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
      const empId = String(emp.employeeId);
      const taxManual = taxEditedRef.current.has(empId);
      const row = getPayrollBreakdown(emp, {
        taxAmount: taxByEmployee[empId] ?? 0,
        taxManual,
        breakExceedDed: breakExceedDedByEmployee[empId] ?? 0,
        kpisDed: kpisDedByEmployee[empId] ?? 0,
        otherDed: otherDedByEmployee[empId] ?? 0,
        ctd: getCtdForEmployee(emp),
        fuelAllowance: getFuelAllowanceForEmployee(emp),
        unpaidDays: getUnpaidDaysForEmployee(emp),
        medicalClaims: getClaimsForEmployee(emp),
        medicalDedc: getMedicalDedcForEmployee(emp),
      });
      if (financePayrollView) {
        return {
          ID: emp.employeeId,
          "Employee Name": emp.employeeName,
          Pseudonym: emp.pseudonym,
          Department: emp.departmentName,
          Advance: row.advanceDeduction,
          Loan: row.loanDeduction,
          "Final Salary": row.finalSalary,
        };
      }
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
      "Claims": row.medicalClaims,
      "Gross Salary": row.grossSalary,
      "Unpaid Days Salary": row.unpaidDaysSalary,
      "Break Exceed Ded.": row.breakExceedDed,
      "KPIs Ded.": row.kpisDed,
      "Other Ded": row.otherDed,
      "CTD": row.ctd,
      "Medical Dedc": row.medicalDedc,
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
        const leaveKind = approvedLeaveOnDay(
          approvedLeavesMap,
          employee.employeeId,
          day.dateKey,
        );
        if (workingDay && leaveKind) {
          const att = attendanceFromApprovedLeaveDay(leaveKind);
          statusLabel = att.statusLabel;
          deduction = att.deduction;
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
        Deduction: `${getTotalWorkingDays(monthInfo)}`
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
  const [finalizeModalOpen, setFinalizeModalOpen] = React.useState(false);
  const [finalizeBusy, setFinalizeBusy] = React.useState(false);
  const [finalizeResult, setFinalizeResult] = React.useState<
    null | { type: "success" | "error"; message: string }
  >(null);
  const pathname = usePathname() || "";
  const onEmployeePortal = pathname.includes("/employee-dashboard");
  const [viewerEmployeeId, setViewerEmployeeId] = React.useState("");
  /** pending = waiting for /me so we don't flash full admin payroll for Finance users */
  const [financeGate, setFinanceGate] = React.useState<"pending" | "yes" | "no">(
    "pending",
  );
  /** Finance employee-dashboard: compact Final Salary view + Mark Paid */
  const financePayrollView = onEmployeePortal && financeGate === "yes";
  const showMarkPaidButton = financePayrollView;

  React.useEffect(() => {
    if (!onEmployeePortal) {
      setFinanceGate("no");
      setViewerEmployeeId("");
      return;
    }
    let eid = "";
    try {
      eid = String(localStorage.getItem("employeeId") || "").trim();
    } catch {
      eid = "";
    }
    setViewerEmployeeId(/^\d+$/.test(eid) ? eid : "");
    if (!/^\d+$/.test(eid)) {
      setFinanceGate("no");
      return;
    }
    let cancelled = false;
    setFinanceGate("pending");
    fetch(`/api/access-control/me?employeeId=${encodeURIComponent(eid)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const dept =
          data?.departmentName ||
          data?.department_name ||
          data?.employee?.department_name ||
          "";
        const slugs: string[] = Array.isArray(data?.role?.slugs)
          ? data.role.slugs
          : data?.role?.slug
            ? [String(data.role.slug)]
            : [];
        const perms: string[] = Array.isArray(data?.permissions)
          ? data.permissions
          : [];
        const financeDept = orgDeptChipLabel(dept) === "Finance";
        const financeRole = slugs.some((slug) => {
          const s = String(slug || "").trim().toLowerCase();
          return (
            s === "finance_manager" ||
            s === "team_lead_finance" ||
            s === "accountant_billing" ||
            s === "mp_finance" ||
            s.includes("finance_manager") ||
            s.includes("team_lead_finance")
          );
        });
        const financePerm = perms.some((p) => {
          const key = String(p || "").trim().toLowerCase();
          return (
            key === "payroll.loan@all_departments" ||
            key === "payroll.advance@all_departments" ||
            key === "payroll.monthly.edit@all_departments" ||
            key === "payroll.monthly.view@all_departments"
          );
        });
        setFinanceGate(financeDept || financeRole || financePerm ? "yes" : "no");
      })
      .catch(() => {
        if (!cancelled) setFinanceGate("no");
      });
    return () => {
      cancelled = true;
    };
  }, [onEmployeePortal]);

  const expandIdMap = React.useCallback((raw: Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const [id, amount] of Object.entries(raw || {})) {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      for (const k of payrollIdKeys(id)) {
        out[k] = Math.max(out[k] || 0, amt);
      }
    }
    return out;
  }, []);

  // Fetch unpaid advance + loan for selected month (separate maps)
  React.useEffect(() => {
    if (!selectedMonth) return;
    let cancelled = false;
    fetchPayrollLoanAdvance(selectedMonth).then((data) => {
      if (cancelled) return;
      setAdvanceSalaryMap(expandIdMap(data.advances || {}));
      setLoanSalaryMap(expandIdMap(data.loans || {}));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedMonth, expandIdMap]);

  // Fetch all employees and their salary (amount, any component)
  React.useEffect(() => {
    // Fetch all employees
    fetch('/api/employee-list')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.employees)) {
          setAllEmployees(data.employees);
          const hoursMap: Record<string, number> = {};
          data.employees.forEach((emp: any) => {
            const empId = String(emp.id ?? emp.employee_id ?? "").trim();
            if (!empId) return;
            hoursMap[empId] = getPaidHoursPerDayFromProfile(emp.working_hours);
          });
          setPaidHoursPerDayMap(hoursMap);
        } else {
          setAllEmployees([]);
          setPaidHoursPerDayMap({});
        }
      })
      .catch(() => {
        setAllEmployees([]);
        setPaidHoursPerDayMap({});
      });
    // Monthly Payroll is a full-sheet view (page already permission-gated).
    // Do NOT pass viewerId here — per-row salary privacy was redacting almost
    // every amount and making calculated rates show 0/0.
    fetch("/api/employee_salaries/all")
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.salaries)) {
          const map: Record<string, number> = {};
          const fuelDefaults: Record<string, number> = {};
          const ctdDefaults: Record<string, number> = {};
          const medicalDefaults: Record<string, MedicalPackageId> = {};
          data.salaries.forEach((row: any) => {
            if (row.salary_hidden) return;
            if (row.employee_id != null && row.amount !== undefined && row.amount !== null) {
              const amt = Number(row.amount);
              if (Number.isFinite(amt) && amt > 0) {
                for (const k of payrollIdKeys(row.employee_id)) {
                  map[k] = amt;
                }
              }
            }
            if (row.employee_id != null && row.fuel_allowance != null && row.fuel_allowance !== "") {
              const fuel = Number(row.fuel_allowance);
              if (Number.isFinite(fuel) && fuel > 0) {
                for (const k of payrollIdKeys(row.employee_id)) {
                  fuelDefaults[k] = fuel;
                }
              }
            }
            if (
              row.employee_id != null &&
              row.company_transport_deduction != null &&
              row.company_transport_deduction !== ""
            ) {
              const ctd = Number(row.company_transport_deduction);
              if (Number.isFinite(ctd) && ctd > 0) {
                for (const k of payrollIdKeys(row.employee_id)) {
                  ctdDefaults[k] = ctd;
                }
              }
            }
            const pkg = normalizeMedicalPackage(row.medical_package);
            if (row.employee_id != null && pkg) {
              for (const k of payrollIdKeys(row.employee_id)) {
                medicalDefaults[k] = pkg;
              }
            }
          });
          setSalaryMap(map);
          setDefaultFuelByEmployee(fuelDefaults);
          setDefaultCtdByEmployee(ctdDefaults);
          setMedicalPackageByEmployee(medicalDefaults);
        }
      });
  }, []);

  const attendanceByEmployee = React.useMemo(() => {
    // Same day-status + deduction rules as Monthly Attendance (live T.Unpaid Days).
    const attMap: Record<
      string,
      {
        byDate: Record<string, any[]>;
        dateMeta: Record<
          string,
          { runningLate: number | string; statusLabel: string; statusColor: string; deduction: string }
        >;
        gender: string;
        attendanceRecord: any;
      }
    > = {};
    attendance.forEach((record: any) => {
      if (!record.employee_id) return;
      const empId = String(record.employee_id);
      if (!attMap[empId]) {
        attMap[empId] = {
          byDate: {},
          dateMeta: {},
          gender: record.gender || "",
          attendanceRecord: record,
        };
      }
      if (!attMap[empId].gender && record.gender) {
        attMap[empId].gender = record.gender;
      }
      const dateKey = getRecordDateKey(record);
      if (!dateKey) return;
      if (!attMap[empId].byDate[dateKey]) attMap[empId].byDate[dateKey] = [];
      attMap[empId].byDate[dateKey].push(record);
    });

    Object.entries(attMap).forEach(([empId, employee]) => {
      Object.keys(employee.byDate).forEach((dateKey) => {
        employee.byDate[dateKey].sort(compareAttendanceRows);
      });

      let runningLate = 0;
      const dateKeys = Object.keys(employee.byDate).sort();
      dateKeys.forEach((dateKey) => {
        const dayRecords = employee.byDate[dateKey];
        const { clockIn, clockOut, record } = aggregateDayPunches(dayRecords);
        const dayStatus = classifyDayAttendance({
          dateKey,
          clockIn,
          clockOut,
          shiftStart: record?.shift_start_time ?? null,
          shiftEnd: record?.shift_end_time ?? null,
          gender: employee.gender,
        });

        const autoStatusLabel = normalizeAttendanceStatus(dayStatus.statusLabel);
        const override = statusOverrides[empId]?.[dateKey];
        const isManual = Boolean(override);
        const statusLabel = override || autoStatusLabel;
        let deduction = "";
        let tardyDisplay: number | string = "";

        const inSelectedMonth =
          (!fromDate || dateKey >= fromDate) && (!toDate || dateKey <= toDate);

        if (statusLabel === "Tardy" && (dayStatus.isLate || isManual)) {
          if (inSelectedMonth) {
            runningLate += 1;
            tardyDisplay = runningLate;
            deduction = deductionForAttendanceStatus(statusLabel, runningLate);
          }
        } else if (statusLabel === "Absent") {
          deduction = "100%";
        } else if (
          statusLabel === STATUS_FIRST_HALF_DAY ||
          statusLabel === STATUS_SECOND_HALF_DAY
        ) {
          deduction = "50%";
        } else {
          deduction = deductionForAttendanceStatus(statusLabel, tardyDisplay);
        }

        employee.dateMeta[dateKey] = {
          runningLate: tardyDisplay,
          statusLabel,
          statusColor: "#4A5568",
          deduction,
        };
      });
    });

    return allEmployees.map((emp) => {
      const empId = String(emp.id || emp.employee_id);
      const att = attMap[empId];
      const basicSalary = salaryMap[empId];
      const allowOT = allowOvertimeMap[empId] === true;
      const paidHoursPerDay =
        paidHoursPerDayMap[empId] ??
        getPaidHoursPerDayFromProfile(emp.working_hours);
      return {
        employeeId: empId,
        employeeName:
          emp.first_name && emp.last_name
            ? `${emp.first_name} ${emp.last_name}`
            : emp.employee_name || "-",
        pseudonym: emp.pseudonym || "-",
        departmentName: emp.department_name || "-",
        gender: att?.gender || emp.gender || "",
        basicSalary,
        allowOvertime: allowOT,
        paidHoursPerDay,
        workingHours: emp.working_hours ?? null,
        employmentType: emp.employment_type || "",
        byDate: att ? att.byDate : {},
        dateMeta: att ? att.dateMeta : {},
      };
    });
  }, [
    attendance,
    allEmployees,
    salaryMap,
    allowOvertimeMap,
    paidHoursPerDayMap,
    statusOverrides,
    fromDate,
    toDate,
  ]);

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
   * Tax: Pakistan salaried slabs on Net before Tax (annualize ÷12) unless taxManual override.
   * Final = Net before Tax − Tax. Manual columns (Fuel, CTD, etc.) feed live.
   */
  function getPayrollBreakdown(
    employee: any,
    opts: {
      taxAmount?: number;
      /** When true, use taxAmount even if 0 (manual override). */
      taxManual?: boolean;
      breakExceedDed?: number;
      kpisDed?: number;
      otherDed?: number;
      ctd?: number;
      fuelAllowance?: number;
      unpaidDays?: number;
      medicalClaims?: number;
      medicalDedc?: number;
    } = {}
  ) {
    const hasAttendance = Object.keys(employee.byDate || {}).length > 0;

    const basicSalary = Number(employee.basicSalary ?? 0) || 0;
    const fuelAllowance =
      opts.fuelAllowance !== undefined
        ? parsePositiveMoney(opts.fuelAllowance)
        : 0;
    const medicalClaims =
      opts.medicalClaims !== undefined
        ? parsePositiveMoney(opts.medicalClaims)
        : getClaimsForEmployee(employee);
    const medicalDedc =
      opts.medicalDedc !== undefined
        ? parsePositiveMoney(opts.medicalDedc)
        : getMedicalDedcForEmployee(employee);
    const paidHoursPerDay =
      Number(employee.paidHoursPerDay) > 0 ? Number(employee.paidHoursPerDay) : 9;

    // Always use calendar working days for rates (Basic÷W.Days÷hours).
    // Gating on punches made Per Hour / day pay show 0/0 for most of the roster.
    const workingDays = getTotalWorkingDays(monthInfo);

    const systemUnpaidDays = calculateTotalDeduction(employee) / 100;
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

    const perHourRate = truncPerHourRate(basicSalary, workingDays, paidHoursPerDay);
    const fullDayPay = perHourRate * paidHoursPerDay;

    let otSalary = 0;
    if (employee.allowOvertime !== false) {
      if (perHourRate > 0 && otHours > 0) {
        // Use truncated per-hour only (no re-rounding the rate).
        otSalary = Math.floor(perHourRate * otHours);
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
      floorIncentive +
      medicalClaims;

    // Unpaid cut from truncated full-day pay (e.g. 235/day), not rounded Basic÷W.Days.
    const unpaidDaysSalary =
      fullDayPay > 0 && unpaidDays > 0
        ? Math.floor(fullDayPay * unpaidDays)
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

    // Separate advance + loan (Finance compact view + admin Loan/Advance column)
    const empKey = String(employee.employeeId ?? "");
    const advanceDeduction = (() => {
      const n = Number(lookupMoneyMap(advanceSalaryMap, empKey) ?? 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })();
    const loanDeduction = (() => {
      const n = Number(lookupMoneyMap(loanSalaryMap, empKey) ?? 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })();
    const loanAdvance = advanceDeduction + loanDeduction;

    const totalDeductions =
      unpaidDaysSalary +
      breakExceedDed +
      kpisDed +
      otherDed +
      ctd +
      medicalDedc +
      advanceDeduction +
      loanDeduction;

    const netBeforeTax = Math.max(0, grossSalary - totalDeductions);
    // Tax base = Net. Salary before Tax (not Gross).
    const autoTax = monthlySalaryTaxFromGross(netBeforeTax);
    const tax = opts.taxManual
      ? Number.isFinite(opts.taxAmount) && (opts.taxAmount as number) > 0
        ? (opts.taxAmount as number)
        : 0
      : autoTax;
    const netSalary = netBeforeTax - tax;
    const finalSalary = netSalary;

    const unpaidDaysDisplay = Number.isInteger(unpaidDays)
      ? String(unpaidDays)
      : unpaidDays.toFixed(1).replace(/\.0$/, "");

    return {
      basicSalary,
      fuelAllowance,
      medicalClaims,
      medicalDedc,
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
      advanceDeduction,
      loanDeduction,
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
    const nameQ = searchName.trim().toLowerCase();
    const pseudoQ = searchPseudo.trim().toLowerCase();
    const name = String(emp.employeeName || "").toLowerCase();
    const pseudo = String(emp.pseudonym || "").toLowerCase();
    const idStr = String(emp.employeeId || "");
    const matchesName =
      !nameQ ||
      name.includes(nameQ) ||
      idStr.includes(nameQ);
    const matchesPseudo = !pseudoQ || pseudo.includes(pseudoQ);
    const matchesDept = selectedDepartment
      ? String(emp.departmentName || "").toLowerCase() === selectedDepartment.toLowerCase()
      : true;
    return matchesName && matchesPseudo && matchesDept;
  });

  const financeSummary = React.useMemo(() => {
    let advanceTotal = 0;
    let loanTotal = 0;
    let finalTotal = 0;
    let withAdvance = 0;
    let withLoan = 0;
    for (const employee of filteredEmployees) {
      const empId = employee.employeeId;
      const taxManual = taxEditedRef.current.has(String(empId));
      const row = getPayrollBreakdown(employee, {
        taxAmount: taxByEmployee[empId],
        taxManual,
        breakExceedDed: breakExceedDedByEmployee[empId] ?? 0,
        kpisDed: kpisDedByEmployee[empId] ?? 0,
        otherDed: otherDedByEmployee[empId] ?? 0,
        ctd: getCtdForEmployee(employee),
        fuelAllowance: getFuelAllowanceForEmployee(employee),
        unpaidDays: getUnpaidDaysForEmployee(employee),
        medicalClaims: getClaimsForEmployee(employee),
        medicalDedc: getMedicalDedcForEmployee(employee),
      });
      advanceTotal += row.advanceDeduction || 0;
      loanTotal += row.loanDeduction || 0;
      finalTotal += row.finalSalary || 0;
      if ((row.advanceDeduction || 0) > 0) withAdvance += 1;
      if ((row.loanDeduction || 0) > 0) withLoan += 1;
    }
    return {
      employees: filteredEmployees.length,
      advanceTotal,
      loanTotal,
      finalTotal,
      withAdvance,
      withLoan,
    };
  }, [
    filteredEmployees,
    taxByEmployee,
    breakExceedDedByEmployee,
    kpisDedByEmployee,
    otherDedByEmployee,
    advanceSalaryMap,
    loanSalaryMap,
    ctdByEmployee,
    fuelByEmployee,
    claimsByEmployee,
    unpaidDaysByEmployee,
    defaultCtdByEmployee,
    defaultFuelByEmployee,
    medicalPackageByEmployee,
  ]);

  // Snapshot Final Salary for Salary Disbursement (exact Monthly Payroll values).
  React.useEffect(() => {
    if (!selectedMonth || !attendanceByEmployee.length) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const rows = attendanceByEmployee.map((employee: any) => {
        const empId = employee.employeeId;
        const taxManual = taxEditedRef.current.has(String(empId));
        const row = getPayrollBreakdown(employee, {
          taxAmount: taxByEmployee[empId],
          taxManual,
          breakExceedDed: breakExceedDedByEmployee[empId] ?? 0,
          kpisDed: kpisDedByEmployee[empId] ?? 0,
          otherDed: otherDedByEmployee[empId] ?? 0,
          ctd: getCtdForEmployee(employee),
          fuelAllowance: getFuelAllowanceForEmployee(employee),
          unpaidDays: getUnpaidDaysForEmployee(employee),
          medicalClaims: getClaimsForEmployee(employee),
          medicalDedc: getMedicalDedcForEmployee(employee),
        });
        return {
          employee_id: Number(empId),
          final_salary: Number(row.finalSalary) || 0,
        };
      });
      let viewer = "";
      try {
        viewer = String(localStorage.getItem("employeeId") || "").trim();
      } catch {
        viewer = "";
      }
      void fetch("/api/monthly-payroll/final-salaries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(viewer ? { "x-employee-id": viewer, "x-hrm-employee-id": viewer } : {}),
        },
        body: JSON.stringify({
          month: selectedMonth,
          rows,
          viewer_id: /^\d+$/.test(viewer) ? Number(viewer) : undefined,
        }),
      }).catch(() => {
        /* non-blocking sync */
      });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedMonth,
    attendanceByEmployee,
    taxByEmployee,
    breakExceedDedByEmployee,
    kpisDedByEmployee,
    otherDedByEmployee,
    advanceSalaryMap,
    loanSalaryMap,
    ctdByEmployee,
    fuelByEmployee,
    claimsByEmployee,
    unpaidDaysByEmployee,
    defaultCtdByEmployee,
    defaultFuelByEmployee,
    medicalPackageByEmployee,
  ]);

  const clearFinanceFilters = () => {
    setSearchName("");
    setSearchPseudo("");
    setSelectedDepartment("");
  };

  const openMarkPaidModal = () => {
    if (!selectedMonth) return;
    setFinalizeResult(null);
    setFinalizeModalOpen(true);
  };

  const finalizeModalNode = finalizeModalOpen ? (
        <div
          className={finalizeModal.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="finalize-payroll-title"
          onClick={() => {
            if (!finalizeBusy) setFinalizeModalOpen(false);
          }}
        >
          <div
            className={finalizeModal.card}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={finalizeModal.header}>
              <div className={finalizeModal.iconWrap}>
                {finalizeResult?.type === "success" ? (
                  <FaCheckCircle />
                ) : finalizeResult?.type === "error" ? (
                  <FaExclamationTriangle />
                ) : (
                  <FaCheckCircle />
                )}
              </div>
              <h3 id="finalize-payroll-title" className={finalizeModal.title}>
                {finalizeResult?.type === "success"
                  ? "Marked as Paid"
                  : finalizeResult?.type === "error"
                    ? "Could Not Update"
                    : "Confirm Final Salary"}
              </h3>
              <p className={finalizeModal.subtitle}>
                {finalizeResult
                  ? finalizeResult.type === "success"
                    ? "Statuses are updated in Employee Financial History."
                    : "Please try again in a moment."
                  : "Lock this month’s advance and loan deductions after Final Salary."}
              </p>
            </div>

            <div className={finalizeModal.body}>
              {!finalizeResult ? (
                <>
                  <div className={finalizeModal.monthPill}>
                    Payroll month: {selectedMonth}
                    {monthInfo.label ? ` · ${monthInfo.label}` : ""}
                  </div>
                  <ul className={finalizeModal.list}>
                    <li>
                      <span className={finalizeModal.bullet} />
                      <span>
                        Advances for this month will change from <strong>Active</strong> to{" "}
                        <strong>Paid</strong> (green).
                      </span>
                    </li>
                    <li>
                      <span className={finalizeModal.bullet} />
                      <span>
                        This month’s loan installment will change from <strong>Pending</strong> to{" "}
                        <strong>Paid</strong> (green).
                      </span>
                    </li>
                    <li>
                      <span className={finalizeModal.bullet} />
                      <span>
                        Amounts already deducted in Monthly Payroll will no longer be re-deducted.
                      </span>
                    </li>
                  </ul>
                  <p className={finalizeModal.note}>
                    Use this only after Final Salary is ready for {selectedMonth}. You can review the
                    result under Employee Financial History → Advances / Loans.
                  </p>
                </>
              ) : finalizeResult.type === "success" ? (
                <p className={finalizeModal.successBox}>{finalizeResult.message}</p>
              ) : (
                <p className={finalizeModal.errorBox}>{finalizeResult.message}</p>
              )}
            </div>

            <div className={finalizeModal.actions}>
              {!finalizeResult ? (
                <>
                  <button
                    type="button"
                    className={finalizeModal.btnGhost}
                    disabled={finalizeBusy}
                    onClick={() => setFinalizeModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={finalizeModal.btnPrimary}
                    disabled={finalizeBusy}
                    onClick={async () => {
                      if (!selectedMonth) return;
                      setFinalizeBusy(true);
                      try {
                        const res = await fetch(
                          "/api/employee-financial-history/mark-payroll-paid",
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              "x-employee-id": viewerEmployeeId,
                              "x-hrm-employee-id": viewerEmployeeId,
                            },
                            body: JSON.stringify({
                              month: selectedMonth,
                              viewer_id: viewerEmployeeId
                                ? Number(viewerEmployeeId)
                                : undefined,
                            }),
                          },
                        );
                        const data = await res.json();
                        if (!data.success) {
                          setFinalizeResult({
                            type: "error",
                            message: data.message || "Failed to mark advance and loan as paid.",
                          });
                          return;
                        }
                        const maps = await fetchPayrollLoanAdvance(selectedMonth);
                        setAdvanceSalaryMap(expandIdMap(maps.advances || {}));
                        setLoanSalaryMap(expandIdMap(maps.loans || {}));
                        setFinalizeResult({
                          type: "success",
                          message:
                            data.message ||
                            `Advance and this month's loan installment are now Paid on the Loan page, Advance page, and Financial History. Refresh those pages to see Paid (green).`,
                        });
                      } catch {
                        setFinalizeResult({
                          type: "error",
                          message: "Failed to mark advance and loan as paid. Please try again.",
                        });
                      } finally {
                        setFinalizeBusy(false);
                      }
                    }}
                  >
                    {finalizeBusy ? "Updating…" : "Confirm & Mark Paid"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={
                    finalizeResult.type === "success"
                      ? finalizeModal.btnSuccess
                      : finalizeModal.btnPrimary
                  }
                  onClick={() => setFinalizeModalOpen(false)}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null;

  if (onEmployeePortal && financeGate === "pending") {
    return (
      <OptionalAdminShell>
        <div className={fh.page}>
          <div className={fh.hero}>
            <h1 className={fh.heroTitle}>Final Salary</h1>
            <p className={fh.heroSub}>Loading your Finance payroll access…</p>
          </div>
          <div className={fh.panel} style={{ padding: "28px 20px", textAlign: "center", color: "#64748b" }}>
            Please wait…
          </div>
        </div>
        {popup}
      </OptionalAdminShell>
    );
  }

  if (financePayrollView) {
    const deptOptions = Array.from(
      new Set(
        attendanceByEmployee
          .map((e: any) => String(e.departmentName || "").trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return (
      <OptionalAdminShell>
        <div className={fh.page}>
          <div className={fh.hero}>
            <h1 className={fh.heroTitle}>Final Salary (Finance)</h1>
            <p className={fh.heroSub}>
              Company-wide Final Salary with Advance and Loan for the selected month. Filter by
              name, pseudo name, or department — then mark Loan/Advance Paid after recovery.
            </p>
          </div>

          <div className={fh.panel}>
            <div className={fh.filters}>
              <div className={fh.field}>
                <label className={fh.label}>Month</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className={fh.input}
                />
              </div>
              <div className={fh.field}>
                <label className={fh.label}>Search by name</label>
                <input
                  type="text"
                  placeholder="Employee name or ID"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  className={fh.input}
                />
              </div>
              <div className={fh.field}>
                <label className={fh.label}>Pseudo name</label>
                <input
                  type="text"
                  placeholder="P.Name"
                  value={searchPseudo}
                  onChange={(e) => setSearchPseudo(e.target.value)}
                  className={fh.input}
                />
              </div>
              <div className={fh.field}>
                <label className={fh.label}>Department</label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className={fh.select}
                >
                  <option value="">All departments</option>
                  {deptOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className={fh.clearBtn} onClick={clearFinanceFilters}>
                Clear filters
              </button>
            </div>
          </div>

          <div className={fh.cards}>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Employees</div>
              <div className={fh.cardValue}>{financeSummary.employees}</div>
              <div className={fh.cardMeta}>{monthInfo.label || selectedMonth}</div>
            </div>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Advance this month</div>
              <div className={fh.cardValue}>{formatWithCommas(financeSummary.advanceTotal)}</div>
              <div className={fh.cardMeta}>{financeSummary.withAdvance} employee(s)</div>
            </div>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Loan this month</div>
              <div className={fh.cardValue}>{formatWithCommas(financeSummary.loanTotal)}</div>
              <div className={fh.cardMeta}>{financeSummary.withLoan} employee(s)</div>
            </div>
            <div className={fh.card}>
              <div className={fh.cardLabel}>Final salary total</div>
              <div className={fh.cardValue}>{formatWithCommas(financeSummary.finalTotal)}</div>
              <div className={fh.cardMeta}>After deductions</div>
            </div>
          </div>

          <div className={fh.selectedBar}>
            <div className={fh.selectedText}>
              {monthInfo.label
                ? `Payroll for ${monthInfo.label}`
                : `Payroll month ${selectedMonth}`}
              {" · "}
              {financeSummary.employees} shown
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className={fh.ghostBtn}
                onClick={() => {
                  fetchAttendance();
                  fetchCommissions(selectedMonth);
                }}
              >
                Refresh
              </button>
              <button type="button" className={fh.ghostBtn} onClick={() => downloadExcel()}>
                <FaFileExcel style={{ marginRight: 6 }} />
                Export Excel
              </button>
              {showMarkPaidButton ? (
                <button type="button" className={fh.primaryBtn} onClick={openMarkPaidModal}>
                  Mark Final Loan/Advance Paid
                </button>
              ) : null}
            </div>
          </div>

          {loading ? <div className={fh.loading}>Loading payroll records...</div> : null}

          <div className={fh.panel}>
            <div className={fh.tableWrap}>
              <table className={fh.table}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Employee</th>
                    <th>P.Name</th>
                    <th>Department</th>
                    <th>Advance</th>
                    <th>Loan</th>
                    <th>Final Salary</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length > 0 ? (
                    filteredEmployees.map((employee) => {
                      const empId = employee.employeeId;
                      const taxManual = taxEditedRef.current.has(String(empId));
                      const row = getPayrollBreakdown(employee, {
                        taxAmount: taxByEmployee[empId],
                        taxManual,
                        breakExceedDed: breakExceedDedByEmployee[empId] ?? 0,
                        kpisDed: kpisDedByEmployee[empId] ?? 0,
                        otherDed: otherDedByEmployee[empId] ?? 0,
                        ctd: getCtdForEmployee(employee),
                        fuelAllowance: getFuelAllowanceForEmployee(employee),
                        unpaidDays: getUnpaidDaysForEmployee(employee),
                        medicalClaims: getClaimsForEmployee(employee),
                        medicalDedc: getMedicalDedcForEmployee(employee),
                      });
                      return (
                        <tr key={employee.employeeId}>
                          <td>{employee.employeeId}</td>
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
                          <td>{employee.pseudonym || "--"}</td>
                          <td>{employee.departmentName || "--"}</td>
                          <td style={{ color: "#dc2626", fontWeight: 600 }}>
                            {formatWithCommas(row.advanceDeduction)}
                          </td>
                          <td style={{ color: "#dc2626", fontWeight: 600 }}>
                            {formatWithCommas(row.loanDeduction)}
                          </td>
                          <td style={{ color: "#007a5a", fontWeight: 700 }}>
                            {formatWithCommas(row.finalSalary)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <div className={fh.empty}>
                          No employees match the current filters for {selectedMonth}.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {finalizeModalNode}
        {popup}
      </OptionalAdminShell>
    );
  }

  return (
    <OptionalAdminShell>
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
          <button
            onClick={() => {
              downloadExcel();
            }}
            className={styles.breakSummaryXLSButton}
          >
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
                <th>Claims</th>
                <th>Gross Salary</th>
                <th>Unpaid Days Salary</th>
                <th>Break Exceed Ded.</th>
                <th>KPIs Ded.</th>
                <th>Other Ded (fine,etc.)</th>
                <th>CTD</th>
                <th>Medical Dedc</th>
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
                  const taxManual = taxEditedRef.current.has(String(empId));
                  const breakVal = breakExceedDedByEmployee[empId] ?? 0;
                  const kpisVal = kpisDedByEmployee[empId] ?? 0;
                  const otherVal = otherDedByEmployee[empId] ?? 0;
                  const ctdVal = getCtdForEmployee(employee);
                  const fuelVal = getFuelAllowanceForEmployee(employee);
                  const unpaidVal = getUnpaidDaysForEmployee(employee);
                  const claimsVal = getClaimsForEmployee(employee);
                  const medicalDedcVal = getMedicalDedcForEmployee(employee);
                  const row = getPayrollBreakdown(employee, {
                    taxAmount: taxByEmployee[empId] ?? 0,
                    taxManual,
                    breakExceedDed: breakVal,
                    kpisDed: kpisVal,
                    otherDed: otherVal,
                    ctd: ctdVal,
                    fuelAllowance: fuelVal,
                    unpaidDays: unpaidVal,
                    medicalClaims: claimsVal,
                    medicalDedc: medicalDedcVal,
                  });
                  const taxVal = row.tax;
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
                          title={`Live from Monthly Attendance: ${getSystemUnpaidDays(employee)} unpaid days — edit only to override this session`}
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
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={claimsVal}
                          onChange={(e) => setClaimsAmount(empId, e.target.value)}
                          onBlur={(e) => saveClaimsAmount(empId, e.target.value)}
                          style={fuelInputStyle}
                          title="Claims — added to Gross Salary; saved for this month"
                        />
                      </td>
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
                      <td
                        style={{ color: '#dc2626', fontWeight: 600 }}
                        title={
                          medicalPackageByEmployee[empId]
                            ? `From ${medicalPackageByEmployee[empId]} package (Allowances)`
                            : "No medical package on Allowances"
                        }
                      >
                        {formatWithCommas(row.medicalDedc)}
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
                          onChange={(e) => {
                            taxEditedRef.current.add(String(empId));
                            setManualAmount(setTaxByEmployee, empId, e.target.value);
                          }}
                          style={manualInputStyle}
                          title="Auto from Pakistan salaried tax slabs on Net before Tax (TY 2026-27). Edit to override — Final = Net before Tax − Tax"
                        />
                      </td>
                      <td style={{ color: '#007a5a', fontWeight: 600 }}>{formatWithCommas(row.netSalary)}</td>
                      <td style={{ color: '#007a5a', fontWeight: 700 }}>{formatWithCommas(row.finalSalary)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={31} className={styles.breakSummaryNoRecords}>No records found</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {finalizeModalNode}
      {popup}
    </OptionalAdminShell>
  );
}

