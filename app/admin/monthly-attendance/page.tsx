"use client";

import React, { useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";
import { FaFileExcel } from "react-icons/fa";
import {
  downloadMonthlyAttendanceExcel,
  type MonthlyAttendanceExcelRow,
} from "../../../lib/monthly-attendance-excel";
import {
  downloadDeductionSummaryExcel,
  parseDeductionPercent,
  type DeductionSummaryDayRow,
  type DeductionSummaryEmployeeBlock,
} from "../../../lib/deduction-summary-excel";
import {
  getDateStringInTimeZone,
  getParts,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
import { compareAttendanceRows } from "../../../lib/attendance-sort";

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

function normalizeToDateKey(value: string) {
  if (!value) return "";
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (dateOnlyMatch) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.split("T")[0] || "";
  return getDateStringInTimeZone(parsed, SERVER_TIMEZONE);
}

function addDaysToDateKey(dateKey: string, daysToAdd: number) {
  const [yearStr, monthStr, dayStr] = dateKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return dateKey;
  const utc = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

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
    // Only count/show overtime if >= 45 minutes (2700 seconds)
    if (overtime >= 2700) return overtime;
    return null;
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
  const [selectedDepartment, setSelectedDepartment] = useState("");
  
  // Set default dates - start of current month to today
  const today = new Date();
  const todayStr = getDateStringInTimeZone(today);
  const firstDayOfMonth = `${todayStr.slice(0, 7)}-01`;
  
  const [fromDate, setFromDate] = useState(firstDayOfMonth);
  const [toDate, setToDate] = useState(todayStr);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(
    todayStr.slice(0, 7)
  );
  const [calendarOverrides, setCalendarOverrides] = useState<Record<string, CalendarDayOverride>>({});
  const [approvedLeavesMap, setApprovedLeavesMap] = useState<Record<string, Record<string, boolean>>>({});

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
            const startDateKey = normalizeToDateKey(String(leave.start_date || ""));
            const endDateKey = normalizeToDateKey(String(leave.end_date || ""));
            if (!startDateKey || !endDateKey) return;

            let currentDateKey = startDateKey;
            while (currentDateKey <= endDateKey) {
              leavesMap[empId][currentDateKey] = true;
              currentDateKey = addDaysToDateKey(currentDateKey, 1);
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


  // Sync filters with page: fetch data whenever any filter changes
  useEffect(() => {
    fetchAttendance();
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

    const inParts = getParts(clockIn, SERVER_TIMEZONE);
    const outParts = getParts(clockOut, SERVER_TIMEZONE);
    if (!inParts || !outParts) return 0;

    const inTimeMs = Date.UTC(
      inParts.year,
      inParts.month - 1,
      inParts.day,
      inParts.hour,
      inParts.minute,
      inParts.second
    );
    const outTimeMs = Date.UTC(
      outParts.year,
      outParts.month - 1,
      outParts.day,
      outParts.hour,
      outParts.minute,
      outParts.second
    );

    const diffMilliseconds = outTimeMs - inTimeMs;
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
    const dateKey = normalizeToDateKey(dateString);
    if (!dateKey) return "-";
    const [year, month, day] = dateKey.split("-");
    if (!year || !month || !day) return dateString;
    return `${month}/${day}/${year}`;
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
    return normalizeToDateKey(dateValue);
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
    const date = new Date(Date.UTC(year, monthIndex, day));
    const weekday = date.getUTCDay();
    return weekday !== 0 && weekday !== 6;
  }

  function buildEmployeeExcelRows(employee: any): MonthlyAttendanceExcelRow[] {
    const dataRows: MonthlyAttendanceExcelRow[] = [];
    if (!monthInfo.days) return dataRows;

    monthInfo.days.forEach((day) => {
      const dayRecords = employee.byDate[day.dateKey] || [];
      const meta = employee.dateMeta[day.dateKey];
      const workingDay = isWorkingDay(day.dateKey);

      if (dayRecords.length === 0) {
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
        dataRows.push({
          cells: [
            day.weekday,
            formatDateKey(day.dateKey),
            "---",
            "---",
            "---",
            "---",
            "---",
            meta?.runningLate ?? "",
            statusLabel,
            deduction,
          ],
          status: statusLabel,
        });
      } else {
        dayRecords.forEach((record: any) => {
          const statusLabel = meta?.statusLabel || "";
          dataRows.push({
            cells: [
              day.weekday,
              formatDateKey(day.dateKey),
              formatTime(record.clock_in),
              formatTime(record.clock_out),
              record.total_hours ? formatHoursMins(record.total_hours) : "---",
              record.assigned_working_hours
                ? formatHoursMins(record.assigned_working_hours)
                : record.assigned_shift_seconds
                  ? formatDurationHM(record.assigned_shift_seconds)
                  : "---",
              record.overtime ? formatDurationHM(record.overtime) : "---",
              meta?.runningLate ?? "",
              statusLabel,
              meta?.deduction || "",
            ],
            status: statusLabel,
          });
        });
      }
    });

    const totalDeduction = calculateTotalDeduction(employee);
    dataRows.push(
      {
        cells: ["", "", "", "", "", "", "", "", "Total Deduction:", `${totalDeduction}%`],
        status: "",
        isSummary: true,
      },
      {
        cells: ["", "", "", "", "", "", "", "", "Extra Hours:", getEmployeeTotalOvertime(employee)],
        status: "",
        isSummary: true,
      },
      {
        cells: [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Total Working Days:",
          `${getTotalWorkingDays(employee, monthInfo, approvedLeavesMap)}`,
        ],
        status: "",
        isSummary: true,
      },
    );

    return dataRows;
  }

  async function downloadExcel() {
    if (attendanceByEmployee.length === 0) {
      alert("No employees to export");
      return;
    }

    const sheets = attendanceByEmployee.map((employee) => ({
      name: employee.employeeName,
      rows: buildEmployeeExcelRows(employee),
    }));

    const dateRange = fromDate && toDate ? `-${fromDate}-to-${toDate}` : "";
    const departmentSuffix = selectedDepartment ? `-${selectedDepartment}` : "";
    const fileName = `monthly-attendance${departmentSuffix}${dateRange}.xlsx`;
    await downloadMonthlyAttendanceExcel(sheets, fileName);
  }

  async function downloadEmployeeExcel(employee: any) {
    const sheets = [
      {
        name: employee.employeeName,
        rows: buildEmployeeExcelRows(employee),
      },
    ];
    const fileName = `attendance-${employee.employeeName.replace(/\s+/g, "_")}-${selectedMonth}.xlsx`;
    await downloadMonthlyAttendanceExcel(sheets, fileName);
  }

  function shouldIncludeInDeductionSummary(statusLabel: string): boolean {
    const status = String(statusLabel || "").trim();
    return status !== "On Time" && status !== "Off" && status !== "";
  }

  function formatDeductionSummaryStatus(statusLabel: string): string {
    if (statusLabel === "Leave") return "PTO By Company";
    return statusLabel;
  }

  function formatDeductionSummaryTime(timeString: string | null): string {
    const formatted = formatTime(timeString);
    return formatted === "-" || !formatted ? "--" : formatted;
  }

  function buildDeductionSummaryBlock(employee: any): DeductionSummaryEmployeeBlock {
    const rows: DeductionSummaryDayRow[] = [];
    if (!monthInfo.days) {
      return { employeeName: employee.employeeName, rows, totalDeduction: 0 };
    }

    monthInfo.days.forEach((day) => {
      const workingDay = isWorkingDay(day.dateKey);
      if (!workingDay) return;

      const dayRecords = employee.byDate[day.dateKey] || [];
      const meta = employee.dateMeta[day.dateKey];

      if (dayRecords.length === 0) {
        let statusLabel = "Absent";
        let deduction = "100%";
        if (
          approvedLeavesMap[employee.employeeId] &&
          approvedLeavesMap[employee.employeeId][day.dateKey]
        ) {
          statusLabel = "Leave";
          deduction = "0%";
        }
        if (!shouldIncludeInDeductionSummary(statusLabel)) return;
        rows.push({
          date: formatDateKey(day.dateKey),
          clockIn: "--",
          clockOut: "--",
          status: formatDeductionSummaryStatus(statusLabel),
          tardyCount: meta?.runningLate ?? "",
          deduction,
        });
        return;
      }

      const statusLabel = meta?.statusLabel || "On Time";
      if (!shouldIncludeInDeductionSummary(statusLabel)) return;

      const record = dayRecords[0];
      rows.push({
        date: formatDateKey(day.dateKey),
        clockIn: formatDeductionSummaryTime(record.clock_in),
        clockOut: formatDeductionSummaryTime(record.clock_out),
        status: formatDeductionSummaryStatus(statusLabel),
        tardyCount: meta?.runningLate ?? "",
        deduction: meta?.deduction || "",
      });
    });

    const totalDeduction = rows.reduce(
      (sum, row) => sum + parseDeductionPercent(row.deduction),
      0,
    );

    return {
      employeeName: employee.employeeName,
      rows,
      totalDeduction,
    };
  }

  async function downloadDeductionSummary() {
    if (attendanceByEmployee.length === 0) {
      alert("No employees to export");
      return;
    }

    const blocks = attendanceByEmployee.map((employee) =>
      buildDeductionSummaryBlock(employee),
    );

    const dateRange = fromDate && toDate ? `-${fromDate}-to-${toDate}` : "";
    const departmentSuffix = selectedDepartment ? `-${selectedDepartment}` : "";
    const fileName = `deduction-summary${departmentSuffix}${dateRange}.xlsx`;
    await downloadDeductionSummaryExcel(blocks, fileName);
  }

  const monthInfo = React.useMemo(() => {
    if (!selectedMonth) return { label: "", days: [] as { day: number; dateKey: string; weekday: string }[] };
    const [yearStr, monthStr] = selectedMonth.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    if (!year || monthIndex < 0) return { label: "", days: [] };
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const label = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: SERVER_TIMEZONE,
    }).format(new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0)));
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const dateKey = `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}`;
      const weekday = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: SERVER_TIMEZONE,
      }).format(new Date(Date.UTC(year, monthIndex, day, 12, 0, 0)));
      return { day, dateKey, weekday };
    });
    return { label, days };
  }, [selectedMonth]);

  const attendanceByEmployee = React.useMemo(() => {
    const map: Record<
      string,
      {
        employeeId: string;
        employeeName: string;
        pseudonym: string;
        departmentName: string;
        byDate: Record<string, any[]>;
        dateMeta: Record<string, { runningLate: number; statusLabel: string; statusColor: string; deduction: string }>;
      }
    > = {};

    attendance.forEach((record: any) => {
      if (!record.employee_id) return;
      const empId = record.employee_id;
      if (!map[empId]) {
        map[empId] = {
          employeeId: empId,
          employeeName: record.employee_name || "-",
          pseudonym: record.pseudonym || "-",
          departmentName: record.department_name || "-",
          byDate: {},
          dateMeta: {},
        };
      }
      const dateKey = getRecordDateKey(record);
      if (!dateKey) return;
      if (!map[empId].byDate[dateKey]) map[empId].byDate[dateKey] = [];
      map[empId].byDate[dateKey].push(record);
    });

    Object.values(map).forEach((employee) => {
      Object.keys(employee.byDate).forEach((dateKey) => {
        employee.byDate[dateKey].sort(compareAttendanceRows);
      });

      const allRecords = Object.values(employee.byDate).flat();
      const sorted = [...allRecords].sort((a, b) => {
        const aKey = getRecordDateKey(a);
        const bKey = getRecordDateKey(b);
        return aKey.localeCompare(bKey);
      });
      let runningLate = 0;
      const seenDates = new Set<string>();
      sorted.forEach((record) => {
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

    return Object.values(map).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [attendance]);

  // Calculate total overtime (extra hours) for the month for an employee
  function getEmployeeTotalOvertime(emp: any) {
    let totalSeconds = 0;
    Object.values(emp.byDate).forEach((records) => {
      (records as any[]).forEach((record) => {
        // Only add overtime if >= 45 min (2700 sec)
        if (record.overtime && typeof record.overtime === 'number' && record.overtime >= 2700) {
          totalSeconds += record.overtime;
        }
      });
    });
    if (totalSeconds <= 0) return "-";
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
    return `${h}h ${m}m`;
  }

  return (
    <LayoutDashboard>
      <div className={styles.attendanceSummaryContainer}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#22223B", margin: 0 }}>
            Monthly Attendance {monthInfo.label && `- ${monthInfo.label}`}
          </h1>
          <p style={{ color: "#4A5568", fontSize: "0.9rem", marginTop: 4 }}>
            View and manage all employee attendance records
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
            onClick={fetchAttendance}
            className={styles.attendanceSummaryXLSButton}
            style={{ background: "linear-gradient(135deg, #0052CC 0%, #00B8A9 100%)" }}
          >
            Search
          </button>
          <button onClick={downloadExcel} className={styles.attendanceSummaryXLSButton}>
            <FaFileExcel /> Export Excel
          </button>
          <button
            onClick={downloadDeductionSummary}
            className={styles.attendanceSummaryXLSButton}
            style={{ background: "linear-gradient(135deg, #C53030 0%, #9B2C2C 100%)" }}
          >
            <FaFileExcel /> Deduction Summary
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 20, color: "#4A5568", textAlign: "center" }}>
            Loading attendance records...
          </div>
        ) : (
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
                      <button
                        title="Export this employee's month record as XLS"
                        style={{ background: '#27ae60', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => downloadEmployeeExcel(employee)}
                      >
                        <FaFileExcel /> Export XLS
                      </button>
                    </div>
                  </div>
                  {/* <div className={styles.attendanceMonthTitle}>{monthInfo.label}</div> */}
                  <div className={styles.attendanceEmployeeTableWrapper}>
                    <table className={`${styles.attendanceEmployeeTable} ${styles.hideAssignedWH}`}>
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>Date</th>
                          <th>Clock In</th>
                          <th>Clock Out</th>
                          <th>Total W.H</th>
                          <th>Assigned W.H</th>
                          <th>OverTime</th>
                          <th>Tardy Count</th>
                          <th>Status</th>
                          <th>Deduction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthInfo.days.flatMap((day) => {
                          const dayRecords = employee.byDate[day.dateKey] || [];
                          const meta = employee.dateMeta[day.dateKey];
                          const workingDay = isWorkingDay(day.dateKey);
                          if (dayRecords.length === 0) {
                            // Check for approved leave
                            let statusLabel = workingDay ? "Absent" : "Off";
                            let statusColor = workingDay ? "#E53E3E" : "#4A5568";
                            let deduction = workingDay ? "100%" : "";
                            if (
                              workingDay &&
                              approvedLeavesMap[employee.employeeId] &&
                              approvedLeavesMap[employee.employeeId][day.dateKey]
                            ) {
                              statusLabel = "Leave";
                              statusColor = "#3182CE"; // blue
                              deduction = "0%";
                            }
                            // Debug log for mapping
                            if (workingDay) {
                              // console.log('employeeId:', employee.employeeId, 'dateKey:', day.dateKey, 'leave:', approvedLeavesMap[employee.employeeId]?.[day.dateKey]);
                            }
                            return (
                              <tr key={`${employee.employeeId}-${day.dateKey}-empty`}>
                                <td>{day.weekday}</td>
                                <td>{formatDateKey(day.dateKey)}</td>
                                <td>---</td>
                                <td>---</td>
                                <td>---</td>
                                <td>---</td>
                                <td>---</td>
                                <td>{meta?.runningLate ? meta.runningLate : ""}</td>
                                <td style={{ color: statusColor, fontWeight: 600 }}>
                                  {statusLabel}
                                </td>
                                <td>{deduction}</td>
                              </tr>
                            );
                          }
                          return dayRecords.map((record: any, index: number) => (
                            <tr key={`${record.id ?? `${employee.employeeId}-${day.dateKey}-${index}`}`}>
                              <td>{day.weekday}</td>
                              <td>{formatDateKey(day.dateKey)}</td>
                              <td>{formatTime(record.clock_in)}</td>
                              <td>{formatTime(record.clock_out)}</td>
                              <td>{formatHoursMins(record.total_hours)}</td>
                              <td>{formatDurationHM(record.assigned_shift_seconds)}</td>
                              <td>{formatDurationHM(record.overtime)}</td>
                              <td>{meta?.runningLate ? meta.runningLate : ""}</td>
                              <td style={{ color: meta?.statusColor || "#4A5568", fontWeight: 600 }}>
                                {meta?.statusLabel || "-"}
                              </td>
                              <td>{meta?.deduction || ""}</td>
                            </tr>
                          ));
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC", borderTop: "2px solid #E2E8F0" }}>
                          <td colSpan={9} style={{ textAlign: "right", paddingRight: 16 }}>
                            Total Deduction:
                          </td>
                          <td>{calculateTotalDeduction(employee)}%</td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={9} style={{ textAlign: "right", paddingRight: 16 }}>
                            Extra Hours:
                          </td>
                          <td>{getEmployeeTotalOvertime(employee)}</td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={9} style={{ textAlign: "right", paddingRight: 16 }}>
                            Total Working Days:
                          </td>
                          <td>{getTotalWorkingDays(employee, monthInfo, approvedLeavesMap)}</td>
                        </tr>
                      </tfoot>

                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </LayoutDashboard>
  );
}
