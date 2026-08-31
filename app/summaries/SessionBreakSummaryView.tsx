"use client";

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styles from "../break-summary/break-summary.module.css";
import { EmployeeTableNameCell } from "../components/EmployeeTableNameCell";
import {
  EmployeeDetailPopup,
  type EmployeeDetailPayload,
} from "../components/EmployeeDetailPopup";
import { buildEmployeeDetailPayload } from "@/lib/employee-detail-from-row";
import { useEmployeePhotoMap } from "../components/use-employee-photo-map";
import { FaFileExcel } from "react-icons/fa";
import { getDateStringInTimeZone, getTimeStringInTimeZone, SERVER_TIMEZONE } from "../../lib/timezone";
import { toastError, toastSuccess } from "@/lib/app-toast";
import type { SessionBreakConfig } from "@/lib/session-break-config";

function getLocalDateString(date: Date = new Date()) {
  return getDateStringInTimeZone(date, SERVER_TIMEZONE);
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}h ${m}m ${s}s`;
}

function getSessionGroupingKey(record: any, startField: string) {
  const employeeKey = (record.employee_id ?? record.employeeId ?? "").toString();
  const attendanceSessionId = record.attendance_session_id ?? record.attendanceSessionId;
  if (attendanceSessionId !== undefined && attendanceSessionId !== null && attendanceSessionId !== "") {
    return `${employeeKey}|attendance:${attendanceSessionId}`;
  }
  return `${employeeKey}|fallback:${record.id ?? record[startField] ?? "unknown"}`;
}

export default function SessionBreakSummaryView({ config }: { config: SessionBreakConfig }) {
  const startField = config.startField;
  const endField = config.endField;
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [department, setDepartment] = useState("");
  const today = getLocalDateString();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [rows, setRows] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const importInputRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<EmployeeDetailPayload | null>(null);
  const { getPhoto } = useEmployeePhotoMap();

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setDepartments(data.departments || []);
      })
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    const effectiveFrom = fromDate || toDate || today;
    const effectiveTo = toDate || fromDate || today;
    const params = new URLSearchParams({ fromDate: effectiveFrom, toDate: effectiveTo });
    setLoading(true);
    fetch(`${config.apiPath}?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setRows(data[config.responseKey] || []);
        else setRows([]);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, today, config]);

  useEffect(() => {
    const hasRunning = rows.some((p) => p[startField] && !p[endField]);
    if (!hasRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [rows, startField, endField]);

  const filteredRows = useMemo(() => {
    return rows.filter((p) => {
      const term = deferredSearch.trim().toLowerCase();
      if (term) {
        const employeeName = (p.employee_name || "").toLowerCase();
        const pseudonym = (p.pseudonym || "").toLowerCase();
        const id = String(p.employee_id || "");
        if (!employeeName.includes(term) && !pseudonym.includes(term) && !id.includes(term)) {
          return false;
        }
      }
      if (department && p.department_name !== department) return false;
      return true;
    });
  }, [rows, deferredSearch, department]);

  const staticTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filteredRows) {
      if (!p[startField] || !p[endField]) continue;
      const start = new Date(p[startField]).getTime();
      const end = new Date(p[endField]).getTime();
      const seconds = Math.floor((end - start) / 1000);
      const key = getSessionGroupingKey(p, startField);
      map.set(key, (map.get(key) || 0) + Math.max(0, seconds));
    }
    return map;
  }, [filteredRows, startField, endField]);

  const tableRows = useMemo(() => {
    const liveTotals = new Map(staticTotals);
    for (const p of filteredRows) {
      if (!p[startField] || p[endField]) continue;
      const start = new Date(p[startField]).getTime();
      const seconds = Math.floor((now - start) / 1000);
      const key = getSessionGroupingKey(p, startField);
      liveTotals.set(key, (liveTotals.get(key) || 0) + Math.max(0, seconds));
    }

    return filteredRows
      .map((p) => {
        const isRunning = p[startField] && !p[endField];
        const start = p[startField] ? new Date(p[startField]).getTime() : 0;
        const end = p[endField] ? new Date(p[endField]).getTime() : now;
        const sessionSeconds = p[startField] ? Math.floor((end - start) / 1000) : 0;
        const key = getSessionGroupingKey(p, startField);
        const dailySeconds = liveTotals.get(key) || sessionSeconds;
        return {
          ...p,
          date_display: p.session_clock_in
            ? getDateStringInTimeZone(p.session_clock_in, SERVER_TIMEZONE)
            : p.date
            ? getDateStringInTimeZone(p.date, SERVER_TIMEZONE)
            : p[startField]
            ? getDateStringInTimeZone(p[startField], SERVER_TIMEZONE)
            : "",
          start_display: p[startField] ? getTimeStringInTimeZone(p[startField], SERVER_TIMEZONE) : "",
          end_display: p[endField] ? getTimeStringInTimeZone(p[endField], SERVER_TIMEZONE) : isRunning ? "Running..." : "",
          total_time: formatDuration(sessionSeconds),
          total_time_today: formatDuration(dailySeconds),
        };
      })
      .sort((a, b) => {
        const aRunning = !!(a[startField] && !a[endField]);
        const bRunning = !!(b[startField] && !b[endField]);
        if (aRunning !== bRunning) return aRunning ? -1 : 1;
        return new Date(b[startField] || 0).getTime() - new Date(a[startField] || 0).getTime();
      });
  }, [filteredRows, staticTotals, now, startField, endField]);

  const downloadCSV = () => {
    const headers = [
      "Id",
      "Full Name",
      "P.Name",
      "Department",
      "Date",
      `${config.label} Start`,
      `${config.label} End`,
      `Total ${config.label} Time`,
      `Total ${config.label}`,
    ];
    let csv = headers.join(",") + "\n";
    tableRows.forEach((row) => {
      csv +=
        [
          row.employee_id,
          row.employee_name || "",
          row.pseudonym || "-",
          row.department_name || "-",
          row.date_display,
          row.start_display,
          row.end_display,
          row.total_time,
          row.total_time_today,
        ]
          .map((v) => `"${v}"`)
          .join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.kind}_break_summary.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const openEmployeeDetail = (row: any) => {
    void buildEmployeeDetailPayload(row, getPhoto).then(setDetail);
  };

  return (
    <>
      <div className={styles.breakSummaryContainer}>
        <h1 className={styles.pageTitle}>{config.label} Summary</h1>
        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name or pseudo name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 180 }}
          />
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={styles.breakSummaryDate}
            style={{ width: 180 }}
          >
            <option value="">All Departments</option>
            {departments.map((dept: any) => (
              <option key={dept.id} value={dept.name}>
                {dept.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={styles.breakSummaryDate}
            placeholder="From Date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={styles.breakSummaryDate}
            placeholder="To Date"
          />
          <button onClick={downloadCSV} className={styles.breakSummaryXLSButton} title="Download XLS">
            <FaFileExcel size={20} />
            <span>Export XLS</span>
          </button>
        </div>

        <div className={styles.breakSummaryTableWrapper}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", fontSize: "16px", color: "#718096" }}>
              Loading...
            </div>
          ) : (
            <table className={styles.breakSummaryTable}>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Full Name</th>
                  <th>P.Name</th>
                  <th>Department</th>
                  <th>Date</th>
                  <th>{config.label} Start</th>
                  <th>{config.label} End</th>
                  <th>Total {config.label} Time</th>
                  <th>Total {config.label}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.breakSummaryNoRecords}>
                      No records found.
                    </td>
                  </tr>
                ) : (
                  tableRows.map((p, idx) => (
                    <tr key={p.id || idx}>
                      <td className={styles.cellMuted}>{p.employee_id}</td>
                      <td className={styles.nameCol}>
                        <EmployeeTableNameCell
                          key={`${p.employee_id}-${getPhoto(p.employee_id) ?? "none"}`}
                          name={p.employee_name || ""}
                          employeeId={p.employee_id}
                          photo={getPhoto(p.employee_id)}
                          onOpen={() => openEmployeeDetail(p)}
                        />
                      </td>
                      <td>{p.pseudonym || "-"}</td>
                      <td>{p.department_name || "-"}</td>
                      <td>{p.date_display}</td>
                      <td>{p.start_display}</td>
                      <td>
                        {p[startField] && !p[endField] ? (
                          <span className={styles.badgeRunning}>Running</span>
                        ) : (
                          p.end_display
                        )}
                      </td>
                      <td>{p.total_time}</td>
                      <td>{p.total_time_today}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {detail ? <EmployeeDetailPopup data={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}
