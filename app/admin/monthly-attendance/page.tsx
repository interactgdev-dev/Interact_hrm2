"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "./monthly-attendance.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { FaFileExcel } from "react-icons/fa";
import {
  downloadMonthlyAttendanceExcel,
  excelEmployeeLabel,
  type MonthlyAttendanceExcelRow,
} from "../../../lib/monthly-attendance-excel";
import {
  DEDUCTION_SUMMARY_HEADERS,
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
  deductionForAttendanceStatus,
  isAbsentOrHalfDayStatus,
  isTardyStatus,
  MONTHLY_ATTENDANCE_STATUS_OPTIONS,
  normalizeAttendanceStatus,
  uiStatusTextColor,
} from "../../../lib/attendance-status";
import {
  approvedLeaveOnDay,
  attendanceFromApprovedLeaveDay,
  buildApprovedLeavesMap,
  type ApprovedLeavesMap,
} from "../../../lib/leave-duration";
import {
  employeeIdKeys,
  lookupByEmployeeId,
  setForEmployeeIdKeys,
} from "@/lib/employee-id-keys";
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
  type ImportedMonthlyDay,
  type ImportedMonthlySnapshot,
} from "../../../lib/monthly-attendance-import";
import {
  buildEmployeeReportSessions,
  buildShiftPunchOnlySessions,
  employeeHasZkPunchesInRange,
  hrmEmployeesFromList,
  loadTungstenPunchContext,
  monthlyDash,
  type EmployeeReportSession,
  type EmployeeShiftResolver,
  type HrmEmployeeRef,
  type TungstenPunchContext,
} from "../../../lib/tungsten-punch-pairing";
import { AutoClockOutBadge } from "../../components/AutoClockOutBadge";
import { ManualStatusBadge } from "../../components/ManualStatusBadge";
import {
  StatusChangeReasonModal,
  type StatusChangeReasonDraft,
} from "../../components/StatusChangeReasonModal";
import { isAutoClockOutRecord, applyAutoClockOutTPunchDisplay } from "../../../lib/attendance-auto-clock-out";
import { resolveBillableOvertimeSeconds } from "../../../lib/attendance-overtime";
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";

/** Admin / Admin Staff department. */
function isAdminStaffDepartment(departmentName: string | null | undefined): boolean {
  const d = String(departmentName || "").trim().toLowerCase();
  if (!d) return false;
  return d === "admin" || d === "admin staff" || d.startsWith("admin ");
}

/**
 * T.Punch column visibility:
 * - Non-Admin: show (values only exist when paired with Clock In — no ZK-only invent).
 * - Admin staff: only when opened via department filter or name search.
 */
function shouldRevealTPunches(
  departmentName: string | null | undefined,
  selectedDepartment: string,
  searchName: string,
): boolean {
  if (!isAdminStaffDepartment(departmentName)) return true;
  return Boolean(String(selectedDepartment || "").trim() || String(searchName || "").trim());
}

function maskTPunch(
  value: string | null | undefined,
  reveal: boolean,
): string {
  if (!reveal) return "---";
  const v = String(value ?? "").trim();
  if (!v || v === "-" || v === "---") return "---";
  return v;
}

type MonthlyAttendanceEmployeeRow = {
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  pseudonym: string;
  departmentName: string;
  gender: string;
  byDate: Record<string, any[]>;
  dateMeta: Record<
    string,
    {
      runningLate: number | string;
      statusLabel: string;
      /** Auto-calculated status before manual override (if any). */
      autoStatusLabel?: string;
      statusColor: string;
      deduction: string;
      /** Billable late after 1h relaxation (0 on Absent / Half Day). */
      lateMinutes?: number;
      /** Admin manually set this day's status. */
      isManual?: boolean;
    }
  >;
  isImported?: boolean;
  importedDays?: ImportedMonthlyDay[];
  importedFooter?: { totalDeduction?: string; extraHours?: string; workingDays?: string };
};

import {
  PUNCH_ONLY_DEFAULT_SHIFT,
  PUNCH_ONLY_EMPLOYEES,
  isHrmEmployeeInactive,
  punchOnlyById,
  punchOnlyDisplayName,
  punchOnlyPinForId,
  punchOnlyRosterApplies,
} from "../../../lib/punch-only-employees";

/** Billable late is already after 1h relaxation — show/sum any minutes > 0. */
const EXCESS_LATE_SHOW_AFTER_MINUTES = 0;

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

/** Empty working-day cell: Leave / Absent 100%. Future days also Absent until clock-in. */
function emptyWorkingDayStatus(
  _dateKey: string,
  workingDay: boolean,
  leaveKind: ReturnType<typeof approvedLeaveOnDay>,
): { statusLabel: string; deduction: string } {
  if (!workingDay) return { statusLabel: "Off", deduction: "" };
  if (leaveKind) return attendanceFromApprovedLeaveDay(leaveKind);
  return { statusLabel: "Absent", deduction: "100%" };
}

/** Extra work beyond assigned shift before OT is shown/counted (1 hour). */
const OVERTIME_MIN_SECONDS = 60 * 60;

export default function MonthlyAttendancePage() {
    // Month working days: calendar Off/working overrides, else Mon–Fri.
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
   * Monthly Attendance OT display: when shift allows overtime, show hours beyond
   * assigned shift (≥1h). allow_overtime must be on the record (filled from
   * shift-assignments). Auto clock-out does not hide OT here.
   */
  function calculateOvertime(
    totalSeconds: number,
    assignedShiftSeconds: number | null,
    record?: {
      allow_overtime?: boolean | number | string | null;
    },
  ): number | null {
    return resolveBillableOvertimeSeconds({
      totalSeconds,
      assignedShiftSeconds,
      allowOvertime: record?.allow_overtime,
      autoClockOut: false,
      minSeconds: OVERTIME_MIN_SECONDS,
    });
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
  /** Day-level manual status (attendance_id = 0). */
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Record<string, string>>>({});
  /** Per attendance-session manual status (same calendar day can differ). */
  const [statusOverridesByAttendanceId, setStatusOverridesByAttendanceId] = useState<
    Record<string, string>
  >({});
  const [statusOverrideNotes, setStatusOverrideNotes] = useState<
    Record<string, Record<string, string>>
  >({});
  const [statusOverrideNotesByAttendanceId, setStatusOverrideNotesByAttendanceId] = useState<
    Record<string, string>
  >({});
  const [statusSavingKey, setStatusSavingKey] = useState<string>("");
  const [statusReasonDraft, setStatusReasonDraft] = useState<StatusChangeReasonDraft | null>(null);
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
  const [calendarOverrides, setCalendarOverrides] = useState<
    Record<string, CalendarDayOverride>
  >({});
  const [approvedLeavesMap, setApprovedLeavesMap] = useState<ApprovedLeavesMap>({});
  const [importedSnapshot, setImportedSnapshot] = useState<ImportedMonthlySnapshot | null>(null);
  const [tungstenCtx, setTungstenCtx] = useState<TungstenPunchContext | null>(null);
  const [hrmEmployeesList, setHrmEmployeesList] = useState<HrmEmployeeRef[]>([]);
  const [shiftAssignments, setShiftAssignments] = useState<
    {
      employeeId: string;
      startTime: string;
      endTime: string;
      assignedDate: string;
      allowOvertime: boolean;
    }[]
  >([]);
  const [pairingNow, setPairingNow] = useState(() => Date.now());
  /** Collapsed by default — full month tables for every employee freeze the browser */
  const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<Record<string, boolean>>({});
  const [selectedDeductionIds, setSelectedDeductionIds] = useState<Record<string, boolean>>({});
  const [deductionPreview, setDeductionPreview] = useState<{
    employeeId: string;
    block: DeductionSummaryEmployeeBlock;
  } | null>(null);
  const [deductionPreviewLoadingId, setDeductionPreviewLoadingId] = useState<string>("");
  const [metricModal, setMetricModal] = useState<
    null | "employees" | "workingDays" | "expanded" | "departments"
  >(null);
  const [fullViewEmployeeId, setFullViewEmployeeId] = useState<string>("");
  const [exportMenuEmployeeId, setExportMenuEmployeeId] = useState<string>("");
  const fetchGenRef = useRef(0);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (deductionPreview) {
        setDeductionPreview(null);
        return;
      }
      if (fullViewEmployeeId) {
        setFullViewEmployeeId("");
        return;
      }
      if (metricModal) {
        setMetricModal(null);
        return;
      }
      if (exportMenuEmployeeId) {
        setExportMenuEmployeeId("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deductionPreview, metricModal, exportMenuEmployeeId, fullViewEmployeeId]);

  useEffect(() => {
    if (!exportMenuEmployeeId) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.("[data-export-menu]")) return;
      setExportMenuEmployeeId("");
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [exportMenuEmployeeId]);

  const showingImported =
    Boolean(importedSnapshot?.month && importedSnapshot.month === selectedMonth && importedSnapshot.employees.length);

  function toggleEmployeeExpanded(employeeId: string) {
    setExpandedEmployeeIds((prev) => ({ ...prev, [employeeId]: !prev[employeeId] }));
  }

  function toggleDeductionSelected(employeeId: string) {
    const id = String(employeeId);
    setSelectedDeductionIds((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  function setAllDeductionSelected(ids: string[], selected: boolean) {
    setSelectedDeductionIds((prev) => {
      if (!selected) {
        const next = { ...prev };
        ids.forEach((id) => {
          delete next[id];
        });
        return next;
      }
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = true;
      });
      return next;
    });
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
    refreshPairing();
    const id = setInterval(refreshPairing, 60_000);
    return () => clearInterval(id);
  }, [fromDate, toDate, showingImported]);

  useEffect(() => {
    fetch("/api/employee-list", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.employees)) {
          setHrmEmployeesList(hrmEmployeesFromList(data.employees));
        }
      })
      .catch(() => {});
    fetch("/api/hrm-shifts-assignments", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success || !Array.isArray(data.employees)) return;
        setShiftAssignments(
          data.employees
            .filter((e: { id?: number; start_time?: string; end_time?: string }) =>
              Boolean(e.id && e.start_time && e.end_time),
            )
            .map(
              (e: {
                id: number;
                start_time: string;
                end_time: string;
                assigned_date?: string;
                allow_overtime?: boolean | number | string | null;
              }) => ({
                employeeId: String(e.id),
                startTime: String(e.start_time).slice(0, 8),
                endTime: String(e.end_time).slice(0, 8),
                assignedDate: String(e.assigned_date || "").slice(0, 10),
                allowOvertime:
                  e.allow_overtime === true ||
                  e.allow_overtime === 1 ||
                  e.allow_overtime === "1",
              }),
            ),
        );
      })
      .catch(() => {});
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
      const [res, shiftRes] = await Promise.all([
        fetch(url, { cache: "no-store" }),
        fetch("/api/hrm-shifts-assignments", { cache: "no-store" }),
      ]);
      const data = await res.json();
      if (gen !== fetchGenRef.current) return;
      if (!data.success) {
        setLoading(false);
        return;
      }

      let liveShifts = shiftAssignments;
      try {
        const shiftData = await shiftRes.json();
        if (shiftData.success && Array.isArray(shiftData.employees)) {
          liveShifts = shiftData.employees
            .filter((e: { id?: number; start_time?: string; end_time?: string }) =>
              Boolean(e.id && e.start_time && e.end_time),
            )
            .map(
              (e: {
                id: number;
                start_time: string;
                end_time: string;
                assigned_date?: string;
                allow_overtime?: boolean | number | string | null;
              }) => ({
                employeeId: String(e.id),
                startTime: String(e.start_time).slice(0, 8),
                endTime: String(e.end_time).slice(0, 8),
                assignedDate: String(e.assigned_date || "").slice(0, 10),
                allowOvertime:
                  e.allow_overtime === true ||
                  e.allow_overtime === 1 ||
                  e.allow_overtime === "1",
              }),
            );
          setShiftAssignments(liveShifts);
        }
      } catch {
        /* keep existing shiftAssignments */
      }

      const empShiftMap: Record<
        string,
        { start: string; end: string; seconds: number; allow_overtime?: boolean }
      > = {};
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
            allow_overtime:
              record.allow_overtime === true ||
              record.allow_overtime === 1 ||
              record.allow_overtime === "1",
          };
        }
      });
      // Fill from shift-assignments API (source of allow_overtime on staging/Mongo).
      for (const s of liveShifts) {
        const secs = getAssignedShiftSeconds(s.startTime, s.endTime);
        if (!secs || secs <= 0) continue;
        const prev = empShiftMap[s.employeeId];
        empShiftMap[s.employeeId] = {
          start: s.startTime,
          end: s.endTime,
          seconds: secs,
          allow_overtime: s.allowOvertime || prev?.allow_overtime,
        };
      }

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
        const allowOt =
          record.allow_overtime !== undefined && record.allow_overtime !== null
            ? record.allow_overtime
            : empShiftMap[empId]?.allow_overtime;
        const overtimeSeconds = calculateOvertime(totalSeconds, assignedShiftSeconds, {
          ...record,
          allow_overtime: allowOt,
        });
        return {
          ...record,
          allow_overtime: allowOt,
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

      if (fromDate && toDate) {
        void fetchApprovedLeaves(fromDate, toDate);
      }

      // Background enrichment (T.Punch pairing is the slow part)
      void (async () => {
        if (fromDate && toDate) {
          try {
            const ovRes = await fetch(
              `/api/monthly-attendance-status-overrides?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`,
              { cache: "no-store" },
            );
            const ovData = await ovRes.json();
            if (gen !== fetchGenRef.current) return;
            if (ovData.success && Array.isArray(ovData.overrides)) {
              const map: Record<string, Record<string, string>> = {};
              const byAtt: Record<string, string> = {};
              const notes: Record<string, Record<string, string>> = {};
              const notesByAtt: Record<string, string> = {};
              ovData.overrides.forEach(
                (o: {
                  employee_id: string;
                  attendance_date: string;
                  attendance_id?: number | null;
                  status_label: string;
                  reason?: string | null;
                }) => {
                  const eid = String(o.employee_id);
                  const dk = String(o.attendance_date).slice(0, 10);
                  const attId = Number(o.attendance_id || 0);
                  const status = normalizeAttendanceStatus(o.status_label);
                  const reason = String(o.reason || "").trim();
                  if (Number.isFinite(attId) && attId > 0) {
                    byAtt[String(attId)] = status;
                    if (reason) notesByAtt[String(attId)] = reason;
                    return;
                  }
                  for (const idKey of employeeIdKeys(eid)) {
                    if (!map[idKey]) map[idKey] = {};
                    map[idKey][dk] = status;
                    if (reason) {
                      if (!notes[idKey]) notes[idKey] = {};
                      notes[idKey][dk] = reason;
                    }
                  }
                },
              );
              setStatusOverrides(map);
              setStatusOverridesByAttendanceId(byAtt);
              setStatusOverrideNotes(notes);
              setStatusOverrideNotesByAttendanceId(notesByAtt);
            } else {
              setStatusOverrides({});
              setStatusOverridesByAttendanceId({});
              setStatusOverrideNotes({});
              setStatusOverrideNotesByAttendanceId({});
            }
          } catch {
            if (gen === fetchGenRef.current) {
              setStatusOverrides({});
              setStatusOverridesByAttendanceId({});
              setStatusOverrideNotes({});
              setStatusOverrideNotesByAttendanceId({});
            }
          }
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

  // Fetch approved leaves for the month. Do NOT require attendance employee IDs —
  // punch-only / search-only rows still need Leave status from ticket approvals.
  // Rejected (incl. reject-after-approve) must clear Leave → Absent/Off.
  const fetchApprovedLeaves = async (from: string, to: string) => {
    try {
      const params = new URLSearchParams();
      params.append("status", "approved");
      params.append("fromDate", from);
      params.append("toDate", to);
      params.append("ts", String(Date.now()));

      const response = await fetch(`/api/leaves?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();

      if (data.success && Array.isArray(data.leaves)) {
        setApprovedLeavesMap(
          buildApprovedLeavesMap(data.leaves as Array<Record<string, unknown>>, {
            normalizeDateKey: normalizeToDateKey,
            addDays: addDaysToDateKey,
          }),
        );
      } else {
        setApprovedLeavesMap({});
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

  // Company calendar Off/Working → Monthly Attendance Off for all employees.
  useEffect(() => {
    if (!selectedMonth) return;
    fetch(`/api/calendar?month=${selectedMonth}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.success) return;
        const map: Record<string, CalendarDayOverride> = {};
        (data.days || []).forEach((d: CalendarDayOverride) => {
          if (d?.date) map[d.date] = d;
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

    const withAutoTPunch = (
      session: EmployeeReportSession,
      record: any | undefined,
    ): EmployeeReportSession =>
      applyAutoClockOutTPunchDisplay(session, record?.auto_clock_out);

    if (daySessions.length === 0) {
      return dayRecords.map((record) => ({
        session: withAutoTPunch(sessionFromRecord(record), record),
        record,
      }));
    }

    const usedIds = new Set<string | number>();
    const rows = daySessions.map((session) => {
      const record = findRecordForSession(dayRecords, session, usedIds);
      if (record?.id != null) usedIds.add(record.id);
      return { session: withAutoTPunch(session, record), record };
    });

    dayRecords.forEach((record) => {
      if (record?.id != null && usedIds.has(record.id)) return;
      if (record?.id == null && rows.some((row) => row.record === record)) return;
      rows.push({
        session: withAutoTPunch(sessionFromRecord(record), record),
        record,
      });
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

  function normalizeOverrideAttendanceId(raw: unknown): number {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function statusSaveKey(employeeId: string, dateKey: string, attendanceId?: number | null) {
    const att = normalizeOverrideAttendanceId(attendanceId);
    return att > 0 ? `${employeeId}|${dateKey}|${att}` : `${employeeId}|${dateKey}`;
  }

  /**
   * Resolve manual status for a row.
   * - With attendanceId: that session's override only (no day-level bleed onto sibling sessions).
   * - Without attendanceId: day-level override (empty day / legacy).
   */
  function overrideStatusFor(
    employeeId: string,
    dateKey: string,
    attendanceId?: number | null,
  ): string | null {
    const att = normalizeOverrideAttendanceId(attendanceId);
    if (att > 0) {
      const session = statusOverridesByAttendanceId[String(att)];
      return session ? normalizeAttendanceStatus(session) : null;
    }
    const v = lookupByEmployeeId(statusOverrides, employeeId)?.[dateKey];
    return v ? normalizeAttendanceStatus(v) : null;
  }

  /** Day effective manual status: first session override, else day-level. */
  function effectiveDayOverride(
    employeeId: string,
    dateKey: string,
    dayRecords?: Array<{ id?: number | null }>,
  ): string | null {
    if (Array.isArray(dayRecords)) {
      for (const rec of dayRecords) {
        const attId = normalizeOverrideAttendanceId(rec?.id);
        if (attId <= 0) continue;
        const session = overrideStatusFor(employeeId, dateKey, attId);
        if (session) return session;
      }
    }
    return overrideStatusFor(employeeId, dateKey);
  }

  async function saveManualStatus(
    employeeId: string,
    dateKey: string,
    nextValue: string,
    reason?: string,
    attendanceId?: number | null,
  ) {
    const attId = normalizeOverrideAttendanceId(attendanceId);
    const key = statusSaveKey(employeeId, dateKey, attId);
    if (statusSavingKey === key) return;
    setStatusSavingKey(key);
    try {
      if (!nextValue || nextValue === "__auto__") {
        const qs = new URLSearchParams({
          employeeId,
          attendanceDate: dateKey,
        });
        if (attId > 0) qs.set("attendanceId", String(attId));
        const res = await fetch(
          `/api/monthly-attendance-status-overrides?${qs.toString()}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to clear status");
        if (attId > 0) {
          setStatusOverridesByAttendanceId((prev) => {
            const next = { ...prev };
            delete next[String(attId)];
            return next;
          });
          setStatusOverrideNotesByAttendanceId((prev) => {
            const next = { ...prev };
            delete next[String(attId)];
            return next;
          });
        } else {
          setStatusOverrides((prev) => {
            const next = { ...prev };
            if (next[employeeId]) {
              const dayMap = { ...next[employeeId] };
              delete dayMap[dateKey];
              if (Object.keys(dayMap).length) next[employeeId] = dayMap;
              else delete next[employeeId];
            }
            return next;
          });
          setStatusOverrideNotes((prev) => {
            const next = { ...prev };
            if (next[employeeId]) {
              const dayMap = { ...next[employeeId] };
              delete dayMap[dateKey];
              if (Object.keys(dayMap).length) next[employeeId] = dayMap;
              else delete next[employeeId];
            }
            return next;
          });
        }
        toastSuccess("Status reset to auto.", "Manual status");
      } else {
        const statusLabel = normalizeAttendanceStatus(nextValue);
        const trimmedReason = String(reason || "").trim();
        if (!trimmedReason) {
          throw new Error("Reason is required when changing status manually");
        }
        const res = await fetch("/api/monthly-attendance-status-overrides", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            attendanceDate: dateKey,
            statusLabel,
            reason: trimmedReason,
            updatedBy: "admin",
            attendanceId: attId > 0 ? attId : 0,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to save status");
        if (attId > 0) {
          setStatusOverridesByAttendanceId((prev) => ({
            ...prev,
            [String(attId)]: statusLabel,
          }));
          setStatusOverrideNotesByAttendanceId((prev) => ({
            ...prev,
            [String(attId)]: trimmedReason,
          }));
          // Clear legacy day-level so sibling sessions stay independent (fall back to auto).
          if (statusOverrides[employeeId]?.[dateKey]) {
            try {
              await fetch(
                `/api/monthly-attendance-status-overrides?employeeId=${encodeURIComponent(employeeId)}&attendanceDate=${encodeURIComponent(dateKey)}`,
                { method: "DELETE" },
              );
            } catch {
              /* non-fatal */
            }
            setStatusOverrides((prev) => {
              const next = { ...prev };
              if (next[employeeId]) {
                const dayMap = { ...next[employeeId] };
                delete dayMap[dateKey];
                if (Object.keys(dayMap).length) next[employeeId] = dayMap;
                else delete next[employeeId];
              }
              return next;
            });
            setStatusOverrideNotes((prev) => {
              const next = { ...prev };
              if (next[employeeId]) {
                const dayMap = { ...next[employeeId] };
                delete dayMap[dateKey];
                if (Object.keys(dayMap).length) next[employeeId] = dayMap;
                else delete next[employeeId];
              }
              return next;
            });
          }
        } else {
          setStatusOverrides((prev) => ({
            ...prev,
            [employeeId]: {
              ...(prev[employeeId] || {}),
              [dateKey]: statusLabel,
            },
          }));
          setStatusOverrideNotes((prev) => ({
            ...prev,
            [employeeId]: {
              ...(prev[employeeId] || {}),
              [dateKey]: trimmedReason,
            },
          }));
        }
        toastSuccess(`Status set to ${statusLabel}`, "Manual status");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err), "Status update failed");
      return false;
    } finally {
      setStatusSavingKey("");
    }
    return true;
  }

  function requestManualStatusChange(
    employeeId: string,
    dateKey: string,
    fromStatus: string,
    nextValue: string,
    attendanceId?: number | null,
  ) {
    const attId = normalizeOverrideAttendanceId(attendanceId);
    if (!nextValue || nextValue === "__auto__") {
      void saveManualStatus(employeeId, dateKey, "__auto__", undefined, attId || null);
      return;
    }
    const nextStatus = normalizeAttendanceStatus(nextValue);
    if (
      nextStatus === normalizeAttendanceStatus(fromStatus) &&
      overrideStatusFor(employeeId, dateKey, attId || null)
    ) {
      return;
    }
    setStatusReasonDraft({
      employeeId,
      dateKey,
      fromStatus: normalizeAttendanceStatus(fromStatus),
      nextStatus,
      attendanceId: attId > 0 ? attId : null,
    });
  }

  function renderEditableStatusCell(opts: {
    employeeId: string;
    dateKey: string;
    displayStatus: string;
    lateMinutes?: number | null;
    isManual?: boolean;
    disabled?: boolean;
    attendanceId?: number | null;
    /** Approved leave (incl. half day) uses Leave blue instead of unpaid half-day red. */
    statusColorOverride?: string | null;
  }) {
    const {
      employeeId,
      dateKey,
      displayStatus,
      lateMinutes,
      isManual,
      disabled,
      attendanceId,
      statusColorOverride,
    } = opts;
    if (displayStatus === "---" || disabled) {
      return <span>---</span>;
    }
    const attId = normalizeOverrideAttendanceId(attendanceId);
    const saving = statusSavingKey === statusSaveKey(employeeId, dateKey, attId);
    const current = normalizeAttendanceStatus(displayStatus);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <select
          value={current}
          disabled={saving || Boolean(statusReasonDraft)}
          onChange={(e) => {
            const v = e.target.value;
            requestManualStatusChange(employeeId, dateKey, current, v, attId || null);
          }}
          title={
            isManual
              ? attId > 0
                ? "Manual status for this session (M). Choose Auto to reset."
                : "Manual status (M). Choose Auto to reset."
              : "Change status manually"
          }
          style={{
            fontWeight: 600,
            color: statusColorOverride || uiStatusTextColor(current),
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            padding: "2px 6px",
            background: "#fff",
            maxWidth: 150,
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {isManual ? <option value="__auto__">— Auto (clear M) —</option> : null}
          {MONTHLY_ATTENDANCE_STATUS_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {isExcessLateMinutes(lateMinutes) ? (
          <span style={{ color: "#c05621", fontWeight: 600, fontSize: 12 }}>
            ({formatLateTime(lateMinutes)})
          </span>
        ) : null}
        {isManual ? <ManualStatusBadge /> : null}
      </span>
    );
  }

  function getDateKey(dateValue: string) {
    return normalizeToDateKey(dateValue);
  }

  function getRecordDateKey(record: any) {
    // Prefer calendar `date` so BSON/UTC clock_in does not shift the day key.
    const rawDate = record?.date != null ? String(record.date) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
    if (rawDate) {
      const fromDate = getDateKey(rawDate);
      if (fromDate) return fromDate;
    }
    return getDateKey(record.clock_in || record.clock_out || "");
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
      const leaveKind = approvedLeaveOnDay(
        approvedLeavesMap,
        employee.employeeId,
        day.dateKey,
      );
      if (leaveKind) {
        dayDeduction =
          parseInt(
            String(attendanceFromApprovedLeaveDay(leaveKind).deduction).replace(/%/g, ""),
            10,
          ) || 0;
      } else if (dayRecords.length === 0) {
        const emptyOverride = overrideStatusFor(employee.employeeId, day.dateKey);
        if (emptyOverride) {
          dayDeduction =
            parseInt(
              String(deductionForAttendanceStatus(emptyOverride, 0)).replace(/%/g, ""),
              10,
            ) || 0;
        } else {
          const { deduction } = emptyWorkingDayStatus(day.dateKey, workingDay, null);
          dayDeduction = parseInt(String(deduction).replace(/%/g, ""), 10) || 0;
        }
      } else {
        // Prefer live effective status (session/day M) so Total Deduction matches row %.
        const effective =
          effectiveDayOverride(employee.employeeId, day.dateKey, dayRecords) ||
          meta?.statusLabel ||
          "";
        if (effective) {
          const tardyN =
            normalizeAttendanceStatus(effective) === "Tardy"
              ? meta?.runningLate ?? 0
              : 0;
          dayDeduction =
            parseInt(
              String(
                deductionForAttendanceStatus(effective, tardyN),
              ).replace(/%/g, ""),
              10,
            ) || 0;
        } else if (meta?.deduction) {
          dayDeduction = parseInt(String(meta.deduction).replace(/%/g, ""), 10) || 0;
        }
      }
      totalDeduction += dayDeduction;
    });
    return totalDeduction;
  }

  /** Employee tardy note only (CT / Traffic…) — never HR manual reason. */
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

    if (dayRecords?.length) {
      for (const rec of dayRecords) {
        if (rec?.id == null) continue;
        const bySession = tardyNotesByAttendanceId[String(rec.id)];
        if (bySession) return bySession;
      }
    }
    const saved = tardyNotes[employeeId]?.[dateKey];
    return saved || "-";
  }

  /** Admin/HR reason from manual status change (M). */
  function hrNoteForCell(
    employeeId: string,
    dateKey: string,
    attendanceId?: number | null,
  ): string {
    if (attendanceId != null && Number(attendanceId) > 0) {
      return String(
        statusOverrideNotesByAttendanceId[String(attendanceId)] || "",
      ).trim();
    }
    return String(
      statusOverrideNotes[String(employeeId)]?.[dateKey] || "",
    ).trim();
  }

  /**
   * Working day: company calendar override first (Off / Working),
   * else Mon–Fri (Sat/Sun Off). Manual status override still wins in the UI.
   */
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

  function employeeMatchKeys(employee: {
    employeeId: string;
    employeeName: string;
    employeeCode?: string;
    pseudonym?: string;
    departmentName?: string;
  }) {
    const empId = String(employee.employeeId ?? "").trim();
    const hrm = hrmEmployeesList.find((e) => String(e.employeeId) === empId);
    const rosterPin = punchOnlyPinForId(empId) || "";
    return {
      employeeName: employee.employeeName,
      employeeCode: String(
        employee.employeeCode || hrm?.employeeCode || rosterPin || "",
      ).trim(),
      employeeId: empId,
      pseudonym: employee.pseudonym || hrm?.pseudonym || "",
      departmentName:
        employee.departmentName || hrm?.departmentName || "",
    };
  }

  function shiftResolverForEmployee(
    employeeId: string,
    employeeName?: string | null,
  ): EmployeeShiftResolver {
    const row = shiftAssignments.find((s) => s.employeeId === String(employeeId));
    const punchOnly = punchOnlyRosterApplies(employeeId, employeeName);
    if (!row) {
      if (!punchOnly) return () => null;
      return () => ({
        startTime: PUNCH_ONLY_DEFAULT_SHIFT.startTime,
        endTime: PUNCH_ONLY_DEFAULT_SHIFT.endTime,
      });
    }
    return (sessionDate: string) => {
      if (!punchOnly && row.assignedDate && sessionDate < row.assignedDate) return null;
      return { startTime: row.startTime, endTime: row.endTime };
    };
  }

  /** Pair T.Punch for this employee even if their card is collapsed (export needs every sheet). */
  function pairSessionsForEmployee(
    employee: {
      employeeId: string;
      employeeName: string;
      employeeCode?: string;
      departmentName?: string;
      isImported?: boolean;
    },
    ctx: TungstenPunchContext | null,
  ): EmployeeReportSession[] {
    if (employee.isImported) return [];
    if (!ctx || !fromDate || !toDate) return [];
    const empId = String(employee.employeeId);
    if (punchOnlyRosterApplies(empId, employee.employeeName)) {
      return buildShiftPunchOnlySessions(
        employeeMatchKeys(employee),
        ctx,
        fromDate,
        toDate,
        shiftResolverForEmployee(empId, employee.employeeName),
      );
    }
    const todayKey = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);
    const zkFrom = addDaysToDateKey(fromDate, -1);
    const zkTo = addDaysToDateKey(toDate, 1);
    const allRecords = attendance.filter(
      (record: any) => String(record.employee_id) === empId,
    );
    // All employees: invent ZK-only T.Punch rows; status stays HRM clock-in/out based.
    return buildEmployeeReportSessions(
      employeeMatchKeys(employee),
      allRecords,
      ctx,
      todayKey,
      Date.now(),
      zkFrom,
      zkTo,
      shiftResolverForEmployee(empId, employee.employeeName),
      true,
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
    const revealPunches = shouldRevealTPunches(
      employee.departmentName,
      selectedDepartment,
      deferredSearchName,
    );

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
            maskTPunch(day.tPunchIn, revealPunches),
            day.clockIn,
            day.clockOut,
            maskTPunch(day.tPunchOut, revealPunches),
            day.totalWH,
            day.assignedWH,
            day.overtime,
            tardyDisplay,
            statusCellText(
              statusLabel,
              normalizeAttendanceStatus(statusLabel) === "Tardy" ? meta?.lateMinutes : null,
            ),
            tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel),
            hrNoteForCell(employee.employeeId, day.dateKey),
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
          cells: ["", "", "", "", "", "", "", "", "", "", "Total Deduction:", "", "", `${totalDeduction}%`],
          status: "",
          isSummary: true,
        },
        {
          cells: ["", "", "", "", "", "", "", "", "", "", "Extra Hours:", "", "", getEmployeeTotalOvertime(employee)],
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
            "",
            footer?.workingDays ?? `${getTotalWorkingDays(monthInfo)}`,
          ],
          status: "",
          isSummary: true,
        },
      );
      return dataRows;
    }

    const employeeSessions =
      pairedSessions ?? sessionsByEmployeeId.get(String(employee.employeeId)) ?? [];

    monthInfo.days.forEach((day) => {
      const dayRecords = employee.byDate[day.dateKey] || [];
      const meta = employee.dateMeta[day.dateKey];
      const workingDay = isWorkingDay(day.dateKey);
      // Show ZK-only sessions too; status still from HRM / leave / Absent fallback.
      const daySessions = employeeSessions.filter((s) => s.sessionDate === day.dateKey);

      if (daySessions.length === 0 && dayRecords.length === 0) {
        const leaveKind = approvedLeaveOnDay(
          approvedLeavesMap,
          employee.employeeId,
          day.dateKey,
        );
        const { statusLabel, deduction } = emptyWorkingDayStatus(
          day.dateKey,
          workingDay,
          leaveKind,
        );
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
            normalizeAttendanceStatus(statusLabel) === "Tardy" ? (meta?.runningLate ?? "") : "",
            statusLabel,
            tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel, undefined, dayRecords),
            hrNoteForCell(employee.employeeId, day.dateKey),
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

      const leaveKindSession = approvedLeaveOnDay(
        approvedLeavesMap,
        employee.employeeId,
        day.dateKey,
      );
      const leaveAttSession = leaveKindSession
        ? attendanceFromApprovedLeaveDay(leaveKindSession)
        : null;
      // No HRM clock-in meta → Absent (or leave/off). Punches do not change status.
      const emptySessionFallback = emptyWorkingDayStatus(
        day.dateKey,
        workingDay,
        leaveKindSession,
      );

      sessionsToExport.forEach(({ session, record }, sessionIndex) => {
        const statusLabel = normalizeAttendanceStatus(
          leaveAttSession?.statusLabel ||
            meta?.statusLabel ||
            emptySessionFallback.statusLabel,
        );
        const dayDeduction =
          leaveAttSession?.deduction ||
          meta?.deduction ||
          emptySessionFallback.deduction;
        // Same-day multi clock-in: deduction once (first row); later rows "---".
        const deduction =
          sessionIndex === 0 ? dayDeduction : dayDeduction ? "---" : "";
        dataRows.push({
          cells: [
            day.weekday,
            formatDateKey(day.dateKey),
            maskTPunch(monthlyDash(session.tungstenPunchIn), revealPunches),
            session.hrmClockIn === "-" ? "---" : session.hrmClockIn,
            session.hrmClockOut === "-" ? "---" : session.hrmClockOut,
            maskTPunch(monthlyDash(session.tungstenPunchOut), revealPunches),
            record ? excelTotalHoursForExport(record) : "---",
            record ? excelAssignedWHForExport(record) : "---",
            record ? excelOvertimeForExport(record) : "---",
            normalizeAttendanceStatus(statusLabel) === "Tardy" ? (meta?.runningLate ?? "") : "",
            sessionIndex === 0
              ? statusCellText(
                  statusLabel,
                  normalizeAttendanceStatus(statusLabel) === "Tardy" ? meta?.lateMinutes : null,
                )
              : statusLabel,
            tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel, record?.id, dayRecords),
            hrNoteForCell(
              employee.employeeId,
              day.dateKey,
              record?.id != null ? Number(record.id) : null,
            ),
            deduction,
          ],
          status: statusLabel,
        });
      });
    });

    const totalDeduction = calculateTotalDeduction(employee);
    dataRows.push(
      {
        cells: ["", "", "", "", "", "", "", "", "", "", "Total Deduction:", "", "", `${totalDeduction}%`],
        status: "",
        isSummary: true,
      },
      {
        cells: ["", "", "", "", "", "", "", "", "", "", "Extra Hours:", "", "", getEmployeeTotalOvertime(employee)],
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
          "",
          `${getTotalWorkingDays(monthInfo)}`,
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

    try {
      const ctx = await ensureTungstenCtx();
      const sheets = attendanceByEmployee.map((employee) => ({
        name: excelEmployeeLabel(employee.employeeName, employee.pseudonym),
        rows: buildEmployeeExcelRows(employee, pairSessionsForEmployee(employee, ctx)),
      }));

      const dateRange = fromDate && toDate ? `-${fromDate}-to-${toDate}` : "";
      const departmentSuffix = selectedDepartment ? `-${selectedDepartment}` : "";
      const fileName = `monthly-attendance${departmentSuffix}${dateRange}.xlsx`;
      await downloadMonthlyAttendanceExcel(sheets, fileName);
      toastSuccess("Attendance Excel downloaded", "Export");
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err), "Export failed");
    }
  }

  async function downloadEmployeeExcel(employee: any) {
    try {
      const ctx = await ensureTungstenCtx();
      const label = excelEmployeeLabel(employee.employeeName, employee.pseudonym);
      const sheets = [
        {
          name: label,
          rows: buildEmployeeExcelRows(employee, pairSessionsForEmployee(employee, ctx)),
        },
      ];
      const fileName = `attendance-${label.replace(/\s+/g, "_")}-${selectedMonth}.xlsx`;
      await downloadMonthlyAttendanceExcel(sheets, fileName);
      toastSuccess("Attendance Excel downloaded", "Export");
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err), "Export failed");
    }
  }

  function shouldIncludeInDeductionSummary(statusLabel: string): boolean {
    const status = String(statusLabel || "").trim();
    return (
      status !== "On Time" &&
      status !== "Off" &&
      status !== "---" &&
      status !== ""
    );
  }

  function formatDeductionSummaryStatus(statusLabel: string): string {
    // Keep Leave label (blue / approved) — do not rename to "PTO By Company".
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

    const revealPunches = shouldRevealTPunches(
      employee.departmentName,
      selectedDepartment,
      deferredSearchName,
    );
    rows.push({
      date: formatDateKey(dateKey),
      tPunchIn: maskTPunch(
        importedDay
          ? deductionSummaryTungsten(importedDay.tPunchIn || "---")
          : session
            ? deductionSummaryTungsten(monthlyDash(session.tungstenPunchIn))
            : "--",
        revealPunches,
      ),
      clockIn:
        session && session.hrmClockIn !== "-"
          ? session.hrmClockIn
          : deductionSummaryClock(record, employee, dateKey, "in"),
      clockOut:
        session && session.hrmClockOut !== "-"
          ? session.hrmClockOut
          : deductionSummaryClock(record, employee, dateKey, "out"),
      tPunchOut: maskTPunch(
        importedDay
          ? deductionSummaryTungsten(importedDay.tPunchOut || "---")
          : session
            ? deductionSummaryTungsten(monthlyDash(session.tungstenPunchOut))
            : "--",
        revealPunches,
      ),
      totalWorkingHours: importedDay
        ? deductionSummaryTungsten(importedDay.totalWH || "---")
        : record?.total_hours
          ? formatHoursMins(record.total_hours)
          : "--",
      status: formatDeductionSummaryStatus(normalizeAttendanceStatus(statusLabel)),
      tardyCount:
        normalizeAttendanceStatus(statusLabel) === "Tardy" ? tardyCount : "",
      tardyNote: tardyNoteForCell(
        employee.employeeId,
        dateKey,
        statusLabel,
        record?.id,
        dayRecords,
      ),
      hrNote: hrNoteForCell(
        employee.employeeId,
        dateKey,
        record?.id != null ? Number(record.id) : null,
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
        pairedSessions ?? sessionsByEmployeeId.get(String(employee.employeeId)) ?? [];

      monthInfo.days.forEach((day) => {
        if (!isWorkingDay(day.dateKey)) return;

        const dayRecords = employee.byDate[day.dateKey] || [];
        const meta = employee.dateMeta[day.dateKey];
        const daySessions = employeeSessions.filter((s) => s.sessionDate === day.dateKey);

        if (dayRecords.length === 0 && daySessions.length === 0) {
          const leaveKind = approvedLeaveOnDay(
            approvedLeavesMap,
            employee.employeeId,
            day.dateKey,
          );
          const { statusLabel, deduction } = emptyWorkingDayStatus(
            day.dateKey,
            true,
            leaveKind,
          );
          const exportLabel = leaveKind ? "Leave" : statusLabel;
          if (!shouldIncludeInDeductionSummary(exportLabel)) return;
          pushDeductionSummaryRow(
            rows,
            employee,
            day.dateKey,
            exportLabel,
            deduction,
            meta?.runningLate ?? "",
          );
          return;
        }

        const leaveKind = approvedLeaveOnDay(
          approvedLeavesMap,
          employee.employeeId,
          day.dateKey,
        );
        const leaveAtt = leaveKind ? attendanceFromApprovedLeaveDay(leaveKind) : null;
        const emptyFallback = emptyWorkingDayStatus(day.dateKey, true, leaveKind);
        // Approved leave (full / half) → "Leave" in deduction summary (not PTO / half labels).
        const exportStatus = leaveAtt
          ? "Leave"
          : meta?.statusLabel || emptyFallback.statusLabel;
        if (!shouldIncludeInDeductionSummary(exportStatus)) return;
        const deduction =
          leaveAtt?.deduction || meta?.deduction || emptyFallback.deduction;
        const tardyCount = meta?.runningLate ?? "";
        const sessionsToExport = getDaySessionRows(day.dateKey, dayRecords, daySessions);

        sessionsToExport.forEach(({ session, record }, sessionIndex) => {
          pushDeductionSummaryRow(
            rows,
            employee,
            day.dateKey,
            exportStatus,
            sessionIndex === 0 ? deduction : deduction ? "---" : "",
            tardyCount,
            {
              session,
              record,
            },
          );
        });
      });
    }

    return {
      employeeName: excelEmployeeLabel(employee.employeeName, employee.pseudonym),
      rows,
      totalDeduction: calculateTotalDeduction(employee),
    };
  }

  async function downloadDeductionSummary() {
    if (attendanceByEmployee.length === 0) {
      toastInfo("No employees to export");
      return;
    }

    const selectedEmployees = attendanceByEmployee.filter(
      (e) => selectedDeductionIds[String(e.employeeId)],
    );
    const exportEmployees =
      selectedEmployees.length > 0 ? selectedEmployees : attendanceByEmployee;

    if (selectedEmployees.length === 0) {
      toastInfo("No cards selected — exporting all visible employees");
    }

    const ctx = await ensureTungstenCtx();
    const blocks = exportEmployees.map((employee) =>
      buildDeductionSummaryBlock(employee, pairSessionsForEmployee(employee, ctx)),
    );

    const dateRange = fromDate && toDate ? `-${fromDate}-to-${toDate}` : "";
    const departmentSuffix = selectedDepartment ? `-${selectedDepartment}` : "";
    const selectedSuffix =
      selectedEmployees.length > 0 ? `-selected-${selectedEmployees.length}` : "";
    const fileName = `deduction-summary${departmentSuffix}${selectedSuffix}${dateRange}.xlsx`;
    await downloadDeductionSummaryExcel(blocks, fileName);
  }

  async function openDeductionSummaryPreview(employee: MonthlyAttendanceEmployeeRow) {
    const id = String(employee.employeeId);
    setDeductionPreviewLoadingId(id);
    try {
      const ctx = await ensureTungstenCtx();
      const block = buildDeductionSummaryBlock(
        employee,
        pairSessionsForEmployee(employee, ctx),
      );
      setDeductionPreview({ employeeId: id, block });
    } catch (err) {
      toastError(String(err));
    } finally {
      setDeductionPreviewLoadingId("");
    }
  }

  async function downloadOneDeductionSummary(block: DeductionSummaryEmployeeBlock) {
    const dateRange = fromDate && toDate ? `-${fromDate}-to-${toDate}` : "";
    const safeName = String(block.employeeName || "employee")
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 40);
    const fileName = `deduction-summary-${safeName}${dateRange}.xlsx`;
    await downloadDeductionSummaryExcel([block], fileName);
  }

  async function downloadEmployeeDeductionSummary(employee: MonthlyAttendanceEmployeeRow) {
    try {
      const ctx = await ensureTungstenCtx();
      const block = buildDeductionSummaryBlock(
        employee,
        pairSessionsForEmployee(employee, ctx),
      );
      await downloadOneDeductionSummary(block);
      toastSuccess("Deduction Summary downloaded", "Export");
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err), "Export failed");
    }
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
      const empId = String(record.employee_id);
      // Admin Staff punch-only (name-matched roster): Tungsten only — no 1st/2nd half / tardy rules
      if (
        employeeIdKeys(empId).some((k) =>
          punchOnlyRosterApplies(k, record.employee_name),
        )
      ) {
        return;
      }
      const bucket =
        lookupByEmployeeId(map, empId) ||
        (() => {
          const fresh: MonthlyAttendanceEmployeeRow = {
            employeeId: empId,
            employeeName: record.employee_name || "-",
            pseudonym: record.pseudonym || "-",
            departmentName: record.department_name || "-",
            gender: record.gender || "",
            byDate: {},
            dateMeta: {},
          };
          setForEmployeeIdKeys(map, empId, fresh);
          return fresh;
        })();
      if (!bucket.gender && record.gender) {
        bucket.gender = record.gender;
      }
      const dateKey = getRecordDateKey(record);
      if (!dateKey) return;
      if (!bucket.byDate[dateKey]) bucket.byDate[dateKey] = [];
      bucket.byDate[dateKey].push(record);
    });

    const seenEmployees = new Set<object>();
    Object.values(map).forEach((employee) => {
      if (seenEmployees.has(employee)) return;
      seenEmployees.add(employee);
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
        // Session-level M overrides must drive count/deduction (not only day-level).
        const override = effectiveDayOverride(
          employee.employeeId,
          dateKey,
          dayRecords,
        );
        const isManual = Boolean(override);
        const statusLabel = override || autoStatusLabel;
        const statusColor = uiStatusTextColor(statusLabel);
        let deduction = "";
        let tardyDisplay: number | string = "";

        // Fetch pads ±1 day for overnight/ZK pairing — do NOT count those padding
        // days in monthly tardy running total (otherwise first visible tardy shows as 2).
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
        } else if (statusLabel === STATUS_FIRST_HALF_DAY || statusLabel === STATUS_SECOND_HALF_DAY) {
          deduction = "50%";
        } else {
          // On Time / Leave / Off — never keep a stale tardy count on this day.
          tardyDisplay = "";
          deduction = deductionForAttendanceStatus(statusLabel, 0);
        }

        employee.dateMeta[dateKey] = {
          runningLate: tardyDisplay,
          statusLabel,
          autoStatusLabel,
          statusColor,
          deduction,
          isManual,
          // Manual On Time must clear Late label; only Tardy (etc.) bill late minutes.
          lateMinutes: billableLateForDay(
            statusLabel,
            dayStatus.lateMinutes || 0,
            record?.late_minutes != null ? Number(record.late_minutes) : null,
          ),
        };
      });
    });

    return [...seenEmployees]
      .map((e) => e as MonthlyAttendanceEmployeeRow)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [
    attendance,
    showingImported,
    importedSnapshot,
    selectedDepartment,
    fromDate,
    toDate,
    statusOverrides,
    statusOverridesByAttendanceId,
  ]);

  /** Enrich employee_code + include Tungsten-only employees (no HRM clock-in). */
  const attendanceByEmployeeAllMerged = useMemo((): MonthlyAttendanceEmployeeRow[] => {
    if (showingImported) {
      return attendanceByEmployeeAll;
    }

    const allHrmEmployees =
      tungstenCtx?.hrmEmployees?.length ? tungstenCtx.hrmEmployees : hrmEmployeesList;
    if (!allHrmEmployees.length) {
      return attendanceByEmployeeAll;
    }

    const searchTerm = deferredSearchName.trim().toLowerCase();
    const hrmById = new Map(
      allHrmEmployees.map((e) => [e.employeeId, e] as const),
    );
    const enriched = attendanceByEmployeeAll
      .map((row) => {
        const hrm = hrmById.get(row.employeeId);
        const rosterPin = punchOnlyPinForId(row.employeeId) || "";
        return {
          ...row,
          employeeCode: row.employeeCode || hrm?.employeeCode || rosterPin || "",
          departmentName:
            row.departmentName && row.departmentName !== "-"
              ? row.departmentName
              : hrm?.departmentName || row.departmentName,
          gender: row.gender || hrm?.gender || "",
          pseudonym:
            row.pseudonym && row.pseudonym !== "-"
              ? row.pseudonym
              : hrm?.pseudonym || row.pseudonym,
        };
      })
      .filter((row) => {
        const hrm = hrmById.get(row.employeeId);
        if (!hrm) return true;
        if (isHrmEmployeeInactive(hrm.status)) {
          // Keep only when this ID is the real Admin punch-only roster person (name match).
          return punchOnlyRosterApplies(row.employeeId, row.employeeName);
        }
        return true;
      });

    const existing = new Set(enriched.map((e) => e.employeeId));
    const extra: MonthlyAttendanceEmployeeRow[] = [];

    for (const hrm of allHrmEmployees) {
      if (existing.has(hrm.employeeId)) continue;
      // Inactive / left staff: never invent Monthly Attendance cards.
      if (isHrmEmployeeInactive(hrm.status)) continue;
      if (
        selectedDepartment &&
        hrm.departmentName.toLowerCase() !== selectedDepartment.toLowerCase()
      ) {
        continue;
      }

      const matchesSearch =
        Boolean(searchTerm) &&
        (hrm.employeeName.toLowerCase().includes(searchTerm) ||
          hrm.pseudonym.toLowerCase().includes(searchTerm) ||
          String(hrm.employeeId).includes(searchTerm) ||
          hrm.employeeCode.toLowerCase().includes(searchTerm));

      const hasApprovedLeave = Boolean(
        approvedLeavesMap[String(hrm.employeeId)] &&
          Object.keys(approvedLeavesMap[String(hrm.employeeId)] || {}).length > 0,
      );

      const isRosterPunchOnly = punchOnlyRosterApplies(
        hrm.employeeId,
        hrm.employeeName,
      );
      // Active + ZK punches → card (status stays Absent until HRM clock-in).
      const hasPunches =
        Boolean(tungstenCtx) &&
        Boolean(fromDate) &&
        Boolean(toDate) &&
        employeeHasZkPunchesInRange(
          tungstenCtx as TungstenPunchContext,
          {
            employeeName: hrm.employeeName,
            employeeCode:
              hrm.employeeCode ||
              (isRosterPunchOnly ? punchOnlyPinForId(String(hrm.employeeId)) || "" : ""),
            employeeId: hrm.employeeId,
            pseudonym: hrm.pseudonym,
            departmentName: hrm.departmentName,
          },
          fromDate,
          toDate,
        );

      if (!hasPunches && !matchesSearch && !isRosterPunchOnly && !hasApprovedLeave) {
        continue;
      }

      const roster = isRosterPunchOnly ? punchOnlyById(String(hrm.employeeId)) : undefined;
      extra.push({
        employeeId: hrm.employeeId,
        employeeName: hrm.employeeName,
        employeeCode: hrm.employeeCode || roster?.pin || "",
        pseudonym: hrm.pseudonym,
        departmentName: hrm.departmentName,
        gender: hrm.gender,
        byDate: {},
        dateMeta: {},
      });
    }

    // Restore Admin punch-only cards (by roster name). Skips when a real matching
    // roster person already has a card; unused IDs (e.g. 160 after inactive Usman
    // filtered out) still get Dawood/etc. under the roster pin.
    for (const roster of PUNCH_ONLY_EMPLOYEES) {
      const rosterName = punchOnlyDisplayName(roster);
      const hasMatchingCard =
        enriched.some((e) => punchOnlyRosterApplies(e.employeeId, e.employeeName) && e.employeeId === roster.id) ||
        extra.some((e) => punchOnlyRosterApplies(e.employeeId, e.employeeName) && e.employeeId === roster.id);
      if (hasMatchingCard) continue;
      // Active HRM employee already using this id with attendance — do not duplicate.
      if (enriched.some((e) => e.employeeId === roster.id)) continue;
      if (
        selectedDepartment &&
        roster.departmentName.toLowerCase() !== selectedDepartment.toLowerCase()
      ) {
        continue;
      }
      for (let i = extra.length - 1; i >= 0; i--) {
        if (
          extra[i].employeeId === roster.id &&
          !punchOnlyRosterApplies(extra[i].employeeId, extra[i].employeeName)
        ) {
          extra.splice(i, 1);
        }
      }
      extra.push({
        employeeId: roster.id,
        employeeName: rosterName,
        employeeCode: roster.pin,
        pseudonym: "-",
        departmentName: roster.departmentName,
        gender: "",
        byDate: {},
        dateMeta: {},
      });
    }

    if (!extra.length) return enriched;
    return [...enriched, ...extra].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    );
  }, [
    attendanceByEmployeeAll,
    tungstenCtx,
    hrmEmployeesList,
    showingImported,
    selectedDepartment,
    fromDate,
    toDate,
    deferredSearchName,
    approvedLeavesMap,
  ]);

  /** Cheap name / pseudo / ID filter — deferred so typing does not block the input */
  const attendanceByEmployee = useMemo(() => {
    const term = deferredSearchName.trim().toLowerCase();
    if (!term) return attendanceByEmployeeAllMerged;
    return attendanceByEmployeeAllMerged.filter((e) => {
      const name = (e.employeeName || "").toLowerCase();
      const pseudo = (e.pseudonym || "").toLowerCase();
      const id = String(e.employeeId || "").toLowerCase();
      return name.includes(term) || pseudo.includes(term) || id.includes(term);
    });
  }, [attendanceByEmployeeAllMerged, deferredSearchName]);

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
    // Pair Tungsten for every employee so T.Punch shows without expanding the card.
    attendanceByEmployeeAllMerged.forEach((emp) => {
      const empId = String(emp.employeeId);
      if (!tungstenCtx || !fromDate || !toDate) return;
      if (punchOnlyRosterApplies(empId, emp.employeeName)) {
        out.set(
          String(emp.employeeId),
          buildShiftPunchOnlySessions(
            employeeMatchKeys(emp),
            tungstenCtx,
            fromDate,
            toDate,
            shiftResolverForEmployee(empId, emp.employeeName),
          ),
        );
        return;
      }
      const allRecords = recordsByEmployeeId.get(empId) || [];
      out.set(
        String(emp.employeeId),
        // ZK-only T.Punch rows OK; status stays Absent until HRM clock-in exists.
        buildEmployeeReportSessions(
          employeeMatchKeys(emp),
          allRecords,
          tungstenCtx,
          todayKey,
          pairingNow,
          zkFrom,
          zkTo,
          shiftResolverForEmployee(empId, emp.employeeName),
          true,
        ),
      );
    });
    return out;
  }, [
    attendance,
    attendanceByEmployeeAllMerged,
    tungstenCtx,
    showingImported,
    fromDate,
    toDate,
    pairingNow,
    shiftAssignments,
    hrmEmployeesList,
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
    const employeeSessions = sessionsByEmployeeId.get(String(emp.employeeId)) || [];
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

  const expandedCount = useMemo(
    () =>
      attendanceByEmployee.reduce(
        (n, e) => n + (expandedEmployeeIds[e.employeeId] ? 1 : 0),
        0,
      ),
    [attendanceByEmployee, expandedEmployeeIds],
  );
  const workingDaysCount = getTotalWorkingDays(monthInfo);
  const workingDayRows = useMemo(
    () =>
      (monthInfo.days || []).filter((day: { dateKey: string }) => isWorkingDay(day.dateKey)),
    // monthInfo + calendar Off/Working drive isWorkingDay
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthInfo, selectedMonth, calendarOverrides],
  );
  const expandedEmployees = useMemo(
    () => attendanceByEmployee.filter((e) => expandedEmployeeIds[e.employeeId]),
    [attendanceByEmployee, expandedEmployeeIds],
  );
  const departmentMetricRows = useMemo(() => {
    if (selectedDepartment) {
      return [{ id: selectedDepartment, name: selectedDepartment }];
    }
    return (departments || [])
      .map((d: any) => ({
        id: String(d.id ?? d.name ?? d.department_name ?? ""),
        name: String(d.name || d.department_name || "").trim(),
      }))
      .filter((d: { name: string }) => d.name)
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  }, [departments, selectedDepartment]);
  const departmentMetricCount = selectedDepartment ? 1 : departmentMetricRows.length;
  const attendanceIds = useMemo(
    () => attendanceByEmployee.map((e) => String(e.employeeId)),
    [attendanceByEmployee],
  );
  const selectedDeductionCount = useMemo(
    () => attendanceIds.filter((id) => selectedDeductionIds[id]).length,
    [attendanceIds, selectedDeductionIds],
  );
  const allDeductionSelected =
    attendanceIds.length > 0 && selectedDeductionCount === attendanceIds.length;


  const renderEmployeeMonthTable = (employee: any, revealPunches: boolean) => (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
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
                          <th style={{ whiteSpace: "normal", minWidth: 120, maxWidth: 200 }}>Note</th>
                          <th style={{ whiteSpace: "normal", minWidth: 120, maxWidth: 200 }}>HR note</th>
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
                                <td>{maskTPunch(day.tPunchIn, revealPunches)}</td>
                                <td>{day.clockIn}</td>
                                <td>{day.clockOut}</td>
                                <td>{maskTPunch(day.tPunchOut, revealPunches)}</td>
                                <td>{day.totalWH}</td>
                                <td style={{ display: "none" }}>{day.assignedWH}</td>
                                <td>{day.overtime}</td>
                                <td>{tardyDisplay}</td>
                                <td style={{ color: uiStatusTextColor(rowStatus), fontWeight: 600 }}>
                                  {renderEditableStatusCell({
                                    employeeId: employee.employeeId,
                                    dateKey: day.dateKey,
                                    displayStatus: rowStatus,
                                    lateMinutes:
                                      normalizeAttendanceStatus(rowStatus) === "Tardy"
                                        ? meta?.lateMinutes
                                        : null,
                                    isManual:
                                      Boolean(meta?.isManual) ||
                                      Boolean(overrideStatusFor(employee.employeeId, day.dateKey)),
                                  })}
                                </td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>{tardyNoteForCell(employee.employeeId, day.dateKey, rowStatus)}</td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>{hrNoteForCell(employee.employeeId, day.dateKey)}</td>
                                <td>{rowDeduction}</td>
                              </tr>
                            );
                          }

                          const day = rowCtx.day;
                          const dayRecords = employee.byDate[day.dateKey] || [];
                          const meta = rowCtx.meta;
                          const workingDay = isWorkingDay(day.dateKey);
                          const employeeSessions = sessionsByEmployeeId.get(String(employee.employeeId)) || [];
                          // All employees: keep ZK-only sessions (shift first/last T.Punch).
                          // Status still depends on HRM clock-in/out only (Absent if none).
                          const daySessions = employeeSessions.filter(
                            (s) => s.sessionDate === day.dateKey,
                          );

                          if (daySessions.length === 0 && dayRecords.length === 0) {
                            const leaveKind = approvedLeaveOnDay(
                              approvedLeavesMap,
                              employee.employeeId,
                              day.dateKey,
                            );
                            const leaveAttEmpty = leaveKind
                              ? attendanceFromApprovedLeaveDay(leaveKind)
                              : null;
                            const emptyAuto = emptyWorkingDayStatus(
                              day.dateKey,
                              workingDay,
                              leaveKind,
                            );
                            const emptyOverride = overrideStatusFor(
                              employee.employeeId,
                              day.dateKey,
                            );
                            const statusLabel = emptyOverride || emptyAuto.statusLabel;
                            // Approved leave (incl. half day) always 0% — same as full-day Leave.
                            const deduction = leaveAttEmpty
                              ? leaveAttEmpty.deduction
                              : emptyOverride
                                ? deductionForAttendanceStatus(
                                    emptyOverride,
                                    normalizeAttendanceStatus(emptyOverride) === "Tardy"
                                      ? meta?.runningLate
                                      : 0,
                                  )
                                : emptyAuto.deduction;
                            const emptyStatusColor =
                              leaveAttEmpty && !emptyOverride
                                ? leaveAttEmpty.statusColor
                                : uiStatusTextColor(statusLabel);
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
                                <td>
                                  {normalizeAttendanceStatus(statusLabel) === "Tardy" &&
                                  meta?.runningLate
                                    ? meta.runningLate
                                    : ""}
                                </td>
                                <td style={{ color: emptyStatusColor, fontWeight: 600 }}>
                                  {renderEditableStatusCell({
                                    employeeId: employee.employeeId,
                                    dateKey: day.dateKey,
                                    displayStatus: statusLabel,
                                    lateMinutes:
                                      normalizeAttendanceStatus(statusLabel) === "Tardy"
                                        ? meta?.lateMinutes
                                        : null,
                                    isManual: Boolean(emptyOverride),
                                    disabled: statusLabel === "---",
                                    statusColorOverride:
                                      leaveAttEmpty && !emptyOverride
                                        ? leaveAttEmpty.statusColor
                                        : null,
                                  })}
                                </td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>{tardyNoteForCell(employee.employeeId, day.dateKey, statusLabel, undefined, dayRecords)}</td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>{hrNoteForCell(employee.employeeId, day.dateKey)}</td>
                                <td>{deduction}</td>
                              </tr>
                            );
                          }

                          const leaveKindDay = approvedLeaveOnDay(
                            approvedLeavesMap,
                            employee.employeeId,
                            day.dateKey,
                          );
                          const leaveAttDay = leaveKindDay
                            ? attendanceFromApprovedLeaveDay(leaveKindDay)
                            : null;
                          const emptyFallback = emptyWorkingDayStatus(
                            day.dateKey,
                            workingDay,
                            leaveKindDay,
                          );
                          const dayLevelOverride = overrideStatusFor(
                            employee.employeeId,
                            day.dateKey,
                          );
                          // Status: leave → calendar Off → HRM meta → Absent. Punches never invent status.
                          const dayAutoStatus = leaveAttDay
                            ? leaveAttDay.statusLabel
                            : !workingDay
                              ? "Off"
                              : meta?.autoStatusLabel || meta?.statusLabel
                                ? normalizeAttendanceStatus(
                                    meta.autoStatusLabel || meta.statusLabel || "-",
                                  )
                                : emptyFallback.statusLabel;
                          const sessionsToShow = getDaySessionRows(
                            day.dateKey,
                            dayRecords,
                            daySessions
                          );

                          return sessionsToShow.map(({ session, record }, index) => {
                            const attId = normalizeOverrideAttendanceId(record?.id);
                            // Session-specific override wins; else legacy day-level; else auto.
                            const sessionOverride =
                              attId > 0
                                ? overrideStatusFor(
                                    employee.employeeId,
                                    day.dateKey,
                                    attId,
                                  )
                                : null;
                            const effectiveOverride = sessionOverride || dayLevelOverride;
                            const rowStatus = effectiveOverride || dayAutoStatus;
                            // Day deduction is computed once; show % only on first same-day row.
                            const dayDeductionValue = leaveAttDay
                              ? leaveAttDay.deduction
                              : effectiveOverride
                                ? deductionForAttendanceStatus(
                                    effectiveOverride,
                                    normalizeAttendanceStatus(effectiveOverride) === "Tardy"
                                      ? meta?.runningLate
                                      : 0,
                                  )
                                : !workingDay
                                  ? ""
                                  : meta?.deduction || emptyFallback.deduction;
                            const rowDeduction =
                              index === 0
                                ? dayDeductionValue
                                : dayDeductionValue
                                  ? "---"
                                  : "";
                            const rowStatusColor =
                              leaveAttDay && !effectiveOverride
                                ? leaveAttDay.statusColor
                                : uiStatusTextColor(rowStatus);
                            const statusIsManual = Boolean(effectiveOverride);
                            const rowIsTardy =
                              normalizeAttendanceStatus(rowStatus) === "Tardy";
                            return (
                              <tr
                                key={`${employee.employeeId}-${day.dateKey}-session-${index}`}
                              >
                                <td>{day.weekday}</td>
                                <td>{formatDateKey(day.dateKey)}</td>
                                <td>
                                  {maskTPunch(
                                    monthlyDash(session.tungstenPunchIn),
                                    revealPunches,
                                  )}
                                </td>
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
                                <td>
                                  {maskTPunch(
                                    monthlyDash(session.tungstenPunchOut),
                                    revealPunches,
                                  )}
                                </td>
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
                                <td>
                                  {rowIsTardy && meta?.runningLate ? meta.runningLate : ""}
                                </td>
                                <td
                                  style={{
                                    color: rowStatusColor,
                                    fontWeight: 600,
                                  }}
                                >
                                  {renderEditableStatusCell({
                                    employeeId: employee.employeeId,
                                    dateKey: day.dateKey,
                                    displayStatus: rowStatus,
                                    lateMinutes:
                                      index === 0 && rowIsTardy ? meta?.lateMinutes : null,
                                    isManual: statusIsManual,
                                    attendanceId: attId > 0 ? attId : null,
                                    statusColorOverride:
                                      leaveAttDay && !effectiveOverride
                                        ? leaveAttDay.statusColor
                                        : null,
                                  })}
                                </td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>
                                  {tardyNoteForCell(
                                    employee.employeeId,
                                    day.dateKey,
                                    rowStatus,
                                    attId > 0 ? attId : record?.id,
                                    dayRecords
                                  )}
                                </td>
                                <td style={{ whiteSpace: "normal", minWidth: 160, maxWidth: 280, lineHeight: 1.35, wordBreak: "break-word" }}>
                                  {hrNoteForCell(
                                    employee.employeeId,
                                    day.dateKey,
                                    attId > 0 ? attId : null,
                                  )}
                                </td>
                                <td>{rowDeduction}</td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC", borderTop: "2px solid #E2E8F0" }}>
                          <td colSpan={13} style={{ textAlign: "right", paddingRight: 16 }}>
                            Total Deduction:
                          </td>
                          <td>
                            {employee.isImported && employee.importedFooter?.totalDeduction != null
                              ? `${String(employee.importedFooter.totalDeduction).replace(/%$/, "")}%`
                              : `${calculateTotalDeduction(employee)}%`}
                          </td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={13} style={{ textAlign: "right", paddingRight: 16 }}>
                            Extra Hours:
                          </td>
                          <td>
                            {employee.isImported && employee.importedFooter?.extraHours
                              ? employee.importedFooter.extraHours
                              : getEmployeeTotalOvertime(employee)}
                          </td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={13} style={{ textAlign: "right", paddingRight: 16 }}>
                            Late Exceed:
                          </td>
                          <td>{getEmployeeTotalExcessLate(employee)}</td>
                        </tr>
                        <tr style={{ fontWeight: 700, backgroundColor: "#F7FAFC" }}>
                          <td colSpan={13} style={{ textAlign: "right", paddingRight: 16 }}>
                            Total Working Days:
                          </td>
                          <td>
                            {employee.isImported && employee.importedFooter?.workingDays
                              ? employee.importedFooter.workingDays
                              : getTotalWorkingDays(monthInfo)}
                          </td>
                        </tr>
                      </tfoot>

                    </table>
                  </div>
  );

  const fullViewEmployee = useMemo(
    () =>
      attendanceByEmployee.find(
        (e) => String(e.employeeId) === String(fullViewEmployeeId),
      ) || null,
    [attendanceByEmployee, fullViewEmployeeId],
  );

  const metricModalTitle =
    metricModal === "employees"
      ? "Employees"
      : metricModal === "workingDays"
        ? "Working days"
        : metricModal === "expanded"
          ? "Expanded attendance"
          : metricModal === "departments"
            ? "Departments"
            : "";

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <header className={styles.topBar}>
          <div className={styles.topLeft}>
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDot} aria-hidden />
              Interact Attendance
            </p>
            <h1 className={styles.heroTitle}>
              Monthly attendance
              {monthInfo.label ? ` — ${monthInfo.label}` : ""}
            </h1>
            <p className={styles.heroSub}>
              Review clock-in/out, shift punches, status, and deductions for the selected month.
            </p>
            {showingImported ? (
              <p className={styles.importBanner}>
                Showing imported Excel data for {monthInfo.label} (sheet values as-is)
              </p>
            ) : null}
          </div>
          <div className={styles.topRight}>
            <label className={styles.monthChip}>
              <span>Month</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Attendance month"
              />
            </label>
            <button type="button" className={styles.secondaryBtn} onClick={fetchAttendance}>
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className={styles.metricStrip}>
          <button
            type="button"
            className={`${styles.metric} ${styles.metricAccent} ${styles.metricClickable}`}
            onClick={() => setMetricModal("employees")}
            title="View employee list"
          >
            <div className={styles.metricLabel}>Employees</div>
            <div className={styles.metricValue}>{attendanceByEmployee.length}</div>
          </button>
          <button
            type="button"
            className={`${styles.metric} ${styles.metricClickable}`}
            onClick={() => setMetricModal("workingDays")}
            title="View working days"
          >
            <div className={styles.metricLabel}>Working days</div>
            <div className={styles.metricValue}>{workingDaysCount}</div>
          </button>
          <button
            type="button"
            className={`${styles.metric} ${styles.metricClickable}`}
            onClick={() => setMetricModal("expanded")}
            title="View expanded employees"
          >
            <div className={styles.metricLabel}>Expanded</div>
            <div className={styles.metricValue}>{expandedCount}</div>
          </button>
          <button
            type="button"
            className={`${styles.metric} ${styles.metricClickable}`}
            onClick={() => setMetricModal("departments")}
            title="View departments"
          >
            <div className={styles.metricLabel}>Departments</div>
            <div className={styles.metricValue}>{departmentMetricCount}</div>
          </button>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.panelHeadLeft}>
              <h2 className={styles.panelTitle}>Filters &amp; exports</h2>
              <p className={styles.panelHint}>
                Search by name, filter department, then Export Attendance or Export Deduction Summary
              </p>
            </div>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => {
                setSearchName("");
                setSelectedDepartment("");
              }}
            >
              Clear filters
            </button>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.filters}>
              <label className={styles.field}>
                <span className={styles.label}>Search</span>
                <input
                  type="text"
                  placeholder="Name, pseudo or ID…"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  className={styles.input}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Department</span>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className={styles.select}
                >
                  <option value="">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.name || dept.department_name}>
                      {dept.name || dept.department_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.actions}>
                <button type="button" onClick={fetchAttendance} className={styles.primaryBtn}>
                  Search
                </button>
                <button type="button" onClick={downloadExcel} className={styles.secondaryBtn}>
                  <FaFileExcel /> Export Attendance
                </button>
                <button
                  type="button"
                  onClick={downloadDeductionSummary}
                  className={styles.secondaryBtn}
                  title={
                    selectedDeductionCount > 0
                      ? `Export Deduction Summary for ${selectedDeductionCount} selected`
                      : "Export Deduction Summary for all visible employees"
                  }
                >
                  <FaFileExcel />{" "}
                  {selectedDeductionCount > 0
                    ? `Export Deduction Summary (${selectedDeductionCount})`
                    : "Export Deduction Summary"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading attendance records…</div>
        ) : (
          <div className={styles.list}>
            {attendanceByEmployee.length === 0 ? (
              <div className={styles.empty}>No attendance records found</div>
            ) : (
              <>
              <div className={styles.selectBar}>
                <label className={styles.selectAllLabel}>
                  <input
                    type="checkbox"
                    checked={allDeductionSelected}
                    onChange={(e) =>
                      setAllDeductionSelected(attendanceIds, e.target.checked)
                    }
                    className={styles.cardCheck}
                  />
                  <span>
                    {allDeductionSelected
                      ? "Deselect all cards"
                      : "Select all cards"}
                  </span>
                </label>
                {selectedDeductionCount > 0 ? (
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setSelectedDeductionIds({})}
                  >
                    Clear ({selectedDeductionCount})
                  </button>
                ) : (
                  <span className={styles.selectHint}>
                    Select cards, then Export Deduction Summary
                  </span>
                )}
              </div>
              {attendanceByEmployee.map((employee) => {
                const isExpanded = Boolean(expandedEmployeeIds[employee.employeeId]);
                const isDeductionSelected = Boolean(
                  selectedDeductionIds[String(employee.employeeId)],
                );
                const revealPunches = shouldRevealTPunches(
                  employee.departmentName,
                  selectedDepartment,
                  deferredSearchName,
                );
                return (
                <div
                  key={employee.employeeId}
                  className={`${styles.empCard}${isExpanded ? ` ${styles.empCardExpanded}` : ""}${isDeductionSelected ? ` ${styles.empCardSelected}` : ""}${exportMenuEmployeeId === String(employee.employeeId) ? ` ${styles.empCardMenuOpen}` : ""}`}
                >
                  <div
                    className={styles.empCardHead}
                    style={{ marginBottom: isExpanded ? 8 : 0 }}
                  >
                    <div className={styles.empCardLeft}>
                      <label className={styles.cardCheckWrap} title="Select for deduction export">
                        <input
                          type="checkbox"
                          checked={isDeductionSelected}
                          onChange={() => toggleDeductionSelected(employee.employeeId)}
                          className={styles.cardCheck}
                        />
                      </label>
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
                        <div className={styles.empMeta}>
                          {employee.pseudonym} · {employee.departmentName}
                        </div>
                      </div>
                    </div>
                    <div className={styles.empActions}>
                      <button
                        type="button"
                        title="Open full view — view and edit status"
                        className={styles.ghostBtn}
                        onClick={() => {
                          const id = String(employee.employeeId);
                          setExpandedEmployeeIds((prev) => ({ ...prev, [id]: true }));
                          setFullViewEmployeeId(id);
                        }}
                      >
                        Full view
                      </button>
                      <div className={styles.empId}>Emp. ID {employee.employeeId}</div>
                      <button
                        type="button"
                        title={isExpanded ? "Hide month table" : "Show month table"}
                        className={`${styles.ghostBtn} ${isExpanded ? styles.ghostBtnActive : ""}`}
                        onClick={() => toggleEmployeeExpanded(employee.employeeId)}
                      >
                        {isExpanded ? "Hide attendance" : "View attendance"}
                      </button>
                      <button
                        type="button"
                        title="View deduction summary (same as export)"
                        className={styles.ghostBtn}
                        disabled={deductionPreviewLoadingId === String(employee.employeeId)}
                        onClick={() => void openDeductionSummaryPreview(employee)}
                      >
                        {deductionPreviewLoadingId === String(employee.employeeId)
                          ? "…"
                          : "View deduction"}
                      </button>
                      <div className={styles.exportMenuWrap} data-export-menu>
                        <button
                          type="button"
                          title="Export Attendance or Deduction Summary"
                          className={styles.ghostBtn}
                          aria-expanded={
                            exportMenuEmployeeId === String(employee.employeeId)
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            const id = String(employee.employeeId);
                            setExportMenuEmployeeId((prev) => (prev === id ? "" : id));
                          }}
                        >
                          <FaFileExcel /> Export ▾
                        </button>
                        {exportMenuEmployeeId === String(employee.employeeId) ? (
                          <div className={styles.exportMenu} role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className={styles.exportMenuItem}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportMenuEmployeeId("");
                                void downloadEmployeeExcel(employee);
                              }}
                            >
                              Attendance
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className={styles.exportMenuItem}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportMenuEmployeeId("");
                                void downloadEmployeeDeductionSummary(employee);
                              }}
                            >
                              Deduction Summary
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {isExpanded ? (
                    renderEmployeeMonthTable(employee, revealPunches)
                  ) : (
                    <p className={styles.hint}>
                      Click <strong>View attendance</strong> to load this employee&apos;s month table.
                    </p>
                  )}
                </div>
                );
              })}
              </>
            )}
          </div>
        )}
      </div>
      {popup}
      <StatusChangeReasonModal
        draft={statusReasonDraft}
        saving={
          Boolean(
            statusReasonDraft &&
              statusSavingKey ===
                statusSaveKey(
                  statusReasonDraft.employeeId,
                  statusReasonDraft.dateKey,
                  statusReasonDraft.attendanceId,
                ),
          )
        }
        onCancel={() => setStatusReasonDraft(null)}
        onConfirm={(reason) => {
          if (!statusReasonDraft) return;
          const draft = statusReasonDraft;
          void (async () => {
            const ok = await saveManualStatus(
              draft.employeeId,
              draft.dateKey,
              draft.nextStatus,
              reason,
              draft.attendanceId,
            );
            if (ok) setStatusReasonDraft(null);
          })();
        }}
      />

      {typeof document !== "undefined" && fullViewEmployee
        ? createPortal(
            <div
              className={styles.modalOverlay}
              data-hrm-modal-overlay
              onClick={() => setFullViewEmployeeId("")}
            >
              <div
                className={`${styles.modalCard} ${styles.modalCardWide}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="fullview-modal-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.modalHead}>
                  <h3 id="fullview-modal-title" className={styles.modalTitle}>
                    {fullViewEmployee.employeeName}
                  </h3>
                  <p className={styles.modalSub}>
                    Emp. ID {fullViewEmployee.employeeId}
                    {fullViewEmployee.pseudonym ? ` · ${fullViewEmployee.pseudonym}` : ""}
                    {fullViewEmployee.departmentName
                      ? ` · ${fullViewEmployee.departmentName}`
                      : ""}
                    {monthInfo.label ? ` · ${monthInfo.label}` : ""}
                    {" — view and edit status"}
                  </p>
                </div>
                <div className={styles.modalBody}>
                  {renderEmployeeMonthTable(
                    fullViewEmployee,
                    shouldRevealTPunches(
                      fullViewEmployee.departmentName,
                      selectedDepartment,
                      deferredSearchName,
                    ),
                  )}
                </div>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setFullViewEmployeeId("")}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {typeof document !== "undefined" && metricModal
        ? createPortal(
            <div
              className={styles.modalOverlay}
              data-hrm-modal-overlay
              onClick={() => setMetricModal(null)}
            >
              <div
                className={styles.modalCard}
                role="dialog"
                aria-modal="true"
                aria-labelledby="metric-modal-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.modalHead}>
                  <h3 id="metric-modal-title" className={styles.modalTitle}>
                    {metricModalTitle}
                  </h3>
                  <p className={styles.modalSub}>
                    {metricModal === "employees"
                      ? `${attendanceByEmployee.length} employee(s) in current filters`
                      : metricModal === "workingDays"
                        ? `${workingDaysCount} working day(s) in ${monthInfo.label || selectedMonth}`
                        : metricModal === "expanded"
                          ? `${expandedCount} attendance table(s) open`
                          : selectedDepartment
                            ? "Filtered to one department"
                            : `${departmentMetricCount} department(s)`}
                  </p>
                </div>
                <div className={styles.modalBody}>
                  {metricModal === "employees" ? (
                    attendanceByEmployee.length === 0 ? (
                      <p className={styles.modalEmpty}>No employees in the current filter.</p>
                    ) : (
                      <div className={styles.modalTableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Emp. ID</th>
                              <th>Name</th>
                              <th>P.Name</th>
                              <th>Department</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attendanceByEmployee.map((emp) => (
                              <tr key={emp.employeeId}>
                                <td>{emp.employeeId}</td>
                                <td>{emp.employeeName}</td>
                                <td>{emp.pseudonym || "—"}</td>
                                <td>{emp.departmentName || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : null}
                  {metricModal === "workingDays" ? (
                    workingDayRows.length === 0 ? (
                      <p className={styles.modalEmpty}>No working days for this month.</p>
                    ) : (
                      <div className={styles.modalTableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Day</th>
                              <th>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {workingDayRows.map(
                              (
                                day: { day: number; dateKey: string; weekday: string },
                                idx: number,
                              ) => (
                                <tr key={day.dateKey}>
                                  <td>{idx + 1}</td>
                                  <td>{day.weekday}</td>
                                  <td>{formatDateKey(day.dateKey)}</td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : null}
                  {metricModal === "expanded" ? (
                    expandedEmployees.length === 0 ? (
                      <p className={styles.modalEmpty}>
                        No attendance tables are open. Click <strong>View attendance</strong> on
                        an employee card.
                      </p>
                    ) : (
                      <div className={styles.modalTableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Emp. ID</th>
                              <th>Name</th>
                              <th>Department</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expandedEmployees.map((emp) => (
                              <tr key={emp.employeeId}>
                                <td>{emp.employeeId}</td>
                                <td>{emp.employeeName}</td>
                                <td>{emp.departmentName || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : null}
                  {metricModal === "departments" ? (
                    departmentMetricRows.length === 0 ? (
                      <p className={styles.modalEmpty}>No departments found.</p>
                    ) : (
                      <div className={styles.modalTableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Department</th>
                            </tr>
                          </thead>
                          <tbody>
                            {departmentMetricRows.map((dept, idx) => (
                              <tr key={dept.id || dept.name}>
                                <td>{idx + 1}</td>
                                <td>{dept.name}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : null}
                </div>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setMetricModal(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && deductionPreview
        ? createPortal(
            <div
              className={styles.modalOverlay}
              data-hrm-modal-overlay
              onClick={() => setDeductionPreview(null)}
            >
              <div
                className={`${styles.modalCard} ${styles.deductionModalCard}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="deduction-summary-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.modalBody}>
                  <div className={styles.deductionSheet}>
                    <div className={styles.deductionBannerName}>
                      {deductionPreview.block.employeeName}
                    </div>
                    <div
                      id="deduction-summary-title"
                      className={styles.deductionBannerTitle}
                    >
                      Deduction Summary
                    </div>
                    {deductionPreview.block.rows.length === 0 ? (
                      <p className={styles.modalEmpty}>No deductible days for this employee.</p>
                    ) : (
                      <div className={styles.modalTableWrap}>
                        <table className={styles.deductionExportTable}>
                          <thead>
                            <tr>
                              {DEDUCTION_SUMMARY_HEADERS.map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {deductionPreview.block.rows.map((row, idx) => {
                              const status = normalizeAttendanceStatus(row.status);
                              const tardy = isTardyStatus(status);
                              const absentOrHalf = isAbsentOrHalfDayStatus(status);
                              const rowClass = tardy
                                ? styles.deductionRowTardy
                                : absentOrHalf
                                  ? styles.deductionRowAbsent
                                  : undefined;
                              return (
                                <tr key={`${row.date}-${idx}`} className={rowClass}>
                                  <td>{row.date}</td>
                                  <td>{row.tPunchIn}</td>
                                  <td>{row.clockIn}</td>
                                  <td>{row.clockOut}</td>
                                  <td>{row.tPunchOut}</td>
                                  <td>{row.totalWorkingHours || "--"}</td>
                                  <td>{status}</td>
                                  <td>
                                    {row.tardyCount === 0 || row.tardyCount === ""
                                      ? ""
                                      : row.tardyCount}
                                  </td>
                                  <td>{row.tardyNote || ""}</td>
                                  <td>{row.hrNote || ""}</td>
                                  <td className={styles.deductionCell}>{row.deduction}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan={9} />
                              <td className={styles.deductionCell}>Total</td>
                              <td className={styles.deductionCell}>
                                {deductionPreview.block.totalDeduction}%
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setDeductionPreview(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => void downloadOneDeductionSummary(deductionPreview.block)}
                  >
                    <FaFileExcel /> Export Deduction Summary
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </OptionalAdminShell>
  );
}
