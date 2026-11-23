"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../../lib/timezone";
import styles from "../../leave/leave.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { leaveDeptMatches } from "@/lib/leave-dept-filter";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { leaveStatusLabel, overallLeaveStatus } from "@/lib/leave-approval";
import { displayLeaveReason } from "@/lib/leave-reason-display";
import { rowAllowedByScope, useViewerDataScope } from "@/lib/access-control/use-viewer-scope";
import { toastError } from "@/lib/app-toast";
import {
  isCeoOrgRole,
  isManagerOrgRole,
  isTeamLeadOrgRole,
} from "@/lib/org-role";
import { isAdminBrowserSession } from "@/lib/access-control/employee-shell";

function formatDate(dateString: string) {
  if (!dateString) return "";
  const dateKey = getDateStringInTimeZone(dateString, SERVER_TIMEZONE);
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateRange(start: string, end: string) {
  const a = formatDate(start);
  const b = formatDate(end);
  if (!a) return "—";
  if (!b || a === b) return a;
  return `${a}–${b}`;
}

function formatDateTime(dateTimeString: string) {
  if (!dateTimeString) return "";
  const dateKey = getDateStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const timeStr = getTimeStringInTimeZone(dateTimeString, SERVER_TIMEZONE);
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year} ${timeStr}`;
}

function parseDocs(document_paths?: string | string[]) {
  if (!document_paths) return [];
  if (typeof document_paths === "string") {
    try {
      const parsed = JSON.parse(document_paths || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(document_paths) ? document_paths : [];
}

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s === "approved" || s.startsWith("approved")) return styles.badgeApproved;
  if (s === "rejected" || s.includes("rejected")) return styles.badgeRejected;
  return styles.badgePending;
}

function readViewerEmployeeId(): string {
  try {
    const id = String(localStorage.getItem("employeeId") || "").trim();
    if (/^\d+$/.test(id)) return id;
  } catch {
    /* ignore */
  }
  return "";
}

type LeaveRequestsPanelProps = {
  initialCategory?: string;
  onCategoryConsumed?: () => void;
  /** Shared month from tabs row (YYYY-MM) — syncs From/To dates */
  externalMonth?: string;
};

export default function LeaveRequestsPanel({
  initialCategory = "",
  onCategoryConsumed,
  externalMonth = "",
}: LeaveRequestsPanelProps) {
  const viewerScope = useViewerDataScope();
  const viewerEmployeeId = readViewerEmployeeId();
  /** Admin login, HR (company-wide scope), or CEO — Edit + reject-after-approve. */
  const isHrOrAdmin =
    isAdminBrowserSession() ||
    viewerScope.mode === "all" ||
    isCeoOrgRole(viewerScope.orgRole);
  const canApproveLeaves =
    isHrOrAdmin ||
    isManagerOrgRole(viewerScope.orgRole) ||
    isTeamLeadOrgRole(viewerScope.orgRole) ||
    isCeoOrgRole(viewerScope.orgRole);
  const canActOnLeave = (leave: { employee_id?: string | number } | null) => {
    if (!canApproveLeaves || !leave) return false;
    // Nobody approves their own leave (use Leaves page for team/dept only).
    if (
      viewerEmployeeId &&
      String(leave.employee_id || "").trim() === viewerEmployeeId
    ) {
      return false;
    }
    return true;
  };
  /** HR/Admin may reject even after Team Lead approved. */
  const canRejectLeave = (leave: any | null) => {
    if (!canActOnLeave(leave)) return false;
    const status = overallLeaveStatus(leave);
    if (status === "pending") return true;
    if (status === "approved" && isHrOrAdmin) return true;
    return false;
  };
  const canApproveLeaveRow = (leave: any | null) => {
    if (!canActOnLeave(leave)) return false;
    const status = overallLeaveStatus(leave);
    if (status === "pending") return true;
    // Admin/HR may re-approve a rejected leave (Edit → Approve).
    if (status === "rejected" && isHrOrAdmin) return true;
    return false;
  };
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLeave, setSelectedLeave] = useState<any | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [rejectRemark, setRejectRemark] = useState("");
  const [balanceInfo, setBalanceInfo] = useState<any | null>(null);
  const [searchText, setSearchText] = useState("");
  /** "" = all; pending | approved | rejected — cards + toolbar select */
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "approved" | "rejected">("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    const cat = String(initialCategory || "").trim().toLowerCase();
    if (!cat) return;
    setCategoryFilter(cat);
    onCategoryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCategory]);

  useEffect(() => {
    const monthKey = String(externalMonth || "").trim();
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return;
    const [year, monthNum] = monthKey.split("-");
    const lastDay = new Date(Number(year), Number(monthNum), 0).getDate();
    setFromDate(`${monthKey}-01`);
    setToDate(`${monthKey}-${String(lastDay).padStart(2, "0")}`);
  }, [externalMonth]);

  const leaveDayKey = (l: any) => {
    const raw = l?.start_date || l?.end_date || l?.requested_at || l?.updated_at || "";
    if (!raw) return "";
    try {
      return getDateStringInTimeZone(raw, SERVER_TIMEZONE) || "";
    } catch {
      return String(raw).slice(0, 10);
    }
  };

  const fetchLeaves = async (scope = viewerScope) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("ts", String(Date.now()));
      if (viewerEmployeeId) params.set("viewerId", viewerEmployeeId);
      // TL / Manager: own department / team only (never company-wide dump).
      if (scope.mode !== "all" && scope.employeeIds.length) {
        params.set("employees", scope.employeeIds.join(","));
      }
      const res = await fetch(`/api/leaves?${params.toString()}`, {
        cache: "no-store",
        headers: viewerEmployeeId
          ? {
              "x-employee-id": viewerEmployeeId,
              "x-hrm-employee-id": viewerEmployeeId,
            }
          : undefined,
      });
      const data = await res.json();
      if (data.success) {
        const empRes = await fetch("/api/employee-list", { cache: "no-store" });
        const empData = await empRes.json();
        // Key by id only — never alias employee_code onto the same map (code "114"
        // colliding with id 114 assigned the wrong department to leave rows).
        const empMap = new Map<
          string,
          { employee_name: string; pseudonym: string; department_name: string }
        >();
        const empByCode = new Map<
          string,
          { employee_name: string; pseudonym: string; department_name: string }
        >();
        if (empData.success && Array.isArray(empData.employees)) {
          empData.employees.forEach((emp: any) => {
            const fullName = `${emp?.first_name || ""} ${emp?.last_name || ""}`.trim();
            const profile = {
              employee_name: fullName || "-",
              pseudonym: emp.pseudonym || "-",
              department_name: String(emp.department_name || "").trim() || "-",
            };
            if (emp?.id !== undefined && emp?.id !== null) {
              empMap.set(String(emp.id).trim(), profile);
            }
            if (emp?.employee_code) {
              empByCode.set(String(emp.employee_code).trim(), profile);
            }
          });
        }
        const enrichedLeaves = (data.leaves || [])
          .map((l: any) => {
            const employeeKey = String(l?.employee_id ?? "").trim();
            const emp = empMap.get(employeeKey) || empByCode.get(employeeKey);
            return {
              ...l,
              employee_name: l?.employee_name || emp?.employee_name || "-",
              pseudonym: emp?.pseudonym || "-",
              department_name: emp?.department_name || "-",
            };
          })
          .filter((l: any) =>
            rowAllowedByScope(scope, l.employee_id, l.department_name),
          );
        setLeaves(enrichedLeaves);
      } else {
        setError(data.error || "Failed to fetch leaves");
      }
    } catch {
      setError("Failed to fetch leaves");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENABLE_WS !== "true") return;

    let ws: WebSocket | null = null;

    const setupRealtime = async () => {
      try {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
        ws.onmessage = () => {
          void fetchLeaves();
        };
      } catch {
        /* optional realtime */
      }
    };

    void setupRealtime();
    return () => ws?.close();
  }, []);

  useEffect(() => {
    if (!viewerScope.loaded) return;
    void fetchLeaves(viewerScope);
    // Refetch when scope finishes loading / changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewerScope.loaded,
    viewerScope.mode,
    viewerScope.employeeIds.join(","),
    viewerScope.orgRole,
  ]);

  const leaveDateSpanKey = (l: any) => {
    const start = leaveDayKey(l);
    const endRaw = l?.end_date || l?.start_date || "";
    let end = "";
    try {
      end = endRaw ? getDateStringInTimeZone(endRaw, SERVER_TIMEZONE) || "" : "";
    } catch {
      end = String(endRaw).slice(0, 10);
    }
    return `${start}|${end || start}`;
  };

  const leavesWithMeta = useMemo(() => {
    const seen = new Map<string, number>();
    return leaves.map((l) => {
      const key = [
        String(l?.employee_id ?? "").trim(),
        String(l?.leave_category || "").trim().toLowerCase(),
        leaveDateSpanKey(l),
      ].join("|");
      const firstId = seen.get(key);
      const id = Number(l?.id) || 0;
      if (firstId == null) {
        seen.set(key, id);
        return { ...l, is_duplicate: false };
      }
      return { ...l, is_duplicate: true, duplicate_of: firstId };
    });
  }, [leaves]);

  const leaveOverlapsRange = (l: any, from: string, to: string) => {
    if (!from && !to) return true;
    const start = leaveDayKey(l);
    if (!start) return false;
    let end = "";
    try {
      end = l?.end_date
        ? getDateStringInTimeZone(l.end_date, SERVER_TIMEZONE) || ""
        : start;
    } catch {
      end = String(l?.end_date || start).slice(0, 10);
    }
    if (!end) end = start;
    if (from && end < from) return false;
    if (to && start > to) return false;
    return true;
  };

  const departmentOptions = useMemo(() => {
    return Array.from(
      new Set(
        leavesWithMeta
          .map((l) => String(l.department_name || "").trim())
          .filter((d) => d && d !== "-"),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [leavesWithMeta]);

  const categoryOptions = useMemo(() => {
    // HR filter: Annual, Bereavement, Maternity, Paternity (both genders).
    return ["annual", "bereavement", "maternity", "paternity"];
  }, []);

  const stats = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let duplicates = 0;
    let total = 0;
    leavesWithMeta.forEach((l) => {
      if (!leaveOverlapsRange(l, fromDate, toDate)) return;
      if (!leaveDeptMatches(l.department_name, departmentFilter)) return;
      total += 1;
      const s = overallLeaveStatus(l);
      if (s === "approved") approved += 1;
      else if (s === "rejected") rejected += 1;
      else pending += 1;
      if (l.is_duplicate) duplicates += 1;
    });
    return { pending, approved, rejected, total, duplicates };
  }, [leavesWithMeta, fromDate, toDate, departmentFilter]);

  const handleDocumentDownload = (docPath: string) => {
    const filename = docPath.split("/").pop() || docPath;
    const link = document.createElement("a");
    link.href = `/api/attachments/download?filename=${encodeURIComponent(filename)}`;
    link.download = filename;
    link.click();
  };

  const handleAction = async (
    id: number,
    action: "approve_step1" | "approve_step2" | "approve" | "reject",
  ) => {
    try {
      let actor: string | undefined;
      let loginId = "";
      try {
        const eid = String(localStorage.getItem("employeeId") || "").trim();
        if (/^\d+$/.test(eid)) actor = eid;
        loginId = String(localStorage.getItem("loginId") || "").trim();
      } catch {
        /* ignore */
      }
      const asAdmin = !actor && isAdminBrowserSession();
      if (!actor && !asAdmin) {
        toastError("Please sign in again — actor required for leave action");
        return;
      }
      const res = await fetch("/api/leaves", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(actor ? { "x-hrm-employee-id": actor, "x-employee-id": actor } : {}),
        },
        body: JSON.stringify({
          id,
          action,
          actor: actor || undefined,
          adminActor: asAdmin || undefined,
          loginId: asAdmin ? loginId || undefined : undefined,
          admin_remark: action === "reject" ? rejectRemark : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        toastError(data?.error || "Leave action failed");
        return;
      }
      void fetchLeaves();
      setModalOpen(false);
      setSelectedLeave(null);
      setRejectRemark("");
      setBalanceInfo(null);
    } catch {
      /* keep state */
    }
  };

  const openModal = async (leave: any) => {
    setSelectedLeave(leave);
    setModalOpen(true);
    setRejectRemark("");
    try {
      if (leave?.employee_id) {
        const res = await fetch(`/api/leave-balance?employee_id=${leave.employee_id}`);
        const data = await res.json();
        setBalanceInfo(data.success ? data : null);
      } else {
        setBalanceInfo(null);
      }
    } catch {
      setBalanceInfo(null);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedLeave(null);
    setRejectRemark("");
    setBalanceInfo(null);
  };

  /** Newest request first — submitted time only (ignore approve/update bumps). */
  const leaveRequestMs = (l: any) => {
    for (const c of [l?.requested_at, l?.created_at]) {
      const raw = String(c || "").trim();
      if (!raw) continue;
      const ms = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return Number(l?.id) || 0;
  };

  const sortedLeaves = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const scoped = leavesWithMeta.filter((l) => {
      if (statusFilter && overallLeaveStatus(l) !== statusFilter) return false;
      if (categoryFilter) {
        if (
          String(l.leave_category || "").trim().toLowerCase() !==
          categoryFilter.toLowerCase()
        ) {
          return false;
        }
      }
      if (duplicatesOnly && !l.is_duplicate) return false;
      if (!leaveOverlapsRange(l, fromDate, toDate)) return false;
      if (!leaveDeptMatches(l.department_name, departmentFilter)) return false;
      if (q) {
        const name = String(l.employee_name || "").toLowerCase();
        const pseudo = String(l.pseudonym || "").toLowerCase();
        const id = String(l.employee_id || "").toLowerCase();
        if (!name.includes(q) && !pseudo.includes(q) && !id.includes(q)) return false;
      }
      return true;
    });
    return [...scoped].sort((a, b) => {
      const diff = leaveRequestMs(b) - leaveRequestMs(a);
      return diff !== 0 ? diff : (Number(b.id) || 0) - (Number(a.id) || 0);
    });
  }, [
    leavesWithMeta,
    statusFilter,
    categoryFilter,
    duplicatesOnly,
    fromDate,
    toDate,
    departmentFilter,
    searchText,
  ]);

  const hasActiveFilters = Boolean(
    searchText.trim() ||
      statusFilter ||
      categoryFilter ||
      duplicatesOnly ||
      fromDate ||
      toDate ||
      departmentFilter,
  );

  const toggleStatusFilter = (next: "pending" | "approved" | "rejected" | "") => {
    setStatusFilter((prev) => (prev === next ? "" : next));
  };

  const selectedStatus = leaveStatusLabel(selectedLeave || {});
  const selectedCanApprove = canApproveLeaveRow(selectedLeave);
  const selectedCanReject = canRejectLeave(selectedLeave);

  return (
    <>
      <div className={styles.reqPanel}>
          <p className={styles.subtitle} style={{ marginTop: 0 }}>
            Review and approve employee leave applications.
          </p>

          <div className={styles.statRow}>
            <button
              type="button"
              className={`${styles.statCard} ${styles.statCardGold}${
                statusFilter === "pending" ? ` ${styles.statCardActive}` : ""
              }`}
              onClick={() => toggleStatusFilter("pending")}
              aria-pressed={statusFilter === "pending"}
            >
              <p className={styles.statLabel}>Pending</p>
              <p className={styles.statValue}>{stats.pending}</p>
              <p className={styles.statSub}>Awaiting a decision</p>
            </button>
            <button
              type="button"
              className={`${styles.statCard} ${styles.statCardGreen}${
                statusFilter === "approved" ? ` ${styles.statCardActive}` : ""
              }`}
              onClick={() => toggleStatusFilter("approved")}
              aria-pressed={statusFilter === "approved"}
            >
              <p className={styles.statLabel}>Approved</p>
              <p className={styles.statValue}>{stats.approved}</p>
              <p className={styles.statSub}>This leave year</p>
            </button>
            <button
              type="button"
              className={`${styles.statCard} ${styles.statCardRed}${
                statusFilter === "rejected" ? ` ${styles.statCardActive}` : ""
              }`}
              onClick={() => toggleStatusFilter("rejected")}
              aria-pressed={statusFilter === "rejected"}
            >
              <p className={styles.statLabel}>Rejected</p>
              <p className={styles.statValue}>{stats.rejected}</p>
              <p className={styles.statSub}>This leave year</p>
            </button>
            <button
              type="button"
              className={`${styles.statCard} ${styles.statCardPurple}${
                statusFilter === "" ? ` ${styles.statCardActive}` : ""
              }`}
              onClick={() => setStatusFilter("")}
              aria-pressed={statusFilter === ""}
            >
              <p className={styles.statLabel}>Total requests</p>
              <p className={styles.statValue}>{stats.total}</p>
              <p className={styles.statSub}>
                {stats.duplicates} flagged as duplicate
              </p>
            </button>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.filterField}>
              <label htmlFor="req-filter-dept">Department</label>
              <select
                id="req-filter-dept"
                className={styles.toolbarSelect}
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                aria-label="Filter by department"
              >
                <option value="">All departments</option>
                {departmentOptions.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.filterField}>
              <label htmlFor="req-filter-from">From date</label>
              <input
                id="req-filter-from"
                type="date"
                className={styles.toolbarSelect}
                value={fromDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setFromDate(v);
                  if (v && toDate && toDate < v) setToDate(v);
                }}
                aria-label="From date"
              />
            </div>
            <div className={styles.filterField}>
              <label htmlFor="req-filter-to">To date</label>
              <input
                id="req-filter-to"
                type="date"
                className={styles.toolbarSelect}
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="To date"
              />
            </div>
            <div className={styles.searchWrap}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className={styles.toolbarSearch}
                placeholder="Search by name or ID"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                autoComplete="off"
              />
            </div>
            <select
              className={styles.toolbarSelect}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as "" | "pending" | "approved" | "rejected",
                )
              }
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              className={styles.toolbarSelect}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
            <label
              className={`${styles.toggleChip}${duplicatesOnly ? ` ${styles.toggleChipOn}` : ""}`}
            >
              <input
                type="checkbox"
                checked={duplicatesOnly}
                onChange={(e) => setDuplicatesOnly(e.target.checked)}
              />
              Duplicates only
            </label>
            {hasActiveFilters ? (
              <button
                type="button"
                className={styles.clearFilters}
                onClick={() => {
                  setSearchText("");
                  setStatusFilter("");
                  setCategoryFilter("");
                  setDuplicatesOnly(false);
                  setFromDate("");
                  setToDate("");
                  setDepartmentFilter("");
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>

          {!loading && leavesWithMeta.length > 0 && hasActiveFilters ? (
            <p className={styles.searchMeta}>
              Showing {sortedLeaves.length} of {leavesWithMeta.length} request
              {sortedLeaves.length === 1 ? "" : "s"}
            </p>
          ) : null}

          {loading ? (
            <div className={styles.loading}>Loading leave requests…</div>
          ) : error ? (
            <div className={styles.alertError}>{error}</div>
          ) : (
            <div className={styles.reqTableShell}>
              <div className={styles.reqTableScroll}>
                <table className={`${styles.reqTable} ${styles.reqTableFit}`}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Employee</th>
                      <th>Dept</th>
                      <th>Category</th>
                      <th>Dates</th>
                      <th>Days</th>
                      <th>Status</th>
                      <th>Status by</th>
                      <th>Reason</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeaves.length === 0 ? (
                      <tr>
                        <td colSpan={10} className={styles.reqEmpty}>
                          {statusFilter
                            ? "No requests match this status."
                            : "No leave requests yet."}
                        </td>
                      </tr>
                    ) : (
                      sortedLeaves.map((l, idx) => {
                        const status = overallLeaveStatus(l);
                        const showApprove = canApproveLeaveRow(l);
                        const category = String(l.leave_category || "—");
                        const statusBy = l.status_by as
                          | { name?: string; employee_id?: string | null; role?: string | null }
                          | null
                          | undefined;
                        return (
                          <tr
                            key={
                              l?.id ??
                              `${l?.employee_id || "emp"}-${l?.start_date || "start"}-${l?.end_date || "end"}-${idx}`
                            }
                            className={l.is_duplicate ? styles.rowDim : undefined}
                          >
                            <td className={styles.reqId}>{l.employee_id}</td>
                            <td>
                              <div className={styles.personCell}>
                                <EmployeeTableNameCell
                                  name={l.employee_name || ""}
                                  employeeId={l.employee_id}
                                  photo={getPhoto(l.employee_id)}
                                  onOpen={() => openFromRow(l)}
                                />
                                {l.pseudonym && l.pseudonym !== "-" ? (
                                  <div className={styles.pseudoLine}>{l.pseudonym}</div>
                                ) : null}
                              </div>
                            </td>
                            <td>{l.department_name || "—"}</td>
                            <td>
                              <span className={`${styles.badge} ${styles.badgeType}`}>
                                {category.charAt(0).toUpperCase() + category.slice(1)}
                              </span>
                            </td>
                            <td className={styles.monoCell}>
                              {formatDateRange(l.start_date, l.end_date)}
                            </td>
                            <td className={styles.monoCell}>{l.total_days}</td>
                            <td>
                              <span className={`${styles.badge} ${statusBadgeClass(status)}`}>
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                              </span>
                              {l.is_duplicate ? (
                                <div style={{ marginTop: 2 }}>
                                  <span className={`${styles.badge} ${styles.badgeDup}`}>
                                    Duplicate
                                  </span>
                                </div>
                              ) : null}
                            </td>
                            <td className={styles.statusByCell}>
                              {statusBy?.name ? (
                                <>
                                  <div className={styles.statusByName}>
                                    {statusBy.name}
                                    {statusBy.role ? (
                                      <span className={styles.statusByRole}>
                                        {" "}
                                        ({statusBy.role})
                                      </span>
                                    ) : null}
                                  </div>
                                  {statusBy.employee_id ? (
                                    <div className={styles.statusById}>
                                      ID {statusBy.employee_id}
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <span className={styles.actionStamp}>—</span>
                              )}
                            </td>
                            <td className={styles.reasonCell}>
                              <button
                                type="button"
                                className={styles.btnView}
                                onClick={() => openModal(l)}
                              >
                                View
                              </button>
                            </td>
                            <td>
                              <div className={styles.actions}>
                                {isHrOrAdmin ? (
                                  <button
                                    type="button"
                                    className={styles.btnView}
                                    onClick={() => openModal(l)}
                                  >
                                    Edit
                                  </button>
                                ) : null}
                                {showApprove ? (
                                  <button
                                    type="button"
                                    className={styles.btnApprove}
                                    onClick={() => handleAction(l.id, "approve")}
                                  >
                                    Approve
                                  </button>
                                ) : null}
                                {canRejectLeave(l) ? (
                                  <button
                                    type="button"
                                    className={styles.btnRejectOutline}
                                    onClick={() => openModal(l)}
                                  >
                                    Reject
                                  </button>
                                ) : null}
                                {!isHrOrAdmin && !showApprove && !canRejectLeave(l) ? (
                                  <span className={styles.actionStamp}>—</span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </div>

      {modalOpen && selectedLeave && typeof document !== "undefined"
        ? createPortal(
            <div className={styles.modalBackdrop} onClick={closeModal} role="presentation">
              <div
                className={styles.modal}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Leave details"
              >
                <h2 className={styles.modalTitle}>Leave details</h2>
                <div className={styles.modalRow}>
                  <b>Employee ID:</b> {selectedLeave.employee_id}
                </div>
                <div className={styles.modalRow}>
                  <b>Category:</b> {selectedLeave.leave_category}
                </div>
                <div className={styles.modalRow}>
                  <b>Dates:</b> {formatDate(selectedLeave.start_date)} –{" "}
                  {formatDate(selectedLeave.end_date)} ({selectedLeave.total_days} days)
                </div>
                <div className={styles.modalRow}>
                  <b>Status:</b>{" "}
                  <span className={`${styles.badge} ${statusBadgeClass(selectedStatus)}`}>
                    {selectedStatus}
                  </span>
                </div>
                {selectedLeave.decided_by_label || selectedLeave.approved_by_name ? (
                  <div className={styles.modalRow}>
                    <b>
                      {String(selectedStatus).toLowerCase() === "rejected"
                        ? "Rejected by:"
                        : "Approved by:"}
                    </b>{" "}
                    {selectedLeave.approved_by_name || selectedLeave.decided_by_label}
                  </div>
                ) : null}
                <div className={styles.modalRow}>
                  <b>Reason</b>
                  <div className={styles.reasonFull}>
                    {displayLeaveReason(selectedLeave.reason) || "—"}
                  </div>
                </div>
                {selectedLeave.admin_remark ? (
                  <div className={styles.modalRow}>
                    <b>Admin remarks:</b> {selectedLeave.admin_remark}
                  </div>
                ) : null}
                {balanceInfo ? (
                  <div className={styles.balanceBox}>
                    <b>Current leave balance (before this action)</b>
                    <div>
                      {balanceInfo.employment_status === "Probation"
                        ? "Leave balance"
                        : "Annual leave balance"}
                      : {balanceInfo.annualBalance} / {balanceInfo.annualAllowance}
                    </div>
                    <div>
                      Bereavement: {balanceInfo.bereavementBalance} / 3
                    </div>
                    {Number(balanceInfo.maternityAllowance) > 0 ? (
                      <div>
                        Maternity: {balanceInfo.maternityBalance} /{" "}
                        {balanceInfo.maternityAllowance}
                      </div>
                    ) : null}
                    {Number(balanceInfo.paternityAllowance) > 0 ? (
                      <div>
                        Paternity: {balanceInfo.paternityBalance} /{" "}
                        {balanceInfo.paternityAllowance}
                      </div>
                    ) : null}
                    {selectedCanApprove ? (
                      <div style={{ marginTop: 8, fontSize: 13, color: "#334155" }}>
                        Approve → balance minus {selectedLeave.total_days || 1} day(s). Reject →
                        balance unchanged.
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className={styles.modalRow}>
                  <b>Documents:</b>{" "}
                  {parseDocs(selectedLeave.document_paths).length > 0 ? (
                    parseDocs(selectedLeave.document_paths).map((d: string) => (
                      <button
                        key={d}
                        type="button"
                        className={styles.docBtn}
                        onClick={() => handleDocumentDownload(d)}
                      >
                        📄 {d.split("/").pop()}
                      </button>
                    ))
                  ) : (
                    <span style={{ color: "#94a3b8" }}>No documents</span>
                  )}
                </div>
                <div className={styles.modalRow}>
                  <b>Requested:</b>{" "}
                  {selectedLeave.requested_at ? formatDateTime(selectedLeave.requested_at) : "—"}
                </div>
                {selectedCanReject ? (
                  <label className={styles.modalRow} style={{ marginTop: 14, display: "block" }}>
                    <b>Remarks (for rejection)</b>
                    <textarea
                      className={styles.textarea}
                      value={rejectRemark}
                      onChange={(e) => setRejectRemark(e.target.value)}
                      placeholder="Optional reason for rejection…"
                    />
                  </label>
                ) : null}
                <div className={styles.modalActions} style={{ marginTop: 16 }}>
                  <button type="button" className={styles.modalClose} onClick={closeModal}>
                    Close
                  </button>
                  {selectedCanApprove ? (
                    <button
                      type="button"
                      className={styles.btnApprove}
                      onClick={() => handleAction(selectedLeave.id, "approve")}
                    >
                      Approve
                    </button>
                  ) : null}
                  {selectedCanReject ? (
                    <button
                      type="button"
                      className={styles.btnReject}
                      onClick={() => handleAction(selectedLeave.id, "reject")}
                    >
                      Reject
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {popup}
    </>
  );
}
