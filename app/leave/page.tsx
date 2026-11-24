"use client";

import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  SERVER_TIMEZONE,
} from "../../lib/timezone";
import { parseTicketInstant } from "@/lib/ticket-time";
import { FaFilter, FaSort, FaSortUp, FaSortDown } from "react-icons/fa";
import tableStyles from "../break-summary/break-summary.module.css";
import styles from "./leave.module.css";
import { EmployeeTableNameCell } from "../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../components/use-employee-detail-popup";
import { leaveStatusLabel, overallLeaveStatus } from "@/lib/leave-approval";
import { rowAllowedByScope, useViewerDataScope } from "@/lib/access-control/use-viewer-scope";
import { toastError } from "@/lib/app-toast";
import {
  isCeoOrgRole,
  isManagerOrgRole,
  isTeamLeadOrgRole,
} from "@/lib/org-role";
import { displayLeaveReason } from "@/lib/leave-reason-display";
import { isAdminBrowserSession } from "@/lib/access-control/employee-shell";

type LeaveSortKey =
  | "employee_id"
  | "employee_name"
  | "pseudonym"
  | "department_name"
  | "leave_category"
  | "start_date"
  | "total_days"
  | "status"
  | "requested_at";

type SortDirection = "asc" | "desc";

function formatDate(dateString: string) {
  if (!dateString) return "";
  const dateKey = getDateStringInTimeZone(dateString, SERVER_TIMEZONE);
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

/** Mongo sqlNow() stores UTC wall clock without Z — parse as UTC then show Asia/Karachi. */
function formatDateTime(dateTimeString: string) {
  if (!dateTimeString) return "";
  const instant = parseTicketInstant(dateTimeString);
  if (!instant) return "";
  const dateKey = getDateStringInTimeZone(instant, SERVER_TIMEZONE);
  const timeStr = getTimeStringInTimeZone(instant, SERVER_TIMEZONE);
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

export default function LeavePage() {
  const viewerScope = useViewerDataScope();
  const viewerEmployeeId = readViewerEmployeeId();
  const canApproveLeaves =
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
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLeave, setSelectedLeave] = useState<any | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [rejectRemark, setRejectRemark] = useState("");
  const [balanceInfo, setBalanceInfo] = useState<any | null>(null);
  const [balanceByEmp, setBalanceByEmp] = useState<
    Record<string, { annualBalance: number; annualAllowance: number; bereavementBalance: number }>
  >({});
  const [sortConfig, setSortConfig] = useState<{ key: LeaveSortKey; direction: SortDirection } | null>(
    null
  );
  const [searchText, setSearchText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  /** "" = all; pending | approved | rejected */
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "approved" | "rejected">("");
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const leaveDayKey = (l: any) => {
    const raw = l?.start_date || l?.requested_at || "";
    if (!raw) return "";
    try {
      return getDateStringInTimeZone(raw, SERVER_TIMEZONE) || "";
    } catch {
      return String(raw).slice(0, 10);
    }
  };

  const loadBalancesForLeaves = async (list: any[]) => {
    const ids = [
      ...new Set(
        list
          .map((l) => String(l.employee_id || "").trim())
          .filter((id) => /^\d+$/.test(id)),
      ),
    ].slice(0, 80);
    if (!ids.length) {
      setBalanceByEmp({});
      return;
    }
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(
            `/api/leave-balance?employee_id=${encodeURIComponent(id)}&ts=${Date.now()}`,
            { cache: "no-store" },
          );
          const data = await res.json();
          if (!data?.success) return null;
          return [
            id,
            {
              annualBalance: Number(data.annualBalance) || 0,
              annualAllowance: Number(data.annualAllowance) || 0,
              bereavementBalance: Number(data.bereavementBalance) || 0,
            },
          ] as const;
        } catch {
          return null;
        }
      }),
    );
    const next: typeof balanceByEmp = {};
    for (const e of entries) {
      if (e) next[e[0]] = e[1];
    }
    setBalanceByEmp(next);
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
        const empMap = new Map<string, { employee_name: string; pseudonym: string; department_name: string }>();
        if (empData.success && Array.isArray(empData.employees)) {
          empData.employees.forEach((emp: any) => {
            const fullName = `${emp?.first_name || ""} ${emp?.last_name || ""}`.trim();
            const profile = {
              employee_name: fullName || "-",
              pseudonym: emp.pseudonym || "-",
              department_name: emp.department_name || "-",
            };
            if (emp?.id !== undefined && emp?.id !== null) {
              empMap.set(String(emp.id).trim(), profile);
            }
            if (emp?.employee_code) {
              empMap.set(String(emp.employee_code).trim(), profile);
            }
          });
        }
        const enrichedLeaves = (data.leaves || [])
          .map((l: any) => {
            const employeeKey = String(l?.employee_id ?? "").trim();
            const emp = empMap.get(employeeKey);
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
        void loadBalancesForLeaves(enrichedLeaves);
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

  const stats = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    leaves.forEach((l) => {
      const s = String(l?.status || "pending").toLowerCase();
      if (s === "approved") approved += 1;
      else if (s === "rejected") rejected += 1;
      else pending += 1;
    });
    return { pending, approved, rejected, total: leaves.length };
  }, [leaves]);

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

  const handleFilterClick = (key: LeaveSortKey) => {
    setSortConfig((prev) => {
      if (prev?.key === key) return null;
      return { key, direction: "asc" };
    });
  };

  const handleSortToggle = (key: LeaveSortKey) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  };

  const getSortIcon = (key: LeaveSortKey) => {
    if (!sortConfig || sortConfig.key !== key) return <FaSort style={{ opacity: 0.75 }} />;
    return sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />;
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
    const from = dateFrom.trim();
    const to = dateTo.trim();
    const scoped = leaves.filter((l) => {
      if (statusFilter) {
        const s = String(l?.status || "pending").toLowerCase();
        const normalized =
          s === "approved" ? "approved" : s === "rejected" ? "rejected" : "pending";
        if (normalized !== statusFilter) return false;
      }
      if (q) {
        const name = String(l.employee_name || "").toLowerCase();
        const pseudo = String(l.pseudonym || "").toLowerCase();
        if (!name.includes(q) && !pseudo.includes(q)) return false;
      }
      if (from || to) {
        const day = leaveDayKey(l);
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      return true;
    });

    // Default: latest submitted request on top.
    if (!sortConfig) {
      return [...scoped].sort((a, b) => {
        const diff = leaveRequestMs(b) - leaveRequestMs(a);
        return diff !== 0 ? diff : (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    }
    const { key, direction } = sortConfig;
    const getText = (v: unknown) => String(v || "").toLowerCase();

    return [...scoped].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "employee_id":
        case "total_days":
          cmp = Number(a[key] || 0) - Number(b[key] || 0);
          break;
        case "employee_name":
        case "pseudonym":
        case "department_name":
        case "leave_category":
          cmp = getText(a[key]).localeCompare(getText(b[key]), undefined, { sensitivity: "base" });
          break;
        case "status":
          cmp = getText(a.status).localeCompare(getText(b.status), undefined, {
            sensitivity: "base",
          });
          break;
        case "start_date":
          cmp = new Date(a.start_date || 0).getTime() - new Date(b.start_date || 0).getTime();
          break;
        case "requested_at":
          cmp = leaveRequestMs(a) - leaveRequestMs(b);
          break;
        default:
          cmp = 0;
      }
      return direction === "asc" ? cmp : -cmp;
    });
  }, [leaves, sortConfig, searchText, dateFrom, dateTo, statusFilter]);

  const hasActiveFilters = Boolean(
    searchText.trim() || dateFrom.trim() || dateTo.trim() || statusFilter,
  );

  const toggleStatusFilter = (next: "pending" | "approved" | "rejected" | "") => {
    setStatusFilter((prev) => (prev === next ? "" : next));
  };

  const sortButtonStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontSize: "0.8rem",
  };

  const renderSortableHeader = (label: string, key: LeaveSortKey) => {
    const isActive = sortConfig?.key === key;
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => handleFilterClick(key)}
            style={{ ...sortButtonStyle, opacity: isActive ? 1 : 0.78 }}
            title={isActive ? `Clear ${label} sort` : `Apply ${label} sort`}
            aria-label={isActive ? `Clear ${label} sort` : `Apply ${label} sort`}
          >
            <FaFilter />
          </button>
          <button
            type="button"
            onClick={() => handleSortToggle(key)}
            style={sortButtonStyle}
            title={`Toggle sort direction for ${label}`}
            aria-label={`Toggle sort direction for ${label}`}
          >
            {getSortIcon(key)}
          </button>
        </div>
        <span>{label}</span>
      </div>
    );
  };

  const selectedStatus = leaveStatusLabel(selectedLeave || {});
  const selectedPending =
    Boolean(selectedLeave) &&
    canActOnLeave(selectedLeave) &&
    overallLeaveStatus(selectedLeave || {}) === "pending";

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}>Leave requests</h1>
          <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: 14 }}>
            Review pending leave, approve or reject, and open request details.
          </p>

          <div className={styles.filterBar}>
            <div className={`${styles.filterField} ${styles.searchField}`}>
              <label htmlFor="leave-search-name">Search</label>
              <input
                id="leave-search-name"
                type="search"
                className={styles.searchInput}
                placeholder="Search by name or pseudo name…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className={styles.filterField}>
              <label htmlFor="leave-date-from">From</label>
              <input
                id="leave-date-from"
                type="date"
                className={styles.searchInput}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className={styles.filterField}>
              <label htmlFor="leave-date-to">To</label>
              <input
                id="leave-date-to"
                type="date"
                className={styles.searchInput}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                className={styles.clearFilters}
                onClick={() => {
                  setSearchText("");
                  setDateFrom("");
                  setDateTo("");
                  setStatusFilter("");
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          {!loading && leaves.length > 0 && hasActiveFilters ? (
            <p className={styles.searchMeta}>
              Showing {sortedLeaves.length} of {leaves.length} leave
              {sortedLeaves.length === 1 ? "" : "s"}
              {statusFilter ? ` · ${statusFilter}` : ""}
            </p>
          ) : null}

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
                {statusFilter ? "Click to show all" : "All statuses"}
              </p>
            </button>
          </div>

          {loading ? (
            <div className={styles.loading}>Loading leave requests…</div>
          ) : error ? (
            <div className={styles.alertError}>{error}</div>
          ) : (
            <div className={styles.tableCard}>
              <div className={tableStyles.breakSummaryTableWrapper}>
                <table className={tableStyles.breakSummaryTable}>
                  <thead>
                    <tr>
                      <th>{renderSortableHeader("Id", "employee_id")}</th>
                      <th>{renderSortableHeader("Full Name", "employee_name")}</th>
                      <th>{renderSortableHeader("P.Name", "pseudonym")}</th>
                      <th>{renderSortableHeader("Department", "department_name")}</th>
                      <th>{renderSortableHeader("Category", "leave_category")}</th>
                      <th>{renderSortableHeader("Dates", "start_date")}</th>
                      <th>{renderSortableHeader("Days", "total_days")}</th>
                      <th>Balance</th>
                      <th>{renderSortableHeader("Status", "status")}</th>
                      <th>Decided by</th>
                      <th>{renderSortableHeader("Requested", "requested_at")}</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeaves.length === 0 ? (
                      <tr>
                        <td colSpan={12} className={tableStyles.breakSummaryNoRecords}>
                          {hasActiveFilters
                            ? "No leave requests match your filters."
                            : "No leave requests yet."}
                        </td>
                      </tr>
                    ) : (
                      sortedLeaves.map((l, idx) => {
                        const statusLabel = leaveStatusLabel(l);
                        const pending =
                          canActOnLeave(l) && overallLeaveStatus(l) === "pending";
                        const bal = balanceByEmp[String(l.employee_id)];
                        const isBereavement =
                          String(l.leave_category || "").toLowerCase() === "bereavement";
                        const currentBal = bal
                          ? isBereavement
                            ? bal.bereavementBalance
                            : bal.annualBalance
                          : null;
                        const afterApprove =
                          currentBal != null
                            ? Math.max(0, currentBal - Number(l.total_days || 0))
                            : null;
                        return (
                          <tr
                            key={
                              l?.id ??
                              `${l?.employee_id || "emp"}-${l?.start_date || "start"}-${l?.end_date || "end"}-${idx}`
                            }
                          >
                            <td className={tableStyles.cellMuted}>{l.employee_id}</td>
                            <td>
                              <EmployeeTableNameCell
                                name={l.employee_name || ""}
                                employeeId={l.employee_id}
                                photo={getPhoto(l.employee_id)}
                                onOpen={() => openFromRow(l)}
                              />
                            </td>
                            <td>{l.pseudonym || "—"}</td>
                            <td>{l.department_name || "—"}</td>
                            <td style={{ textTransform: "capitalize" }}>{l.leave_category}</td>
                            <td>
                              {formatDate(l.start_date)} – {formatDate(l.end_date)}
                            </td>
                            <td>{l.total_days}</td>
                            <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                              {currentBal == null ? (
                                "…"
                              ) : (
                                <>
                                  {currentBal}
                                  {bal && !isBereavement ? (
                                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>
                                      {" "}
                                      / {bal.annualAllowance}
                                    </span>
                                  ) : null}
                                  {pending && afterApprove != null ? (
                                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>
                                      After approve: {afterApprove}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td>
                              <span className={`${styles.badge} ${statusBadgeClass(statusLabel)}`}>
                                {statusLabel}
                              </span>
                              {l.decided_by_label ? (
                                <div
                                  style={{
                                    marginTop: 4,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color:
                                      String(statusLabel).toLowerCase() === "rejected"
                                        ? "#b91c1c"
                                        : "#0f766e",
                                  }}
                                >
                                  {l.decided_by_label}
                                </div>
                              ) : null}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {l.approved_by_name &&
                              (statusLabel === "approved" || statusLabel === "rejected")
                                ? l.approved_by_name
                                : "—"}
                            </td>
                            <td>{l.requested_at ? formatDateTime(l.requested_at) : "—"}</td>
                            <td>
                              <div className={styles.actions}>
                                <button type="button" className={styles.btnView} onClick={() => openModal(l)}>
                                  View
                                </button>
                                {pending && (
                                  <button
                                    type="button"
                                    className={styles.btnApprove}
                                    onClick={() => handleAction(l.id, "approve")}
                                  >
                                    Approve
                                  </button>
                                )}
                                {pending && (
                                  <button
                                    type="button"
                                    className={styles.btnReject}
                                    onClick={() => openModal(l)}
                                  >
                                    Reject
                                  </button>
                                )}
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
                  <b>Reason:</b> {displayLeaveReason(selectedLeave.reason) || "—"}
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
                    {selectedPending ? (
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
                {selectedPending ? (
                  <div style={{ marginTop: 14 }}>
                    <label className={styles.modalRow}>
                      <b>Remarks (for rejection)</b>
                      <textarea
                        className={styles.textarea}
                        value={rejectRemark}
                        onChange={(e) => setRejectRemark(e.target.value)}
                        placeholder="Optional reason for rejection…"
                      />
                    </label>
                    <div className={styles.modalActions}>
                      <button
                        type="button"
                        className={styles.btnApprove}
                        onClick={() => handleAction(selectedLeave.id, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className={styles.btnReject}
                        onClick={() => handleAction(selectedLeave.id, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}
                <button type="button" className={styles.modalClose} onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>,
            document.body
          )
        : null}

      {popup}
    </OptionalAdminShell>
  );
}
