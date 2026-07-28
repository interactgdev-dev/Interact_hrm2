"use client";

import React, { Suspense, useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FaArrowLeft } from "react-icons/fa";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  getParts,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
import {
  aggregateDayPunches,
  classifyDayAttendance,
} from "../../../lib/monthly-attendance-status";
import {
  normalizeAttendanceStatus,
  uiStatusTextColor,
} from "../../../lib/attendance-status";
import styles from "./attendance.module.css";

type AttendanceRow = {
  id?: number;
  date?: string;
  clock_in?: string | null;
  clock_out?: string | null;
  gender?: string | null;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
};

type DayRow = {
  dateKey: string;
  weekday: string;
  dateDisplay: string;
  clockIn: string;
  clockOut: string;
  status: string;
};

type FilterTab = "absent" | "present";

function addDaysToDateKey(dateKey: string, daysToAdd: number) {
  const [yearStr, monthStr, dayStr] = dateKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return dateKey;
  const utc = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

function isMonthlyWorkingDay(
  dateKey: string,
  calendarOverrides: Record<string, { status?: string }>
): boolean {
  if (!dateKey) return false;
  const override = calendarOverrides[dateKey];
  if (override) return String(override.status || "").toLowerCase() === "working";
  const [yearStr, monthStr, dayStr] = dateKey.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  if (!year || monthIndex < 0 || !day) return false;
  const date = new Date(Date.UTC(year, monthIndex, day));
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function toLeaveDateKey(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return getDateStringInTimeZone(value, SERVER_TIMEZONE) || "";
  }
  return String(value).slice(0, 10);
}

function recordDateKey(record: AttendanceRow) {
  if (record.clock_in) {
    const fromClock = getDateStringInTimeZone(record.clock_in, SERVER_TIMEZONE);
    if (fromClock) return fromClock;
  }
  if (record.date) {
    const raw = String(record.date);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return getDateStringInTimeZone(raw, SERVER_TIMEZONE) || "";
  }
  return "";
}

function weekdayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  const instant = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(instant);
}

function formatDateDisplay(dateKey: string) {
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return dateKey;
  return `${m}/${d}/${y}`;
}

function formatClock(value: string | null | undefined) {
  if (!value) return "---";
  const t = getTimeStringInTimeZone(value, SERVER_TIMEZONE);
  return t || "---";
}

function AttendancePageInner() {
  const searchParams = useSearchParams();
  const initialFilter = (searchParams?.get("filter") || "absent").toLowerCase();
  const [filter, setFilter] = useState<FilterTab>(
    initialFilter === "present" ? "present" : "absent"
  );
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [monthLabel, setMonthLabel] = useState("");
  const [monthOffset, setMonthOffset] = useState(0);

  useEffect(() => {
    const id =
      localStorage.getItem("employeeId") || localStorage.getItem("loginId") || "";
    setEmployeeId(id);
  }, []);

  const loadMonth = useCallback(async (empId: string, offset: number) => {
    setLoading(true);
    try {
      const nowParts = getParts(new Date(), SERVER_TIMEZONE);
      const baseYear = nowParts?.year ?? new Date().getFullYear();
      const baseMonth = nowParts?.month ?? new Date().getMonth() + 1;
      const anchor = new Date(Date.UTC(baseYear, baseMonth - 1 + offset, 1, 12, 0, 0));
      const year = anchor.getUTCFullYear();
      const month = anchor.getUTCMonth() + 1;
      const monthStr = `${year}-${String(month).padStart(2, "0")}`;
      const monthStart = `${monthStr}-01`;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const monthEnd = `${monthStr}-${String(daysInMonth).padStart(2, "0")}`;
      const todayKey = getDateStringInTimeZone(new Date(), SERVER_TIMEZONE);

      setMonthLabel(
        new Intl.DateTimeFormat("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(anchor)
      );

      const [attRes, calRes, leaveRes] = await Promise.all([
        fetch(
          `/api/attendance?employeeId=${encodeURIComponent(empId)}&fromDate=${monthStart}&toDate=${monthEnd}&ts=${Date.now()}`,
          { cache: "no-store" }
        ),
        fetch(`/api/calendar?month=${encodeURIComponent(monthStr)}`, { cache: "no-store" }),
        fetch(
          `/api/leaves?employees=${encodeURIComponent(empId)}&status=approved&fromDate=${monthStart}&toDate=${monthEnd}`,
          { cache: "no-store" }
        ),
      ]);

      const attData = await attRes.json().catch(() => null);
      const calData = await calRes.json().catch(() => null);
      const leaveData = await leaveRes.json().catch(() => null);

      const calendarOverrides: Record<string, { status?: string }> = {};
      if (calData?.success) {
        (calData.days || []).forEach((d: { date: string; status?: string }) => {
          if (d?.date) calendarOverrides[d.date] = d;
        });
      }

      const leaveKeys = new Set<string>();
      if (leaveData?.success && Array.isArray(leaveData.leaves)) {
        for (const leave of leaveData.leaves) {
          const start = toLeaveDateKey(leave.start_date);
          const end = toLeaveDateKey(leave.end_date) || start;
          if (!start) continue;
          let cursor = start;
          for (let i = 0; i < 62; i++) {
            if (cursor >= monthStart && cursor <= monthEnd) leaveKeys.add(cursor);
            if (cursor >= end) break;
            cursor = addDaysToDateKey(cursor, 1);
          }
        }
      }

      const byDate = new Map<string, AttendanceRow[]>();
      const attendanceList: AttendanceRow[] = attData?.success ? attData.attendance || [] : [];
      attendanceList.forEach((row) => {
        const key = recordDateKey(row);
        if (!key) return;
        const list = byDate.get(key);
        if (list) list.push(row);
        else byDate.set(key, [row]);
      });

      const nextRows: DayRow[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${monthStr}-${String(d).padStart(2, "0")}`;
        const working = isMonthlyWorkingDay(key, calendarOverrides);
        const dayRecords = byDate.get(key) || [];
        const onLeave = leaveKeys.has(key);

        let status = "Off";
        let clockIn = "---";
        let clockOut = "---";

        if (onLeave) {
          status = "Leave";
        } else if (!working) {
          status = "Off";
        } else if (dayRecords.length === 0) {
          // Future working days: show Pending; past/today without punch: Absent (today open stays Absent until punch — matches monthly)
          if (key > todayKey) status = "Upcoming";
          else status = "Absent";
        } else {
          const { clockIn: cin, clockOut: cout, record } = aggregateDayPunches(dayRecords);
          clockIn = formatClock(cin);
          clockOut = formatClock(cout);
          if (!cin) {
            status = key > todayKey ? "Upcoming" : "Absent";
          } else {
            const dayStatus = classifyDayAttendance({
              dateKey: key,
              clockIn: cin,
              clockOut: cout,
              shiftStart: record?.shift_start_time ?? null,
              shiftEnd: record?.shift_end_time ?? null,
              gender: record?.gender ?? null,
            });
            status = normalizeAttendanceStatus(dayStatus.statusLabel);
          }
        }

        nextRows.push({
          dateKey: key,
          weekday: weekdayLabel(key),
          dateDisplay: formatDateDisplay(key),
          clockIn,
          clockOut,
          status,
        });
      }

      setRows(nextRows);
    } catch (err) {
      console.error("employee attendance page", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    void loadMonth(employeeId, monthOffset);
  }, [employeeId, monthOffset, loadMonth]);

  const filtered = useMemo(() => {
    if (filter === "present") {
      return rows.filter(
        (r) =>
          r.status === "On Time" ||
          r.status === "Tardy" ||
          r.status === "1st-Half Day" ||
          r.status === "2nd-Half Day"
      );
    }
    return rows.filter((r) => r.status === "Absent");
  }, [rows, filter]);

  const absentCount = rows.filter((r) => r.status === "Absent").length;
  const presentCount = rows.filter(
    (r) =>
      r.status === "On Time" ||
      r.status === "Tardy" ||
      r.status === "1st-Half Day" ||
      r.status === "2nd-Half Day"
  ).length;

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Link href="/employee-dashboard" className={styles.backLink}>
              <FaArrowLeft aria-hidden /> Dashboard
            </Link>
            <h1 className={styles.title}>My Monthly Attendance</h1>
          </div>
          <div className={styles.monthNav}>
            <button
              type="button"
              className={styles.monthBtn}
              onClick={() => setMonthOffset((o) => o - 1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className={styles.monthLabel}>{monthLabel || "…"}</span>
            <button
              type="button"
              className={styles.monthBtn}
              onClick={() => setMonthOffset((o) => Math.min(0, o + 1))}
              disabled={monthOffset >= 0}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        <div className={styles.summaryRow}>
          <div className={styles.summaryChip}>
            <span className={`${styles.dot} ${styles.dotBlue}`} />
            {presentCount} Present
          </div>
          <div className={`${styles.summaryChip} ${styles.summaryAbsent}`}>
            <span className={`${styles.dot} ${styles.dotRed}`} />
            {absentCount} Absent
          </div>
        </div>

        <div className={styles.tabs} role="tablist">
          {(
            [
              ["absent", "Absent"],
              ["present", "Present"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`${styles.tab}${filter === id ? ` ${styles.tabActive}` : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.tableCard}>
          {loading ? (
            <div className={styles.empty}>Loading attendance…</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              {filter === "absent"
                ? "No absent days in this month."
                : "No rows to show for this filter."}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Date</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.dateKey}
                      className={row.status === "Absent" ? styles.rowAbsent : undefined}
                    >
                      <td>{row.weekday}</td>
                      <td>{row.dateDisplay}</td>
                      <td>{row.clockIn}</td>
                      <td>{row.clockOut}</td>
                      <td style={{ color: uiStatusTextColor(row.status), fontWeight: 700 }}>
                        {row.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EmployeeAttendancePage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <div className={styles.inner}>
            <div className={styles.empty}>Loading…</div>
          </div>
        </div>
      }
    >
      <AttendancePageInner />
    </Suspense>
  );
}
