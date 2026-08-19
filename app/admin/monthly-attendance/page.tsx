"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../break-summary/break-summary.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { FaFileExcel } from "react-icons/fa";
import {
  downloadMonthlyAttendanceExcel,
  type MonthlyAttendanceExcelRow,
} from "../../../lib/monthly-attendance-excel";
import {
  downloadDeductionSummaryExcel,
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
import {
  normalizeAttendanceStatus,
  uiStatusTextColor,
} from "../../../lib/attendance-status";
import {
  aggregateDayPunches,
  classifyDayAttendance,
  excessLateMinutesFromRaw,
  lateCountsForStatus,
  STATUS_FIRST_HALF_DAY,
  STATUS_SECOND_HALF_DAY,
} from "../../../lib/monthly-attendance-status";
import {
  formatImportedRunningLate,
  getImportedDayDisplayFields,
  importedEmployeeUsesFiveHourShift,
  importedSnapshotToAttendanceEmployees,
  loadImportedMonthlySnapshot,
  parseMonthlyAttendanceWorkbook,
  saveImportedMonthlySnapshot,
  type ImportedMonthlyDay,
  type ImportedMonthlySnapshot,
} from "../../../lib/monthly-attendance-import";
import {
  buildEmployeeReportSessions,
  loadTungstenPunchContext,
  monthlyDash,
  type EmployeeReportSession,
  type TungstenPunchContext,
} from "../../../lib/tungsten-punch-pairing";
import { AutoClockOutBadge } from "../../components/AutoClockOutBadge";
import { isAutoClockOutRecord } from "../../../lib/attendance-auto-clock-out";
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";

type MonthlyAttendanceEmployeeRow = {
  employeeId: string;
  employeeName: string;
  pseudonym: string;
  departmentName: string;
  gender: string;
  byDate: Record<string, any[]>;
  dateMeta: Record<
    string,
    {
      runningLate: number | string;
      statusLabel: string;
      statusColor: string;
      deduction: string;
      /** Billable late after 1h relaxation (0 on Absent / Half Day). */
      lateMinutes?: number;
    }
  >;
  isImported?: boolean;
  importedDays?: ImportedMonthlyDay[];
  importedFooter?: { totalDeduction?: string; extraHours?: string; workingDays?: string };
};

/** Billable late is already after 1h relaxation — show/sum any minutes > 0. */
const EXCESS_LATE_SHOW_AFTER_MINUTES = 0;

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

/** Extra work beyond assigned shift before OT is shown/counted (1 hour). */
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

  // Calculate overtime in seconds (actual - shift duration)
  function calculateOvertime(totalSeconds: number, assignedShiftSeconds: number | null): number | null {
    if (!assignedShiftSeconds || assignedShiftSeconds <= 0) return null;
    const overtime = totalSeconds - assignedShiftSeconds;
    // Only count/show overtime if >= 1 hour beyond assigned shift
    if (overtime >= OVERTIME_MIN_SECONDS) return overtime;
    return null;
  }

  function formatDurationHM(seconds: number | null) {
    if (!seconds || seconds <= 0) return "-";
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    return `${h}h ${m}m`;
  }

  /** Use UI display text when already formatted (imported rows), else format seconds. */
  function formatDurationForExport(value: number | string | null | undefined) {
    if (value == null || value === "" || value === "---" || value === "-") return "---";
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return "---";
      if (/h\s*m/i.test(s)) return s;
      return s;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      const formatted = formatDurationHM(value);
      return formatted === "-" ? "---" : formatted;
    }
    return "---";
  }

  function excelClockForExport(record: any, kind: "in" | "out") {
    const imported = record._importedDay;
    if (imported) {
      const v = kind === "in" ? imported.clockIn : imported.clockOut;
      return v && v !== "---" && v !== "-" ? v : "---";
    }
    const formatted = formatTime(kind === "in" ? record.clock_in : record.clock_out);
    return formatted === "-" ? "---" : formatted;
  }

  function excelTotalHoursForExport(record: any) {
    if (record._importedDay?.totalWH) {
      const v = record._importedDay.totalWH;
      return v && v !== "---" ? v : "---";
    }
    return record.total_hours ? formatHoursMins(record.total_hours) : "---";
  }

  function excelAssignedWHForExport(record: any) {
    if (record._importedDay?.assignedWH) {
      const v = record._importedDay.assignedWH;
      return v && v !== "---" ? v : "---";
    }
    if (record.assigned_working_hours) return formatHoursMins(record.assigned_working_hours);
    return formatDurationForExport(record.assigned_shift_seconds);
  }

  function excelOvertimeForExport(record: any) {
    if (record._importedDay?.overtime) {
      return formatDurationForExport(record._importedDay.overtime);
    }
    return formatDurationForExport(record.overtime);
  }

  const [attendance, setAttendance] = useState<any[]>([]);
  const [tardyNotes, setTardyNotes] = useState<Record<string, Record<string, string>>>({});
  const [tardyNotesByAttendanceId, setTardyNotesByAttendanceId] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchName, setSearchName] = useState("");
  /** Debounced via React — typing stays smooth; heavy filter runs on deferred value */
  const deferredSearchName = useDeferredValue(searchName);
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
  const [importedSnapshot, setImportedSnapshot] = useState<ImportedMonthlySnapshot | null>(null);
  const [tungstenCtx, setTungstenCtx] = useState<TungstenPunchContext | null>(null);
  const [pairingNow, setPairingNow] = useState(() => Date.now());
  /** Collapsed by default — full month tables for every employee freeze the browser */
  const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<Record<string, boolean>>({});
  const fetchGenRef = useRef(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const showingImported =
    Boolean(importedSnapshot?.month && importedSnapshot.month === selectedMonth && importedSnapshot.employees.length);

  function toggleEmployeeExpanded(employeeId: string) {
    setExpandedEmployeeIds((prev) => ({ ...prev, [employeeId]: !prev[employeeId] }));
  }

  // Re-pair T.Punch out as new ZKBio punches sync (background only — never blocks first paint)
  useEffect(() => {
    if (showingImported) return;
    const refreshPairing = () => {
      setPairingNow(Date.now());
      // Do not pass HRM department — ZKBio dept_name often differs (e.g. CEst. vs CEst)
      loadTungstenPunchContext(fromDate, toDate)
        .then(setTungstenCtx)
        .catch(() => {});
    };
    const id = setInterval(refreshPairing, 60_000);
    return () => clearInterval(id);
  }, [fromDate, toDate, showingImported]);

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

  // Fetch attendance first (unblocks UI), then tardy/leaves/tungsten in background
  const fetchAttendance = async () => {
    const gen = ++fetchGenRef.current;
    setLoading(true);
    let url = "/api/attendance";
    const params = new URLSearchParams();

    const attFromDate = fromDate ? addDaysToDateKey(fromDate, -1) : "";
    const attToDate = toDate ? addDaysToDateKey(toDate, 1) : "";
    if (attFromDate) params.append("fromDate", attFromDate);
    if (attToDate) params.append("toDate", attToDate);
    if (selectedDepartment) params.append("departmentName", selectedDepartment);

    if (params.toString()) {
      url += "?" + params.toString();
    }

    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (gen !== fetchGenRef.current) return;
      if (!data.success) {
        setLoading(false);
        return;
      }

      const empShiftMap: Record<string, { start: string; end: string; seconds: number }> = {};
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
          empShiftMap[record.employee_id] = {
            start: record.shift_start_time,
            end: record.shift_end_time,
            seconds: assignedShiftSeconds,
          };
        }
      });

      let records = (data.attendance || []).map((record: any) => {
        const totalSeconds =
          record.total_seconds && record.total_seconds > 0
            ? record.total_seconds
            : calculateTotalSeconds(record.clock_in, record.clock_out);
        let assignedShiftSeconds = getAssignedShiftSeconds(
          record.shift_start_time,
          record.shift_end_time,
        );
        if (
          (!assignedShiftSeconds || assignedShiftSeconds <= 0) &&
          empShiftMap[record.employee_id]
        ) {
          assignedShiftSeconds = empShiftMap[record.employee_id].seconds;
        }
        const overtimeSeconds = calculateOvertime(totalSeconds, assignedShiftSeconds);
        return {
          ...record,
          total_hours: formatDuration(totalSeconds),
          assigned_shift_seconds: assignedShiftSeconds,
          overtime: overtimeSeconds,
          is_late: record.is_late,
          late_minutes: record.late_minutes || 0,
        };
      });
      if (selectedDepartment) {
        records = records.filter(
          (r: any) =>
            (r.department_name || "").toLowerCase() === selectedDepartment.toLowerCase(),
        );
      }

      setAttendance(records);
      setLoading(false); // Show list immediately — do not wait for ZKBio / notes

      const uniqueEmployees = [...new Set(records.map((r: any) => String(r.employee_id)))] as string[];
      if (uniqueEmployees.length > 0) {
        void fetchApprovedLeaves(uniqueEmployees, fromDate, toDate);
      }

      // Background enrichment (T.Punch pairing is the slow part)
      void (async () => {
        if (fromDate && toDate) {
          try {
            const noteRes = await fetch(
              `/api/tardy-notes?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`,
              { cache: "no-store" }
            );
            const noteData = await noteRes.json();
            if (gen !== fetchGenRef.current) return;
            if (noteData.success && Array.isArray(noteData.notes)) {
              const map: Record<string, Record<string, string>> = {};
              const byAttendanceId: Record<string, string> = {};
              noteData.notes.forEach(
                (n: {
                  employee_id: string;
                  attendance_date: string;
                  attendance_id?: number | null;
                  note_label: string;
                }) => {
                  const eid = String(n.employee_id);
                  const dk = String(n.attendance_date).slice(0, 10);
                  if (n.attendance_id) {
                    byAttendanceId[String(n.attendance_id)] = n.note_label;
                    return;
                  }
                  if (!map[eid]) map[eid] = {};
                  map[eid][dk] = n.note_label;
                }
              );
              setTardyNotes(map);
              setTardyNotesByAttendanceId(byAttendanceId);
            } else {
              setTardyNotes({});
              setTardyNotesByAttendanceId({});
            }
          } catch {
            if (gen === fetchGenRef.current) {
              setTardyNotes({});
              setTardyNotesByAttendanceId({});
            }
          }
        }

        try {
          const ctx = await loadTungstenPunchContext(fromDate, toDate);
          if (gen !== fetchGenRef.current) return;
          setTungstenCtx(ctx);
        } catch (err) {
          console.error("Tungsten context load failed:", err);
        }
      })();
    } catch (err) {
      console.error("Error fetching attendance:", err);
      if (gen === fetchGenRef.current) setLoading(false);
    }
  };

  const handleImportClick = () => importInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const snapshot = parseMonthlyAttendanceWorkbook(buffer);
      if (!snapshot.employees.length) {
        toastInfo("No employee sheets found. Use monthly attendance export format (one tab per employee).");
        return;
      }
      if (!snapshot.month) {
        toastError("Could not detect month from file dates.");
        return;
      }
      saveImportedMonthlySnapshot(snapshot);
      setImportedSnapshot(snapshot);
      setSelectedMonth(snapshot.month);
      toastSuccess(`Loaded ${snapshot.employees.length} employees for ${snapshot.month}. Select that month to view.`);
    } catch (err) {
      toastError(String(err));
    } finally {
      e.target.value = "";
    }
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


  useEffect(() => {
    const loaded = loadImportedMonthlySnapshot(selectedMonth);
    if (!loaded) {
      setImportedSnapshot(null);
      return;
    }
    setImportedSnapshot(loaded);
  }, [selectedMonth]);

  // Fetch when month/dept changes — NOT on every search keystroke (that was freezing the UI)
  useEffect(() => {
    if (showingImported) {
      setTungstenCtx(null);
      setLoading(false);
      return;
    }
    setExpandedEmployeeIds({});
    fetchAttendance();
  }, [fromDate, toDate, selectedDepartment, showingImported]);

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

  function findRecordForSession(
    dayRecords: any[],
    session: EmployeeReportSession,
    usedIds?: Set<string | number>
  ) {
    if (!dayRecords.length) return undefined;
    const isUsed = (r: any) =>
      r?.id != null && usedIds != null && usedIds.has(r.id);

    const matched = dayRecords.find((r) => {
      if (isUsed(r)) return false;
      if (!r.clock_in || session.hrmClockIn === "-") return false;
      return getTimeStringInTimeZone(r.clock_in, SERVER_TIMEZONE) === session.hrmClockIn;
    });
    if (matched) return matched;

    // Next unused HRM row (never reuse the same attendance id on two session lines)
    return dayRecords.find((r) => !isUsed(r));
  }

  /** Build table/export rows so every HRM attendance OT is visible (matches Extra Hours total). */
  function getDaySessionRows(
    dayKey: string,
    dayRecords: any[],
    daySessions: EmployeeReportSession[]
  ): { session: EmployeeReportSession; record: any | undefined }[] {
    const sessionFromRecord = (record: any): EmployeeReportSession => ({
      sessionDate: dayKey,
      tungstenPunchIn: "-",
      hrmClockIn: record?.clock_in
        ? getTimeStringInTimeZone(record.clock_in, SERVER_TIMEZONE)
        : "-",
      hrmClockOut: record?.clock_out
        ? getTimeStringInTimeZone(record.clock_out, SERVER_TIMEZONE)
        : "-",
      tungstenPunchOut: "-",
    });

    if (daySessions.length === 0) {
      return dayRecords.map((record) => ({
        session: sessionFromRecord(record),
        record,
      }));
    }

    const usedIds = new Set<string | number>();
    const rows = daySessions.map((session) => {
      const record = findRecordForSession(dayRecords, session, usedIds);
      if (record?.id != null) usedIds.add(record.id);
      return { session, record };
    });

    dayRecords.forEach((record) => {
      if (record?.id != null && usedIds.has(record.id)) return;
      if (record?.id == null && rows.some((row) => row.record === record)) return;
      rows.push({ session: sessionFromRecord(record), record });
      if (record?.id != null) usedIds.add(record.id);
    });

    return rows;
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

  function formatLateTime(minutes: number | null | undefined) {
    if (!minutes || minutes <= 0) return "-";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `Late ${h}h ${m}m`;
  }

  function isExcessLateMinutes(minutes: number | null | undefined) {
    return typeof minutes === "number" && minutes > EXCESS_LATE_SHOW_AFTER_MINUTES;
  }

  /** Resolve billable late for a day: never on Absent/Half Day; 1h already stripped. */
  function billableLateForDay(
    statusLabel: string,
    dayStatusLateMinutes: number,
    recordLateMinutes: number | null | undefined,
  ): number {
    if (!lateCountsForStatus(statusLabel)) return 0;
    // classifyDayAttendance already returns excess; prefer it
    if (dayStatusLateMinutes > 0) return dayStatusLateMinutes;
    // DB stores raw minutes from shift start — convert to excess
    if (recordLateMinutes != null && Number(recordLateMinutes) > 0) {
      return excessLateMinutesFromRaw(Number(recordLateMinutes));
    }
    return 0;
  }

  function statusCellText(statusLabel: string, lateMinutes?: number | null) {
    if (!isExcessLateMinutes(lateMinutes)) return statusLabel;
    return `${statusLabel} (${formatLateTime(lateMinutes)})`;
  }

  function renderStatusWithExcessLate(
    statusLabel: string,
    lateMinutes?: number | null,
  ): React.ReactNode {
    return (
      <>
        {statusLabel}
        {isExcessLateMinutes(lateMinutes) ? (
          <div style={{ fontWeight: 500, fontSize: 12, color: "#c05621", marginTop: 2 }}>
            {formatLateTime(lateMinutes)}
          </div>
        ) : null}
      </>
    );
  }

  function getDateKey(dateValue: string) {
    return normalizeToDateKey(dateValue);
  }

  function getRecordDateKey(record: any) {
    return getDateKey(record.clock_in || record.clock_out || record.date || "");
  }

  function calculateTotalDeduction(employee: any) {
    if (employee.isImported) {
      if (employee.importedDays?.length && importedEmployeeUsesFiveHourShift(employee.importedDays)) {
        let total = 0;
        (employee.importedDays as ImportedMonthlyDay[]).forEach((day) => {
          const { deduction } = getImportedDayDisplayFields(day, { fiveHourShift: true });
          if (deduction) total += parseInt(String(deduction).replace(/%/g, ""), 10) || 0;
        });
        return total;
      }
      const fromFooter = employee.importedFooter?.totalDeduction;
      if (fromFooter != null && String(fromFooter).trim() !== "") {
        return parseInt(String(fromFooter).replace(/%/g, ""), 10) || 0;
      }
      let total = 0;
      (employee.importedDays || []).forEach((day: ImportedMonthlyDay) => {
        const ded = day.sheetDeduction ?? day.deduction ?? employee.dateMeta?.[day.dateKey]?.deduction;
        if (ded) total += parseInt(String(ded).replace(/%/g, ""), 10) || 0;
      });
      return total;
    }

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

  function tardyNoteForCell(
    employeeId: string,
    dateKey: string,
    statusLabel: string,
    attendanceId?: number | null,
    dayRecords?: Array<{ id?: number | null }>
  ): string {
    const isTardy = normalizeAttendanceStatus(statusLabel) === "Tardy";
    if (!isTardy) return "";

    if (attendanceId != null) {
      const bySession = tardyNotesByAttendanceId[String(attendanceId)];
      if (bySession) return bySession;
      const legacy = tardyNotes[employeeId]?.[dateKey];
      if (legacy) return legacy;
      return "-";
    }

    for (const rec of dayRecords || []) {
      if (rec?.id == null) continue;
      const bySession = tardyNotesByAttendanceId[String(rec.id)];
      if (bySession) return bySession;
    }

    const saved = tardyNotes[employeeId]?.[dateKey];
    if (saved) return saved;
    return "-";
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

  /** Pair T.Punch for this employee even if their card is collapsed (export needs every sheet). */
  function pairSessionsForEmployee(
    employee: { employeeId: string; employeeName: string; isImported?: boolean },
    ctx: TungstenPunchContext | null,
  ): EmployeeReportSession[] {
    if (employee.isImported) return [];
    const todayKey = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    const zkFrom = fromDate ? addDaysToDateKey(fromDate, -1) : "";
    const zkTo = toDate ? addDaysToDateKey(toDate, 1) : "";
    const allRecords = attendance.filter(
      (record: any) => String(record.employee_id) === String(employee.employeeId),
    );
    return buildEmployeeReportSessions(
      employee.employeeName,
      allRecords,
      ctx,
      todayKey,
      Date.now(),
      zkFrom,
      zkTo,
    );
  }

  async function ensureTungstenCtx(): Promise<TungstenPunchContext | null> {
    if (showingImported) return null;
    try {
      const ctx = await loadTungstenPunchContext(fromDate, toDate);
      setTungstenCtx(ctx);
      return ctx;
    } catch {
      return tungstenCtx;
    }
  }

  function buildEmployeeExcelRows(
    employee: any,
    pairedSessions?: EmployeeReportSession[],
  ): MonthlyAttendanceExcelRow[] {
    const dataRows: MonthlyAttendanceExcelRow[] = [];
    if (!monthInfo.days) return dataRows;

    if (employee.isImported && employee.importedDays?.length) {
      const days = [...employee.importedDays].sort((a: ImportedMonthlyDay, b: ImportedMonthlyDay) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      const fiveHourShift = importedEmployeeUsesFiveHourShift(days);
      days.forEach((day: ImportedMonthlyDay) => {
        const meta = employee.dateMeta?.[day.dateKey];
        const statusLabel = meta?.statusLabel ?? getImportedDayDisplayFields(day, { fiveHourShift }).status;
        const deduction = meta?.deduction ?? getImportedDayDisplayFields(day, { fiveHourShift }).deduction;
        const tardyDisplay = formatImportedRunningLate(meta?.runningLate);
        dataRows.push({
          cells: [
            day.weekday,
            day.dateDisplay,
            day.tPunchIn && day.tPunchIn !== "---" ? day.tPunchIn : "---",
            day.clockIn,
            day.clockOut,
            day.tPunchOut && day.tPunchOut !== "---" ? day.tPunchOut : "---",
            day.totalWH,
            day.assignedWH,
            day.overtime,
            tardyDisplay,
            statusCellText(statusLabel, meta?.lateMinutes),
            tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel),
            deduction,
          ],
          status: statusLabel,
        });
      });
      const footer = employee.importedFooter;
      const totalDeduction =
        footer?.totalDeduction != null && String(footer.totalDeduction).trim() !== ""
          ? String(footer.totalDeduction).replace(/%$/, "")
          : String(calculateTotalDeduction(employee));
      dataRows.push(
        {
          cells: ["", "", "", "", "", "", "", "", "", "", "Total Deduction:", "", `${totalDeduction}%`],
          status: "",
          isSummary: true,
        },
        {
          cells: ["", "", "", "", "", "", "", "", "", "", "Extra Hours:", "", getEmployeeTotalOvertime(employee)],
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
            "",
            "",
            "Late Exceed:",
            "",
            getEmployeeTotalExcessLate(employee),
          ],
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
            "",
            "",
            "Total Working Days:",
            "",
            footer?.workingDays ?? `${getTotalWorkingDays(employee, monthInfo, approvedLeavesMap)}`,
          ],
          status: "",
          isSummary: true,
        },
      );
      return dataRows;
    }

    const employeeSessions =
      pairedSessions ?? sessionsByEmployeeId.get(employee.employeeId) ?? [];

    monthInfo.days.forEach((day) => {
      const dayRecords = employee.byDate[day.dateKey] || [];
      const meta = employee.dateMeta[day.dateKey];
      const workingDay = isWorkingDay(day.dateKey);
      const daySessions = employeeSessions.filter((s) => s.sessionDate === day.dateKey);

      if (daySessions.length === 0 && dayRecords.length === 0) {
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
            "---",
            "---",
            meta?.runningLate ?? "",
            statusLabel,
            tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel, undefined, dayRecords),
            deduction,
          ],
          status: statusLabel,
        });
        return;
      }

      const sessionsToExport = getDaySessionRows(day.dateKey, dayRecords, daySessions);

      if (sessionsToExport.length === 0) {
        // handled above when no sessions and no records
      }

      sessionsToExport.forEach(({ session, record }, sessionIndex) => {
        const statusLabel = normalizeAttendanceStatus(meta?.statusLabel || "");
        dataRows.push({
          cells: [
            day.weekday,
            formatDateKey(day.dateKey),
            monthlyDash(session.tungstenPunchIn),
            session.hrmClockIn === "-" ? "---" : session.hrmClockIn,
            session.hrmClockOut === "-" ? "---" : session.hrmClockOut,
            monthlyDash(session.tungstenPunchOut),
            record ? excelTotalHoursForExport(record) : "---",
            record ? excelAssignedWHForExport(record) : "---",
            record ? excelOvertimeForExport(record) : "---",
            meta?.runningLate ?? "",
            sessionIndex === 0
              ? statusCellText(statusLabel, meta?.lateMinutes)
              : statusLabel,
            tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel, record?.id, dayRecords),
            meta?.deduction || "",
          ],
          status: statusLabel,
        });
      });
    });

    const totalDeduction = calculateTotalDeduction(employee);
    dataRows.push(
      {
        cells: ["", "", "", "", "", "", "", "", "", "", "Total Deduction:", "", `${totalDeduction}%`],
        status: "",
        isSummary: true,
      },
      {
        cells: ["", "", "", "", "", "", "", "", "", "", "Extra Hours:", "", getEmployeeTotalOvertime(employee)],
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
          "",
          "",
          "Late Exceed:",
          "",
          getEmployeeTotalExcessLate(employee),
        ],
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
          "",
          "",
          "Total Working Days:",
          "",
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
      toastInfo("No employees to export");
      return;
    }

    const ctx = await ensureTungstenCtx();
    const sheets = attendanceByEmployee.map((employee) => ({
      name: employee.employeeName,
      rows: buildEmployeeExcelRows(employee, pairSessionsForEmployee(employee, ctx)),
    }));

    const dateRange = fromDate && toDate ? `-${fromDate}-to-${toDate}` : "";
    const departmentSuffix = selectedDepartment ? `-${selectedDepartment}` : "";
    const fileName = `monthly-attendance${departmentSuffix}${dateRange}.xlsx`;
    await downloadMonthlyAttendanceExcel(sheets, fileName);
  }

  async function downloadEmployeeExcel(employee: any) {
    const ctx = await ensureTungstenCtx();
    const sheets = [
      {
        name: employee.employeeName,
        rows: buildEmployeeExcelRows(employee, pairSessionsForEmployee(employee, ctx)),
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

  function deductionSummaryClock(
    record: any,
    employee: any,
    dateKey: string,
    kind: "in" | "out",
  ): string {
    const imported = record?._importedDay;
    if (imported) {
      const v = kind === "in" ? imported.clockIn : imported.clockOut;
      if (v && v !== "---" && v !== "-" && v !== "--") return v;
      return "--";
    }
    if (employee?.isImported && Array.isArray(employee.importedDays)) {
      const day = employee.importedDays.find((d: { dateKey: string }) => d.dateKey === dateKey);
      if (day) {
        const v = kind === "in" ? day.clockIn : day.clockOut;
        if (v && v !== "---" && v !== "-" && v !== "--") return v;
      }
      return "--";
    }
    return formatDeductionSummaryTime(kind === "in" ? record?.clock_in : record?.clock_out);
  }

  function deductionSummaryTungsten(value: string) {
    if (!value || value === "-" || value === "---") return "--";
    return value;
  }

  function pushDeductionSummaryRow(
    rows: DeductionSummaryDayRow[],
    employee: any,
    dateKey: string,
    statusLabel: string,
    deduction: string,
    tardyCount: number | string,
    options: {
      session?: EmployeeReportSession;
      record?: any;
      importedDay?: ImportedMonthlyDay;
    } = {},
  ) {
    if (!shouldIncludeInDeductionSummary(statusLabel)) return;

    const dayRecords = employee.byDate[dateKey] || [];
    const { session, importedDay } = options;
    const record =
      options.record ??
      (session ? findRecordForSession(dayRecords, session) : dayRecords[0]);

    rows.push({
      date: formatDateKey(dateKey),
      tPunchIn: importedDay
        ? deductionSummaryTungsten(importedDay.tPunchIn || "---")
        : session
          ? deductionSummaryTungsten(monthlyDash(session.tungstenPunchIn))
          : "--",
      clockIn:
        session && session.hrmClockIn !== "-"
          ? session.hrmClockIn
          : deductionSummaryClock(record, employee, dateKey, "in"),
      clockOut:
        session && session.hrmClockOut !== "-"
          ? session.hrmClockOut
          : deductionSummaryClock(record, employee, dateKey, "out"),
      tPunchOut: importedDay
        ? deductionSummaryTungsten(importedDay.tPunchOut || "---")
        : session
          ? deductionSummaryTungsten(monthlyDash(session.tungstenPunchOut))
          : "--",
      totalWorkingHours: importedDay
        ? deductionSummaryTungsten(importedDay.totalWH || "---")
        : record?.total_hours
          ? formatHoursMins(record.total_hours)
          : "--",
      status: formatDeductionSummaryStatus(normalizeAttendanceStatus(statusLabel)),
      tardyCount,
      tardyNote: tardyNoteForCell(
        employee.employeeId,
        dateKey,
        statusLabel,
        record?.id,
        dayRecords,
      ),
      deduction,
    });
  }

  function buildDeductionSummaryBlock(
    employee: any,
    pairedSessions?: EmployeeReportSession[],
  ): DeductionSummaryEmployeeBlock {
    const rows: DeductionSummaryDayRow[] = [];
    if (!monthInfo.days) {
      return { employeeName: employee.employeeName, rows, totalDeduction: 0 };
    }

    if (employee.isImported && employee.importedDays?.length) {
      const days = [...employee.importedDays].sort((a: ImportedMonthlyDay, b: ImportedMonthlyDay) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      const fiveHourShift = importedEmployeeUsesFiveHourShift(days);
      days.forEach((day: ImportedMonthlyDay) => {
        if (!isWorkingDay(day.dateKey)) return;
        const meta = employee.dateMeta?.[day.dateKey];
        const statusLabel =
          meta?.statusLabel ?? getImportedDayDisplayFields(day, { fiveHourShift }).status;
        const deduction =
          meta?.deduction ?? getImportedDayDisplayFields(day, { fiveHourShift }).deduction;
        pushDeductionSummaryRow(
          rows,
          employee,
          day.dateKey,
          statusLabel,
          deduction,
          formatImportedRunningLate(meta?.runningLate),
          { importedDay: day },
        );
      });
    } else {
      const employeeSessions =
        pairedSessions ?? sessionsByEmployeeId.get(employee.employeeId) ?? [];

      monthInfo.days.forEach((day) => {
        if (!isWorkingDay(day.dateKey)) return;

        const dayRecords = employee.byDate[day.dateKey] || [];
        const meta = employee.dateMeta[day.dateKey];
        const daySessions = employeeSessions.filter((s) => s.sessionDate === day.dateKey);

        if (dayRecords.length === 0 && daySessions.length === 0) {
          let statusLabel = "Absent";
          let deduction = "100%";
          if (
            approvedLeavesMap[employee.employeeId] &&
            approvedLeavesMap[employee.employeeId][day.dateKey]
          ) {
            statusLabel = "Leave";
            deduction = "0%";
          }
          pushDeductionSummaryRow(
            rows,
            employee,
            day.dateKey,
            statusLabel,
            deduction,
            meta?.runningLate ?? "",
          );
          return;
        }

        const statusLabel = meta?.statusLabel || "On Time";
        if (!shouldIncludeInDeductionSummary(statusLabel)) return;

        const deduction = meta?.deduction || "";
        const tardyCount = meta?.runningLate ?? "";
        const sessionsToExport = getDaySessionRows(day.dateKey, dayRecords, daySessions);

        sessionsToExport.forEach(({ session, record }) => {
          pushDeductionSummaryRow(rows, employee, day.dateKey, statusLabel, deduction, tardyCount, {
            session,
            record,
          });
        });
      });
    }

    return {
      employeeName: employee.employeeName,
      rows,
      totalDeduction: calculateTotalDeduction(employee),
    };
  }

  async function downloadDeductionSummary() {
    if (attendanceByEmployee.length === 0) {
      toastInfo("No employees to export");
      return;
    }

    const ctx = await ensureTungstenCtx();
    const blocks = attendanceByEmployee.map((employee) =>
      buildDeductionSummaryBlock(employee, pairSessionsForEmployee(employee, ctx)),
    );

    const dateRange = fromDate && toDate ? `-${fromDate}-to-${toDate}` : "";
    const departmentSuffix = selectedDepartment ? `-${selectedDepartment}` : "";
    const fileName = `deduction-summary${departmentSuffix}${dateRange}.xlsx`;
    await downloadDeductionSummaryExcel(blocks, fileName);
  }

  const monthInfo = useMemo(() => {
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

  /** Heavy build — only when attendance/import/dept data changes (not on each search key). */
  const attendanceByEmployeeAll = useMemo((): MonthlyAttendanceEmployeeRow[] => {
    if (showingImported && importedSnapshot) {
      let employees = importedSnapshotToAttendanceEmployees(importedSnapshot);
      if (selectedDepartment) {
        employees = employees.filter(
          (e) => (e.departmentName || "").toLowerCase() === selectedDepartment.toLowerCase(),
        );
      }
      return employees;
    }

    const map: Record<string, MonthlyAttendanceEmployeeRow> = {};

    attendance.forEach((record: any) => {
      if (!record.employee_id) return;
      const empId = record.employee_id;
      if (!map[empId]) {
        map[empId] = {
          employeeId: empId,
          employeeName: record.employee_name || "-",
          pseudonym: record.pseudonym || "-",
          departmentName: record.department_name || "-",
          gender: record.gender || "",
          byDate: {},
          dateMeta: {},
        };
      }
      if (!map[empId].gender && record.gender) {
        map[empId].gender = record.gender;
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

        const statusLabel = normalizeAttendanceStatus(dayStatus.statusLabel);
        const statusColor = uiStatusTextColor(statusLabel);
        let deduction = "";
        let tardyDisplay: number | string = "";

        // Fetch pads ±1 day for overnight/ZK pairing — do NOT count those padding
        // days in monthly tardy running total (otherwise first visible tardy shows as 2).
        const inSelectedMonth =
          (!fromDate || dateKey >= fromDate) && (!toDate || dateKey <= toDate);

        if (statusLabel === "Tardy" && dayStatus.isLate) {
          if (inSelectedMonth) {
            runningLate += 1;
            tardyDisplay = runningLate;
            if (runningLate === 4) deduction = "50%";
            else if (runningLate >= 5) deduction = "100%";
            else deduction = "0%";
          }
        } else if (statusLabel === "Absent") {
          deduction = "100%";
        } else if (statusLabel === STATUS_FIRST_HALF_DAY || statusLabel === STATUS_SECOND_HALF_DAY) {
          deduction = "50%";
        }

        employee.dateMeta[dateKey] = {
          runningLate: tardyDisplay,
          statusLabel,
          statusColor,
          deduction,
          // Absent / Half Day → 0; Tardy → minutes after 1h relaxation only
          lateMinutes: billableLateForDay(
            statusLabel,
            dayStatus.lateMinutes || 0,
            record?.late_minutes != null ? Number(record.late_minutes) : null,
          ),
        };
      });
    });

    return Object.values(map).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [attendance, showingImported, importedSnapshot, selectedDepartment, fromDate, toDate]);

  /** Cheap name / pseudo / ID filter — deferred so typing does not block the input */
  const attendanceByEmployee = useMemo(() => {
    const term = deferredSearchName.trim().toLowerCase();
    if (!term) return attendanceByEmployeeAll;
    return attendanceByEmployeeAll.filter((e) => {
      const name = (e.employeeName || "").toLowerCase();
      const pseudo = (e.pseudonym || "").toLowerCase();
      const id = String(e.employeeId || "").toLowerCase();
      return name.includes(term) || pseudo.includes(term) || id.includes(term);
    });
  }, [attendanceByEmployeeAll, deferredSearchName]);

  const sessionsByEmployeeId = useMemo(() => {
    const out = new Map<string, EmployeeReportSession[]>();
    if (showingImported) return out;
    const todayKey = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    const zkFrom = fromDate ? addDaysToDateKey(fromDate, -1) : "";
    const zkTo = toDate ? addDaysToDateKey(toDate, 1) : "";
    const recordsByEmployeeId = new Map<string, { clock_in?: string | null; clock_out?: string | null }[]>();
    attendance.forEach((record: any) => {
      const id = String(record.employee_id || "");
      if (!id) return;
      const list = recordsByEmployeeId.get(id) || [];
      list.push(record);
      recordsByEmployeeId.set(id, list);
    });
    // Only pair Tungsten for expanded cards — pairing everyone on load freezes the UI
    attendanceByEmployeeAll.forEach((emp) => {
      if (!expandedEmployeeIds[emp.employeeId]) return;
      const allRecords = recordsByEmployeeId.get(emp.employeeId) || [];
      out.set(
        emp.employeeId,
        buildEmployeeReportSessions(
          emp.employeeName,
          allRecords,
          tungstenCtx,
          todayKey,
          pairingNow,
          zkFrom,
          zkTo,
        ),
      );
    });
    return out;
  }, [
    attendance,
    attendanceByEmployeeAll,
    expandedEmployeeIds,
    tungstenCtx,
    showingImported,
    fromDate,
    toDate,
    pairingNow,
  ]);

  // Narrow search → auto-expand matched employees so results are one click less
  useEffect(() => {
    const term = deferredSearchName.trim();
    if (!term || attendanceByEmployee.length === 0 || attendanceByEmployee.length > 8) return;
    setExpandedEmployeeIds((prev) => {
      const next = { ...prev };
      let changed = false;
      attendanceByEmployee.forEach((e) => {
        if (!next[e.employeeId]) {
          next[e.employeeId] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [deferredSearchName, attendanceByEmployee]);

  // Extra Hours = sum of OT values shown in the table for this month (not hidden records).
  function getEmployeeTotalOvertime(emp: any) {
    if (emp.isImported && emp.importedFooter?.extraHours) {
      const v = emp.importedFooter.extraHours.trim();
      return v && v !== "-" ? v : "-";
    }
    const employeeSessions = sessionsByEmployeeId.get(emp.employeeId) || [];
    const countedKeys = new Set<string>();
    let totalMinutes = 0;

    (monthInfo.days || []).forEach((day: { dateKey: string }) => {
      const dayRecords = emp.byDate?.[day.dateKey] || [];
      const daySessions = employeeSessions.filter((s) => s.sessionDate === day.dateKey);
      const rows = getDaySessionRows(day.dateKey, dayRecords, daySessions);

      rows.forEach(({ record }) => {
        if (!record) return;
        const key =
          record.id != null
            ? `id:${record.id}`
            : `row:${day.dateKey}:${record.clock_in || ""}:${record.clock_out || ""}`;
        if (countedKeys.has(key)) return;
        countedKeys.add(key);

        // Same text the OT column shows — footer must match a manual sum of that column
        const label = formatDurationHM(record.overtime);
        if (!label || label === "-") return;
        const match = label.match(/(\d+)\s*h\s*(\d+)\s*m/i);
        if (!match) return;
        totalMinutes += parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      });
    });

    if (totalMinutes <= 0) return "-";
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const m = (totalMinutes % 60).toString().padStart(2, "0");
    return `${h}h ${m}m`;
  }

  /** Month total of billable late (after 1h relaxation; excludes Absent / Half Day). */
  function getEmployeeTotalExcessLate(emp: any) {
    let totalMinutes = 0;
    const days: { dateKey: string }[] = monthInfo.days || [];
    days.forEach((day) => {
      const meta = emp.dateMeta?.[day.dateKey];
      const late = meta?.lateMinutes;
      if (!lateCountsForStatus(meta?.statusLabel)) return;
      if (isExcessLateMinutes(late)) totalMinutes += Number(late);
    });
    if (totalMinutes <= 0) return "-";
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const m = (totalMinutes % 60).toString().padStart(2, "0");
    return `${h}h ${m}m`;
  }

  return (
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer}>
        <div style={{ marginBottom: 20 }}>
          <h1 className={styles.pageTitle}>
            Monthly Attendance {monthInfo.label && `- ${monthInfo.label}`}
          </h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            View and manage all employee attendance records
          </p>
          {showingImported && (
            <p style={{ color: "#611f69", fontSize: "0.85rem", marginTop: 8, fontWeight: 600 }}>
              Showing imported Excel data for {monthInfo.label} (sheet values as-is)
            </p>
          )}
        </div>

        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name or pseudo name..."
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
            onClick={fetchAttendance}
            className={styles.breakSummaryXLSButton}
          >
            Search
          </button>
          <button onClick={downloadExcel} className={styles.breakSummaryXLSButton}>
            <FaFileExcel /> Export Excel
          </button>
          <button
            onClick={handleImportClick}
            className={`${styles.breakSummaryXLSButton} ${styles.breakSummaryXLSButtonSecondary}`}
          >
            <FaFileExcel /> Import Excel
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
          <button
            onClick={downloadDeductionSummary}
            className={styles.breakSummaryXLSButton}
            style={{ background: "linear-gradient(135deg, #C53030 0%, #9B2C2C 100%)", boxShadow: "0 4px 14px rgba(197, 48, 48, 0.22)" }}
          >
            <FaFileExcel /> Deduction Summary
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 20, color: "#64748b", textAlign: "center" }}>
            Loading attendance records...
          </div>
        ) : (
          <div style={{ display: "grid", gap: 20, width: "100%" }}>
            {attendanceByEmployee.length === 0 ? (
              <div className={styles.breakSummaryNoRecords}>No attendance records found</div>
            ) : (
              attendanceByEmployee.map((employee) => {
                const isExpanded = Boolean(expandedEmployeeIds[employee.employeeId]);
                return (
                <div
                  key={employee.employeeId}
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    border: "1px solid #e8edf3",
                    boxShadow: "0 8px 32px rgba(97, 31, 105, 0.08)",
                    padding: 16,
                    width: "100%",
                    boxSizing: "border-box",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: isExpanded ? 8 : 0 }}>
                    <div>
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
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, paddingLeft: 44 }}>
                        {employee.pseudonym} · {employee.departmentName}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700, color: "#611f69", fontSize: "1rem" }}>Emp. ID {employee.employeeId}</div>
                      <button
                        type="button"
                        title={isExpanded ? "Hide month table" : "Show month table"}
                        className={styles.breakSummaryXLSButton}
                        style={{ padding: "6px 12px", fontSize: 12, background: isExpanded ? "#64748b" : undefined }}
                        onClick={() => toggleEmployeeExpanded(employee.employeeId)}
                      >
                        {isExpanded ? "Hide details" : "View details"}
                      </button>
                      <button
                        title="Export this employee's month record as XLS"
                        className={styles.breakSummaryXLSButton}
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={() => downloadEmployeeExcel(employee)}
                      >
                        <FaFileExcel /> Export XLS
                      </button>
                    </div>
                  </div>
                  {isExpanded ? (
                  <div className={styles.breakSummaryTableWrapper}>
                    <table className={styles.breakSummaryTable} style={{ minWidth: 1200 }}>
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>Date</th>
                          <th>T.Punch in</th>
                          <th>Clock In</th>
                          <th>Clock Out</th>
                          <th>T.Punch out</th>
                          <th>Total W.H</th>
                          <th style={{ display: "none" }}>Assigned W.H</th>
                          <th>OverTime</th>
                          <th>Tardy Count</th>
                          <th>Status</th>
                          <th style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280 }}>Tardy Note</th>
                          <th>Deduction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(employee.isImported && employee.importedDays
                          ? employee.importedDays.map((day: any) => ({
                              dateKey: day.dateKey,
                              weekday: day.weekday,
                              dateDisplay: day.dateDisplay,
                              imported: day,
                              meta: employee.dateMeta[day.dateKey],
                            }))
                          : monthInfo.days.map((day) => ({
                              dateKey: day.dateKey,
                              weekday: day.weekday,
                              dateDisplay: formatDateKey(day.dateKey),
                              imported: null,
                              meta: employee.dateMeta[day.dateKey],
                              day,
                            }))
                        ).flatMap((rowCtx: any) => {
                          if (rowCtx.imported) {
                            const day = rowCtx.imported as ImportedMonthlyDay;
                            const fiveHourShift = importedEmployeeUsesFiveHourShift(
                              employee.importedDays || [],
                            );
                            const meta = employee.dateMeta?.[day.dateKey];
                            const rowStatus =
                              meta?.statusLabel ??
                              getImportedDayDisplayFields(day, { fiveHourShift }).status;
                            const rowDeduction =
                              meta?.deduction ??
                              getImportedDayDisplayFields(day, { fiveHourShift }).deduction;
                            const tardyDisplay = formatImportedRunningLate(meta?.runningLate);
                            return (
                              <tr key={`${employee.employeeId}-${day.dateKey}-import`}>
                                <td>{day.weekday || rowCtx.weekday}</td>
                                <td>{day.dateDisplay}</td>
                                <td>
                                  {day.tPunchIn && day.tPunchIn !== "---" ? day.tPunchIn : "---"}
                                </td>
                                <td>{day.clockIn}</td>
                                <td>{day.clockOut}</td>
                                <td>
                                  {day.tPunchOut && day.tPunchOut !== "---" ? day.tPunchOut : "---"}
                                </td>
                                <td>{day.totalWH}</td>
                                <td style={{ display: "none" }}>{day.assignedWH}</td>
                                <td>{day.overtime}</td>
                                <td>{tardyDisplay}</td>
                                <td style={{ color: uiStatusTextColor(rowStatus), fontWeight: 600 }}>
                                  {renderStatusWithExcessLate(rowStatus, meta?.lateMinutes)}
                                </td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>{tardyNoteForCell(employee.employeeId, day.dateKey, rowStatus)}</td>
                                <td>{rowDeduction}</td>
                              </tr>
                            );
                          }

                          const day = rowCtx.day;
                          const dayRecords = employee.byDate[day.dateKey] || [];
                          const meta = rowCtx.meta;
                          const workingDay = isWorkingDay(day.dateKey);
                          const employeeSessions = sessionsByEmployeeId.get(employee.employeeId) || [];
                          const daySessions = employeeSessions.filter(
                            (s) => s.sessionDate === day.dateKey,
                          );

                          if (daySessions.length === 0 && dayRecords.length === 0) {
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
                            return (
                              <tr key={`${employee.employeeId}-${day.dateKey}-empty`}>
                                <td>{day.weekday}</td>
                                <td>{formatDateKey(day.dateKey)}</td>
                                <td>---</td>
                                <td>---</td>
                                <td>---</td>
                                <td>---</td>
                                <td>---</td>
                                <td style={{ display: "none" }}>---</td>
                                <td>---</td>
                                <td>{meta?.runningLate ? meta.runningLate : ""}</td>
                                <td style={{ color: uiStatusTextColor(statusLabel), fontWeight: 600 }}>
                                  {renderStatusWithExcessLate(
                                    normalizeAttendanceStatus(statusLabel),
                                    meta?.lateMinutes,
                                  )}
                                </td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>{tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel, undefined, dayRecords)}</td>
                                <td>{deduction}</td>
                              </tr>
                            );
                          }

                          const recordStatus = normalizeAttendanceStatus(meta?.statusLabel || "-");
                          const sessionsToShow = getDaySessionRows(
                            day.dateKey,
                            dayRecords,
                            daySessions
                          );

                          return sessionsToShow.map(({ session, record }, index) => {
                            return (
                              <tr
                                key={`${employee.employeeId}-${day.dateKey}-session-${index}`}
                              >
                                <td>{day.weekday}</td>
                                <td>{formatDateKey(day.dateKey)}</td>
                                <td>{monthlyDash(session.tungstenPunchIn)}</td>
                                <td>
                                  {session.hrmClockIn === "-" ? "---" : session.hrmClockIn}
                                </td>
                                <td>
                                  {session.hrmClockOut === "-" ? (
                                    "---"
                                  ) : (
                                    <>
                                      {session.hrmClockOut}
                                      {isAutoClockOutRecord(record?.auto_clock_out) ? (
                                        <AutoClockOutBadge />
                                      ) : null}
                                    </>
                                  )}
                                </td>
                                <td>{monthlyDash(session.tungstenPunchOut)}</td>
                                <td>
                                  {record ? formatHoursMins(record.total_hours) : "---"}
                                </td>
                                <td style={{ display: "none" }}>
                                  {record
                                    ? formatDurationHM(record.assigned_shift_seconds)
                                    : "---"}
                                </td>
                                <td>
                                  {record ? formatDurationHM(record.overtime) : "---"}
                                </td>
                                <td>{meta?.runningLate ? meta.runningLate : ""}</td>
                                <td
                                  style={{
                                    color: uiStatusTextColor(recordStatus),
                                    fontWeight: 600,
                                  }}
                                >
                                  {index === 0
                                    ? renderStatusWithExcessLate(recordStatus, meta?.lateMinutes)
                                    : recordStatus}
                                </td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>
                                  {tardyNoteForCell(
                                    employee.employeeId,
                                    day.dateKey,
                                    recordStatus,
                                    record?.id,
                                    dayRecords
                                  )}
                                </td>
                                <td>{meta?.deduction || ""}</td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC", borderTop: "2px solid #E2E8F0" }}>
                          <td colSpan={12} style={{ textAlign: "right", paddingRight: 16 }}>
                            Total Deduction:
                          </td>
                          <td>
                            {employee.isImported && employee.importedFooter?.totalDeduction != null
                              ? `${String(employee.importedFooter.totalDeduction).replace(/%$/, "")}%`
                              : `${calculateTotalDeduction(employee)}%`}
                          </td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={12} style={{ textAlign: "right", paddingRight: 16 }}>
                            Extra Hours:
                          </td>
                          <td>
                            {employee.isImported && employee.importedFooter?.extraHours
                              ? employee.importedFooter.extraHours
                              : getEmployeeTotalOvertime(employee)}
                          </td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={12} style={{ textAlign: "right", paddingRight: 16 }}>
                            Late Exceed:
                          </td>
                          <td>{getEmployeeTotalExcessLate(employee)}</td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={12} style={{ textAlign: "right", paddingRight: 16 }}>
                            Total Working Days:
                          </td>
                          <td>
                            {employee.isImported && employee.importedFooter?.workingDays
                              ? employee.importedFooter.workingDays
                              : getTotalWorkingDays(employee, monthInfo, approvedLeavesMap)}
                          </td>
                        </tr>
                      </tfoot>

                    </table>
                  </div>
                  ) : (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8", paddingLeft: 4 }}>
                      Click <strong>View details</strong> to load this employee&apos;s month table.
                    </p>
                  )}
                </div>
                );
              })
            )}
          </div>
        )}
      </div>
      {popup}
    </LayoutDashboard>
  );
}
