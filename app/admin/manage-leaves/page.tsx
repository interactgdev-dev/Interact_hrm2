"use client";

import React, { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "./manage-leaves.module.css";
import leaveStyles from "../../leave/leave.module.css";
import adminStyles from "../admin-page.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { ModalPortal } from "@/app/components/ModalPortal";
import { toastError, toastSuccess } from "@/lib/app-toast";
import LeaveRequestsPanel from "./LeaveRequestsPanel";
import LeaveSummaryPanel from "./LeaveSummaryPanel";
import { normalizeEmployeeGender } from "@/lib/leave-categories";
import {
  fetchAccessControlMe,
  invalidateAccessControlMeCache,
} from "@/lib/access-control/me-client-cache";
import { permissionSetHas } from "@/lib/access-control/permission-scope";
import { isAdminBrowserSession } from "@/lib/access-control/employee-shell";

type LeaveDashTab = "balances" | "requests" | "summary";

const MANAGE_LEAVES_TAB_KEY = "manage-leaves-tab";

function tabFromParam(raw: string | null): LeaveDashTab | null {
  if (raw === "balances" || raw === "requests" || raw === "summary") return raw;
  return null;
}

function persistLeaveTab(tab: LeaveDashTab) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    sessionStorage.setItem(MANAGE_LEAVES_TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

function readPersistedLeaveTab(): LeaveDashTab | null {
  try {
    const fromUrl = tabFromParam(
      new URLSearchParams(window.location.search).get("tab"),
    );
    if (fromUrl) return fromUrl;
    return tabFromParam(sessionStorage.getItem(MANAGE_LEAVES_TAB_KEY));
  } catch {
    return null;
  }
}

interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  employee_code: string;
  employment_status: string;
  gender?: string | null;
  annual_allowance: number;
  bereavement_allowance: number;
  maternity_allowance?: number;
  paternity_allowance?: number;
  annual_used: number;
  bereavement_used: number;
  maternity_used?: number;
  paternity_used?: number;
  annual_current_balance: number;
  bereavement_current_balance: number;
  maternity_current_balance?: number;
  paternity_current_balance?: number;
  annual_balance_adjustment: number;
  bereavement_balance_adjustment: number;
  department_name?: string;
  pseudonym?: string;
}

function isLeaveDaysInput(value: string): boolean {
  return value === "" || /^\d*\.?\d{0,2}$/.test(value);
}

function parseLeaveDays(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 2) / 2;
}

function formatLeaveDays(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatLeaveDelta(next: number, current: number): string {
  const delta = Math.round((next - current) * 2) / 2;
  if (delta === 0) return "";
  const abs = formatLeaveDays(Math.abs(delta));
  return delta > 0 ? `+${abs} leaves added` : `-${abs} leaves removed`;
}

export default function ManageLeavesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading leaves…</div>}>
      <ManageLeavesPageInner />
    </Suspense>
  );
}

function ManageLeavesPageInner() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    annual_current_balance: "20",
    bereavement_current_balance: "3",
    maternity_current_balance: "90",
    paternity_current_balance: "5",
  });
  const [saving, setSaving] = useState(false);
  const [searchName, setSearchName] = useState("");
  const deferredSearchName = useDeferredValue(searchName);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [employmentStatusFilter, setEmploymentStatusFilter] = useState("");
  const [lowBalanceOnly, setLowBalanceOnly] = useState(false);
  /** Top month filter (parallel to tabs) — drives activity date range */
  const [globalMonth, setGlobalMonth] = useState("");
  /** From–To date range filters employees with leave activity in range */
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [monthActiveIds, setMonthActiveIds] = useState<Set<string> | null>(null);

  const applyGlobalMonth = (monthKey: string) => {
    setGlobalMonth(monthKey);
    if (!monthKey) return;
    const [year, monthNum] = monthKey.split("-");
    const lastDay = new Date(Number(year), Number(monthNum), 0).getDate();
    setFromDate(`${monthKey}-01`);
    setToDate(`${monthKey}-${String(lastDay).padStart(2, "0")}`);
  };
  const [departments, setDepartments] = useState<{ id: number | string; name?: string; department_name?: string }[]>([]);
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<LeaveDashTab>("requests");
  /** HR Admin / HR Manager only — leave.balances.edit */
  const [canEditBalances, setCanEditBalances] = useState(false);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    let cancelled = false;
    const resolveCanEdit = async () => {
      try {
        // Classic admin login — full leave balance edit.
        if (isAdminBrowserSession()) {
          if (!cancelled) setCanEditBalances(true);
          return;
        }
        const eid = String(localStorage.getItem("employeeId") || "").trim();
        if (!eid) {
          if (!cancelled) setCanEditBalances(false);
          return;
        }
        invalidateAccessControlMeCache(eid);
        const data = await fetchAccessControlMe(eid);
        if (cancelled) return;
        const perms = Array.isArray(data?.permissions)
          ? (data.permissions as string[])
          : [];
        if (permissionSetHas(perms, "leave.balances.edit")) {
          setCanEditBalances(true);
          return;
        }
        // Fallback: HR dept + Manager/Team Lead/Admin role slug (API merge may lag cache).
        const dept = String(
          (data as { departmentName?: string })?.departmentName || "",
        ).toLowerCase();
        const isHr =
          dept.includes("hr") ||
          dept.includes("human resource") ||
          dept === "recruit";
        const slug = String(
          (data as { role?: { slug?: string; slugs?: string[] } })?.role?.slug ||
            "",
        ).toLowerCase();
        const slugs = (
          (data as { role?: { slugs?: string[] } })?.role?.slugs || []
        ).map((s) => String(s || "").toLowerCase());
        const legacy = String(
          (data as { legacyRole?: string })?.legacyRole || "",
        ).toLowerCase();
        const adminish =
          slug.includes("hr_manager") ||
          slug.includes("dir_hr") ||
          slug.includes("admin") ||
          slugs.some(
            (s) =>
              s.includes("hr_manager") ||
              s.includes("dir_hr") ||
              s.includes("admin"),
          ) ||
          legacy === "manager" ||
          legacy === "team lead" ||
          legacy === "ceo";
        setCanEditBalances(Boolean(isHr && adminish));
      } catch {
        if (!cancelled) setCanEditBalances(false);
      }
    };
    void resolveCanEdit();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectTab = (tab: LeaveDashTab) => {
    setActiveTab(tab);
    persistLeaveTab(tab);
  };

  useEffect(() => {
    const fromUrl = tabFromParam(searchParams?.get("tab") ?? null);
    if (fromUrl) {
      setActiveTab(fromUrl);
      try {
        sessionStorage.setItem(MANAGE_LEAVES_TAB_KEY, fromUrl);
      } catch {
        /* ignore */
      }
      return;
    }
    const next = readPersistedLeaveTab() || "requests";
    setActiveTab(next);
    persistLeaveTab(next);
  }, [searchParams]);

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.departments)) {
          setDepartments(data.departments);
        }
      })
      .catch((err) => console.error("Error fetching departments:", err));
  }, []);

  useEffect(() => {
    if (!fromDate && !toDate) {
      setMonthActiveIds(null);
      return;
    }
    let cancelled = false;
    const rangeFrom = fromDate || toDate;
    const rangeTo = toDate || fromDate;
    void (async () => {
      try {
        const viewerId = String(localStorage.getItem("employeeId") || "").trim();
        const viewerQs = viewerId ? `&viewerId=${encodeURIComponent(viewerId)}` : "";
        const res = await fetch(
          `/api/leaves?fromDate=${encodeURIComponent(rangeFrom)}&toDate=${encodeURIComponent(rangeTo)}&ts=${Date.now()}${viewerQs}`,
          {
            cache: "no-store",
            headers: viewerId
              ? { "x-employee-id": viewerId, "x-hrm-employee-id": viewerId }
              : {},
          },
        );
        const data = await res.json();
        if (cancelled) return;
        const ids = new Set<string>();
        for (const l of data?.leaves || []) {
          const start = String(l?.start_date || "").slice(0, 10);
          const end = String(l?.end_date || l?.start_date || "").slice(0, 10);
          if (!start) continue;
          if (fromDate && (end || start) < fromDate) continue;
          if (toDate && start > toDate) continue;
          const id = String(l?.employee_id ?? "").trim();
          if (id) ids.add(id);
        }
        setMonthActiveIds(ids);
      } catch {
        if (!cancelled) setMonthActiveIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

  async function fetchEmployees() {
    try {
      setLoading(true);
      const viewerId =
        typeof window !== "undefined"
          ? String(localStorage.getItem("employeeId") || "").trim()
          : "";
      const viewerQs = viewerId ? `&viewerId=${encodeURIComponent(viewerId)}` : "";
      const viewerHeaders: HeadersInit = viewerId
        ? { "x-employee-id": viewerId, "x-hrm-employee-id": viewerId }
        : {};
      const res = await fetch(
        `/api/employee-leave-allowances?ts=${Date.now()}${viewerQs}`,
        { cache: "no-store", headers: viewerHeaders },
      );
      const data = await res.json();
      if (data.success) {
        const empDetailsMap = new Map<
          number,
          { pseudonym: string; department_name: string }
        >();

        try {
          const listRes = await fetch(
            `/api/employee-list?ts=${Date.now()}${viewerQs}`,
            { cache: "no-store", headers: viewerHeaders },
          );
          const listData = await listRes.json();
          const list = Array.isArray(listData?.employees)
            ? listData.employees
            : Array.isArray(listData)
              ? listData
              : [];
          for (const row of list) {
            const empId = Number(row.id);
            if (!Number.isFinite(empId) || empDetailsMap.has(empId)) continue;
            empDetailsMap.set(empId, {
              pseudonym: row.pseudonym || "-",
              department_name: row.department_name || "-",
            });
          }
        } catch (err) {
          console.error("Error fetching employee list:", err);
        }

        const enrichedEmployees = data.employees.map((emp: Employee) => ({
          ...emp,
          department_name:
            emp.department_name ||
            empDetailsMap.get(emp.id)?.department_name ||
            "-",
          pseudonym: empDetailsMap.get(emp.id)?.pseudonym || "-",
        }));
        setEmployees(enrichedEmployees);
      } else {
        toastError("Failed to fetch employees: " + data.error);
      }
    } catch (error) {
      toastError("Error fetching employees: " + String(error));
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(employee: Employee) {
    if (!canEditBalances) return;
    setEditingEmployee(employee);
    setFormData({
      annual_current_balance: formatLeaveDays(employee.annual_current_balance),
      bereavement_current_balance: formatLeaveDays(employee.bereavement_current_balance),
      maternity_current_balance: formatLeaveDays(
        employee.maternity_current_balance ?? employee.maternity_allowance ?? 90,
      ),
      paternity_current_balance: formatLeaveDays(
        employee.paternity_current_balance ?? employee.paternity_allowance ?? 5,
      ),
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!editingEmployee) return;

    try {
      setSaving(true);
      const viewerId = String(localStorage.getItem("employeeId") || "").trim();
      const portal =
        localStorage.getItem("hrmPortal") ||
        sessionStorage.getItem("hrmPortal") ||
        "";
      const res = await fetch("/api/employee-leave-allowances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(viewerId
            ? { "x-employee-id": viewerId, "x-hrm-employee-id": viewerId }
            : {}),
          ...(portal === "admin" ? { "x-hrm-portal": "admin" } : {}),
        },
        body: JSON.stringify({
          employee_id: editingEmployee.id,
          viewerId: viewerId || undefined,
          portal: portal || undefined,
          annual_current_balance: parseLeaveDays(formData.annual_current_balance),
          bereavement_current_balance: parseLeaveDays(formData.bereavement_current_balance),
          maternity_current_balance: parseLeaveDays(formData.maternity_current_balance),
          paternity_current_balance: parseLeaveDays(formData.paternity_current_balance),
        })
      });

      const data = await res.json();
      if (data.success) {
        toastSuccess("Leave balance updated successfully!");
        setShowModal(false);
        setEditingEmployee(null);
        fetchEmployees();
      } else {
        toastError("Failed to update: " + data.error);
      }
    } catch (error) {
      toastError("Error updating: " + String(error));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setShowModal(false);
    setEditingEmployee(null);
  }

  const getFullName = (employee: Employee) => {
    return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
  };

  const employmentStatusKey = (emp: Employee) => {
    const s = String(emp.employment_status || "").toLowerCase();
    if (s.includes("probation")) return "Probation";
    return "Confirmed";
  };

  /**
   * Show Annual + Bereavement + Mat/Pat bars.
   * Available / Total = Annual only (do not sum other categories).
   */
  const balanceFor = (emp: Employee) => {
    const annualAllow = Number(emp.annual_allowance) || 20;
    const annualCurrent = Number.isFinite(Number(emp.annual_current_balance))
      ? Number(emp.annual_current_balance)
      : annualAllow;
    // Used = allowance − remaining (includes approved leaves + HR balance edits).
    // Never trust stale ticket-only annual_used=0 after a manual balance update.
    const annualUsed = Math.round(Math.max(0, annualAllow - annualCurrent) * 2) / 2;
    const berAllow = Number(emp.bereavement_allowance) || 3;
    const berCurrent = Number.isFinite(Number(emp.bereavement_current_balance))
      ? Number(emp.bereavement_current_balance)
      : berAllow;
    const berUsed = Math.round(Math.max(0, berAllow - berCurrent) * 2) / 2;
    const gender = normalizeEmployeeGender(emp.gender);
    const matAllow = Number(emp.maternity_allowance) || 90;
    const matCurrent = Number.isFinite(Number(emp.maternity_current_balance))
      ? Number(emp.maternity_current_balance)
      : matAllow;
    const matUsed = Math.round(Math.max(0, matAllow - matCurrent) * 2) / 2;
    const patAllow = Number(emp.paternity_allowance) || 5;
    const patCurrent = Number.isFinite(Number(emp.paternity_current_balance))
      ? Number(emp.paternity_current_balance)
      : patAllow;
    const patUsed = Math.round(Math.max(0, patAllow - patCurrent) * 2) / 2;
    const available = Math.round(Math.max(0, annualCurrent) * 2) / 2;
    const annualPct =
      annualAllow > 0
        ? Math.min(100, (Math.max(0, annualAllow - annualCurrent) / annualAllow) * 100)
        : 0;
    const berPct =
      berAllow > 0
        ? Math.min(100, (Math.max(0, berAllow - berCurrent) / berAllow) * 100)
        : 0;
    const matPct =
      matAllow > 0
        ? Math.min(100, (Math.max(0, matAllow - matCurrent) / matAllow) * 100)
        : 0;
    const patPct =
      patAllow > 0
        ? Math.min(100, (Math.max(0, patAllow - patCurrent) / patAllow) * 100)
        : 0;
    return {
      annualAllow,
      annualCurrent,
      annualUsed,
      berAllow,
      berCurrent,
      berUsed,
      gender,
      matAllow,
      matCurrent,
      matUsed,
      patAllow,
      patCurrent,
      patUsed,
      available,
      annualPct,
      berPct,
      matPct,
      patPct,
    };
  };

  const filteredEmployees = useMemo(() => {
    let rows = employees;
    const term = deferredSearchName.trim().toLowerCase();
    if (term) {
      rows = rows.filter((emp) => {
        const fullName = getFullName(emp).toLowerCase();
        const pseudo = (emp.pseudonym || "").toLowerCase();
        const id = String(emp.id || "");
        return fullName.includes(term) || pseudo.includes(term) || id.includes(term);
      });
    }
    if (selectedDepartment) {
      rows = rows.filter(
        (emp) =>
          (emp.department_name || "").toLowerCase() === selectedDepartment.toLowerCase()
      );
    }
    if (employmentStatusFilter) {
      rows = rows.filter((emp) => employmentStatusKey(emp) === employmentStatusFilter);
    }
    if (lowBalanceOnly) {
      rows = rows.filter((emp) => balanceFor(emp).available < 4);
    }
    if (monthActiveIds) {
      rows = rows.filter((emp) => monthActiveIds.has(String(emp.id)));
    }
    return rows;
  }, [
    employees,
    deferredSearchName,
    selectedDepartment,
    employmentStatusFilter,
    lowBalanceOnly,
    monthActiveIds,
  ]);

  return (
    <OptionalAdminShell>
      <div className={`${adminStyles.page} ${styles.pageWhite}`}>
        <div className={`${adminStyles.inner} ${styles.pageWide}`}>
          <h1 className={adminStyles.title}>Leaves</h1>
          <p className={adminStyles.subtitle}>
            Requests, balances, and monthly summary — one place (scoped to your hierarchy).
          </p>

          <div className={styles.dashTabsRow}>
            <div className={styles.dashTabs} role="tablist" aria-label="Leave sections">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "requests"}
                className={`${styles.dashTab}${activeTab === "requests" ? ` ${styles.dashTabActive}` : ""}`}
                onClick={() => selectTab("requests")}
              >
                Requests
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "balances"}
                className={`${styles.dashTab}${activeTab === "balances" ? ` ${styles.dashTabActive}` : ""}`}
                onClick={() => selectTab("balances")}
              >
                Balances
                <span className={styles.dashTabCount}>{employees.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "summary"}
                className={`${styles.dashTab}${activeTab === "summary" ? ` ${styles.dashTabActive}` : ""}`}
                onClick={() => selectTab("summary")}
              >
                Summary
              </button>
            </div>
            <div className={styles.dashMonthFilter}>
              <label htmlFor="leaves-global-month">Month</label>
              <input
                id="leaves-global-month"
                type="month"
                className={styles.dashMonthInput}
                value={globalMonth}
                onChange={(e) => applyGlobalMonth(e.target.value)}
                aria-label="Filter by month"
              />
            </div>
          </div>

          {activeTab === "requests" ? (
            <LeaveRequestsPanel externalMonth={globalMonth} />
          ) : null}
          {activeTab === "summary" ? (
            <LeaveSummaryPanel externalMonth={globalMonth} />
          ) : null}

          {activeTab === "balances" ? (
            <>
              <p className={leaveStyles.subtitle} style={{ marginTop: 0 }}>
                Annual, bereavement, and maternity/paternity balances. Available total
                counts Annual only.
              </p>
              <div className={leaveStyles.toolbar}>
                <div className={leaveStyles.searchWrap}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="search"
                    className={leaveStyles.toolbarSearch}
                    placeholder="Search by name, pseudo name, or ID"
                    value={searchName}
                    onChange={(e) => setSearchName(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className={leaveStyles.filterField}>
                  <label htmlFor="bal-filter-dept">Department</label>
                  <select
                    id="bal-filter-dept"
                    className={leaveStyles.toolbarSelect}
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    aria-label="Filter by department"
                  >
                    <option value="">All departments</option>
                    {departments.map((dept) => {
                      const name = dept.name || dept.department_name || "";
                      return (
                        <option key={dept.id} value={name}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className={leaveStyles.filterField}>
                  <label htmlFor="bal-filter-from">From date</label>
                  <input
                    id="bal-filter-from"
                    type="date"
                    className={leaveStyles.toolbarSelect}
                    value={fromDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFromDate(v);
                      if (v && toDate && toDate < v) setToDate(v);
                    }}
                    aria-label="From date"
                  />
                </div>
                <div className={leaveStyles.filterField}>
                  <label htmlFor="bal-filter-to">To date</label>
                  <input
                    id="bal-filter-to"
                    type="date"
                    className={leaveStyles.toolbarSelect}
                    value={toDate}
                    min={fromDate || undefined}
                    onChange={(e) => setToDate(e.target.value)}
                    aria-label="To date"
                  />
                </div>
                <select
                  className={leaveStyles.toolbarSelect}
                  value={employmentStatusFilter}
                  onChange={(e) => setEmploymentStatusFilter(e.target.value)}
                  aria-label="Filter by employment status"
                >
                  <option value="">All statuses</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Probation">Probation</option>
                </select>
                <label
                  className={`${leaveStyles.toggleChip}${lowBalanceOnly ? ` ${leaveStyles.toggleChipOn}` : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={lowBalanceOnly}
                    onChange={(e) => setLowBalanceOnly(e.target.checked)}
                  />
                  Low balance only (&lt; 4 days)
                </label>
                {fromDate || toDate ? (
                  <button
                    type="button"
                    className={leaveStyles.clearFilters}
                    onClick={() => {
                      setFromDate("");
                      setToDate("");
                    }}
                  >
                    Clear dates
                  </button>
                ) : null}
              </div>

              <div className={leaveStyles.reqTableShell}>
                <div className={leaveStyles.reqTableScroll}>
                  {loading ? (
                    <p className={leaveStyles.loading}>Loading employees…</p>
                  ) : (
                    <table className={`${leaveStyles.reqTable} ${leaveStyles.balTable}`}>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Employee</th>
                          <th>Department</th>
                          <th>Status</th>
                          <th>Annual</th>
                          <th>Bereavement</th>
                          <th>Maternity / Paternity</th>
                          <th>Available</th>
                          {canEditBalances ? <th>Action</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEmployees.length === 0 ? (
                          <tr>
                            <td
                              colSpan={8 + (canEditBalances ? 1 : 0)}
                              className={leaveStyles.reqEmpty}
                            >
                              No employees match these filters.
                            </td>
                          </tr>
                        ) : (
                          filteredEmployees.map((emp) => {
                            const statusKey = employmentStatusKey(emp);
                            const bal = balanceFor(emp);
                            const availClass =
                              bal.available < 2
                                ? styles.availLow
                                : bal.available < 5
                                  ? styles.availMid
                                  : "";
                            const showMat = bal.gender === "female";
                            const showPat = bal.gender === "male";
                            return (
                              <tr key={emp.id}>
                                <td className={leaveStyles.reqId}>{emp.id}</td>
                                <td>
                                  <div className={leaveStyles.personCell}>
                                    <EmployeeTableNameCell
                                      name={getFullName(emp)}
                                      employeeId={emp.id}
                                      photo={getPhoto(emp.id)}
                                      onOpen={() =>
                                        openFromRow({
                                          employee_id: emp.id,
                                          first_name: emp.first_name,
                                          last_name: emp.last_name,
                                          pseudonym: emp.pseudonym,
                                          department_name: emp.department_name,
                                        })
                                      }
                                    />
                                    {emp.pseudonym && emp.pseudonym !== "-" ? (
                                      <div className={leaveStyles.pseudoLine}>{emp.pseudonym}</div>
                                    ) : null}
                                  </div>
                                </td>
                                <td className={leaveStyles.sumDeptCell} title={emp.department_name || ""}>
                                  {emp.department_name || "—"}
                                </td>
                                <td>
                                  <span
                                    className={`${leaveStyles.badge} ${
                                      statusKey === "Confirmed"
                                        ? styles.badgeConfirmed
                                        : styles.badgeProbation
                                    }`}
                                  >
                                    {statusKey}
                                  </span>
                                </td>
                                <td>
                                  <div className={styles.equity}>
                                    <div className={styles.equityBar}>
                                      <div
                                        className={styles.segAnnual}
                                        style={{ width: `${bal.annualPct}%` }}
                                      />
                                    </div>
                                    <div className={styles.equityLabel}>
                                      <span>
                                        {formatLeaveDays(bal.annualCurrent)} /{" "}
                                        {formatLeaveDays(bal.annualAllow)}
                                      </span>
                                      <b>
                                        {formatLeaveDays(bal.annualUsed)} used
                                      </b>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <div className={styles.equity}>
                                    <div className={styles.equityBar}>
                                      <div
                                        className={styles.segBer}
                                        style={{ width: `${bal.berPct}%` }}
                                      />
                                    </div>
                                    <div className={styles.equityLabel}>
                                      <span>
                                        {formatLeaveDays(bal.berCurrent)} /{" "}
                                        {formatLeaveDays(bal.berAllow)}
                                      </span>
                                      <b>
                                        {formatLeaveDays(bal.berUsed)} used
                                      </b>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  {showMat || showPat ? (
                                    <div className={styles.equity}>
                                      <div className={styles.equityBar}>
                                        <div
                                          className={styles.segAnnual}
                                          style={{
                                            width: `${showMat ? bal.matPct : bal.patPct}%`,
                                            opacity: 0.55,
                                          }}
                                        />
                                      </div>
                                      <div className={styles.equityLabel}>
                                        <span>
                                          {showMat ? "Mat " : "Pat "}
                                          {formatLeaveDays(
                                            showMat ? bal.matCurrent : bal.patCurrent,
                                          )}{" "}
                                          /{" "}
                                          {formatLeaveDays(
                                            showMat ? bal.matAllow : bal.patAllow,
                                          )}
                                        </span>
                                        <b>
                                          {formatLeaveDays(
                                            showMat ? bal.matUsed : bal.patUsed,
                                          )}{" "}
                                          used
                                        </b>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className={leaveStyles.actionStamp}>—</span>
                                  )}
                                </td>
                                <td>
                                  <span className={`${styles.availableCell} ${availClass}`}>
                                    {formatLeaveDays(bal.available)}d
                                  </span>
                                </td>
                                {canEditBalances ? (
                                  <td>
                                    <button
                                      type="button"
                                      className={styles.editBtn}
                                      onClick={() => handleEdit(emp)}
                                    >
                                      Edit
                                    </button>
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          ) : null}

        {/* Edit Modal — HR Admin only */}
        {showModal && editingEmployee && canEditBalances ? (
          <ModalPortal>
          <div className={styles.modalOverlay} data-hrm-modal-overlay>
            <div className={styles.modal}>
              <h2 className={styles.modalTitle}>
                Update Leave Allowance
              </h2>
              <p className={styles.modalSubtitle}>
                {editingEmployee.first_name} {editingEmployee.last_name} ({editingEmployee.employment_status || "Permanent"})
              </p>

              <p className={styles.infoText}>
                Total Allowance: <strong>{editingEmployee.annual_allowance}</strong> Annual,{" "}
                <strong>{editingEmployee.bereavement_allowance}</strong> Bereavement
                {normalizeEmployeeGender(editingEmployee.gender) === "female" ? (
                  <>
                    , <strong>{editingEmployee.maternity_allowance ?? 90}</strong> Maternity
                  </>
                ) : null}
                {normalizeEmployeeGender(editingEmployee.gender) === "male" ? (
                  <>
                    , <strong>{editingEmployee.paternity_allowance ?? 5}</strong> Paternity
                  </>
                ) : null}{" "}
                (Fixed)
              </p>

              <div className={styles.currentBalances}>
                <div className={styles.balanceCard}>
                  <div className={styles.balanceLabel}>Current Annual Leave</div>
                  <div className={styles.balanceValue}>
                    <span className={styles.remaining}>{formatLeaveDays(editingEmployee.annual_current_balance)}</span>
                    <span className={styles.separator}>/</span>
                    <span className={styles.total}>{formatLeaveDays(editingEmployee.annual_allowance)}</span>
                  </div>
                </div>
                
                <div className={styles.balanceCard}>
                  <div className={styles.balanceLabel}>Current Bereavement Leave</div>
                  <div className={styles.balanceValue}>
                    <span className={styles.remaining}>{formatLeaveDays(editingEmployee.bereavement_current_balance)}</span>
                    <span className={styles.separator}>/</span>
                    <span className={styles.total}>{formatLeaveDays(editingEmployee.bereavement_allowance)}</span>
                  </div>
                </div>

                {normalizeEmployeeGender(editingEmployee.gender) === "female" ? (
                  <div className={styles.balanceCard}>
                    <div className={styles.balanceLabel}>Current Maternity Leave</div>
                    <div className={styles.balanceValue}>
                      <span className={styles.remaining}>
                        {formatLeaveDays(
                          editingEmployee.maternity_current_balance ??
                            editingEmployee.maternity_allowance ??
                            90,
                        )}
                      </span>
                      <span className={styles.separator}>/</span>
                      <span className={styles.total}>
                        {formatLeaveDays(editingEmployee.maternity_allowance ?? 90)}
                      </span>
                    </div>
                  </div>
                ) : null}

                {normalizeEmployeeGender(editingEmployee.gender) === "male" ? (
                  <div className={styles.balanceCard}>
                    <div className={styles.balanceLabel}>Current Paternity Leave</div>
                    <div className={styles.balanceValue}>
                      <span className={styles.remaining}>
                        {formatLeaveDays(
                          editingEmployee.paternity_current_balance ??
                            editingEmployee.paternity_allowance ??
                            5,
                        )}
                      </span>
                      <span className={styles.separator}>/</span>
                      <span className={styles.total}>
                        {formatLeaveDays(editingEmployee.paternity_allowance ?? 5)}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={styles.formGroup}>
                <label>Update Annual Current Balance</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.annual_current_balance}
                  onChange={(e) => {
                    const raw = e.target.value.replace(",", ".");
                    if (!isLeaveDaysInput(raw)) return;
                    setFormData({ ...formData, annual_current_balance: raw });
                  }}
                  className={styles.input}
                />
                <div className={styles.helpText}>
                  {formatLeaveDelta(
                    parseLeaveDays(formData.annual_current_balance),
                    editingEmployee.annual_current_balance
                  ) ? (
                    <span
                      style={{
                        color:
                          parseLeaveDays(formData.annual_current_balance) >
                          editingEmployee.annual_current_balance
                            ? "#10b981"
                            : "#ef4444"
                      }}
                    >
                      {formatLeaveDelta(
                        parseLeaveDays(formData.annual_current_balance),
                        editingEmployee.annual_current_balance
                      )}
                    </span>
                  ) : (
                    <span>No change</span>
                  )}
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Update Bereavement Current Balance</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.bereavement_current_balance}
                  onChange={(e) => {
                    const raw = e.target.value.replace(",", ".");
                    if (!isLeaveDaysInput(raw)) return;
                    setFormData({ ...formData, bereavement_current_balance: raw });
                  }}
                  className={styles.input}
                />
                <div className={styles.helpText}>
                  {formatLeaveDelta(
                    parseLeaveDays(formData.bereavement_current_balance),
                    editingEmployee.bereavement_current_balance
                  ) ? (
                    <span
                      style={{
                        color:
                          parseLeaveDays(formData.bereavement_current_balance) >
                          editingEmployee.bereavement_current_balance
                            ? "#10b981"
                            : "#ef4444"
                      }}
                    >
                      {formatLeaveDelta(
                        parseLeaveDays(formData.bereavement_current_balance),
                        editingEmployee.bereavement_current_balance
                      )}
                    </span>
                  ) : (
                    <span>No change</span>
                  )}
                </div>
              </div>

              {normalizeEmployeeGender(editingEmployee.gender) === "female" ? (
                <div className={styles.formGroup}>
                  <label>Update Maternity Current Balance</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.maternity_current_balance}
                    onChange={(e) => {
                      const raw = e.target.value.replace(",", ".");
                      if (!isLeaveDaysInput(raw)) return;
                      setFormData({ ...formData, maternity_current_balance: raw });
                    }}
                    className={styles.input}
                  />
                  <div className={styles.helpText}>
                    {formatLeaveDelta(
                      parseLeaveDays(formData.maternity_current_balance),
                      editingEmployee.maternity_current_balance ??
                        editingEmployee.maternity_allowance ??
                        90,
                    ) ? (
                      <span
                        style={{
                          color:
                            parseLeaveDays(formData.maternity_current_balance) >
                            (editingEmployee.maternity_current_balance ??
                              editingEmployee.maternity_allowance ??
                              90)
                              ? "#10b981"
                              : "#ef4444",
                        }}
                      >
                        {formatLeaveDelta(
                          parseLeaveDays(formData.maternity_current_balance),
                          editingEmployee.maternity_current_balance ??
                            editingEmployee.maternity_allowance ??
                            90,
                        )}
                      </span>
                    ) : (
                      <span>No change</span>
                    )}
                  </div>
                </div>
              ) : null}

              {normalizeEmployeeGender(editingEmployee.gender) === "male" ? (
                <div className={styles.formGroup}>
                  <label>Update Paternity Current Balance</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.paternity_current_balance}
                    onChange={(e) => {
                      const raw = e.target.value.replace(",", ".");
                      if (!isLeaveDaysInput(raw)) return;
                      setFormData({ ...formData, paternity_current_balance: raw });
                    }}
                    className={styles.input}
                  />
                  <div className={styles.helpText}>
                    {formatLeaveDelta(
                      parseLeaveDays(formData.paternity_current_balance),
                      editingEmployee.paternity_current_balance ??
                        editingEmployee.paternity_allowance ??
                        5,
                    ) ? (
                      <span
                        style={{
                          color:
                            parseLeaveDays(formData.paternity_current_balance) >
                            (editingEmployee.paternity_current_balance ??
                              editingEmployee.paternity_allowance ??
                              5)
                              ? "#10b981"
                              : "#ef4444",
                        }}
                      >
                        {formatLeaveDelta(
                          parseLeaveDays(formData.paternity_current_balance),
                          editingEmployee.paternity_current_balance ??
                            editingEmployee.paternity_allowance ??
                            5,
                        )}
                      </span>
                    ) : (
                      <span>No change</span>
                    )}
                  </div>
                </div>
              ) : null}

              <div className={styles.modalActions}>
                <button
                  className={styles.cancelBtn}
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  className={styles.saveBtn}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
          </ModalPortal>
        ) : null}
        </div>
      </div>
      {popup}
    </OptionalAdminShell>
  );
}
