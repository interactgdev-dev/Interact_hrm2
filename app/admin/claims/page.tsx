"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import fh from "./claims.module.css";
import { MEDICAL_PACKAGES } from "@/lib/medical-package";
import { fetchAccessControlMe } from "@/lib/access-control/me-client-cache";

const FINANCE_VIEW_CACHE_KEY = "hrm.claims.financeViewer";
const CURRENT_YEAR = String(new Date().getFullYear());

function readFinanceViewerCache(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(FINANCE_VIEW_CACHE_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignore */
  }
  return null;
}

function writeFinanceViewerCache(value: boolean) {
  try {
    sessionStorage.setItem(FINANCE_VIEW_CACHE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

type Employee = {
  id: number;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  pseudonym?: string | null;
  department_name?: string | null;
};

type ClaimRow = {
  id: number;
  employee_id: number;
  claim_year: string;
  claim_type: string;
  title: string | null;
  amount: number;
  claim_date: string;
  status: string;
  notes: string | null;
  employee_name?: string;
  pseudonym?: string | null;
  department_name?: string | null;
  created_by?: string | null;
};

type ClaimBalance = {
  employee_id: number;
  year: string;
  claim_type: string;
  medical_package: string | null;
  entitlement: number;
  entitlement_source: string;
  used: number;
  pending: number;
  remaining: number;
  claims_count: number;
};

type MedicalBalances = {
  opd: ClaimBalance;
  ipd: ClaimBalance;
};

type Summary = {
  year: string;
  total_claims: number;
  total_approved_amount: number;
  total_pending_amount: number;
  employees_with_claims: number;
};

const money = (n: number) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

const fullName = (emp?: Partial<Employee> | null) =>
  `${emp?.first_name || ""} ${emp?.middle_name || ""} ${emp?.last_name || ""}`
    .replace(/\s+/g, " ")
    .trim();

function statusClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return fh.statusPaid;
  if (s === "approved") return fh.statusPaid;
  if (s === "unpaid") return fh.statusUnpaid;
  if (s === "pending") return fh.statusActive;
  if (s === "rejected" || s === "cancelled") return fh.statusCancelled;
  return "";
}

function statusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return "Paid";
  if (s === "approved") return "Approved";
  if (s === "unpaid") return "Unpaid";
  if (s === "pending") return "Pending";
  if (s === "rejected") return "Rejected";
  if (s === "cancelled") return "Cancelled";
  return status || "—";
}

/** HR column: Pending / Approved / Rejected (payment states fold into Approved). */
function hrStatusOf(status: string): { label: string; className: string } {
  const s = String(status || "").toLowerCase();
  if (s === "pending") return { label: "Pending", className: fh.statusActive };
  if (s === "rejected") return { label: "Rejected", className: fh.statusCancelled };
  if (s === "cancelled") return { label: "Cancelled", className: fh.statusCancelled };
  if (s === "approved" || s === "unpaid" || s === "paid") {
    return { label: "Approved", className: fh.statusPaid };
  }
  return { label: statusLabel(status), className: statusClass(status) };
}

/** Finance column: Paid / Unpaid / — */
function financeStatusOf(status: string): { label: string; className: string } {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return { label: "Paid", className: fh.statusPaid };
  if (s === "unpaid" || s === "approved") {
    return { label: "Unpaid", className: fh.statusUnpaid };
  }
  return { label: "—", className: "" };
}

function isPayableStatus(status: string) {
  const s = String(status || "").toLowerCase();
  return s === "approved" || s === "unpaid";
}

/** Rows that Mark as Paid can update. */
function canBulkMarkPaid(status: string) {
  return isPayableStatus(status);
}

/** Rows that Mark as Unpaid can update (Paid → Unpaid; Approved also allowed). */
function canBulkMarkUnpaid(status: string) {
  const s = String(status || "").toLowerCase();
  return s === "paid" || s === "approved";
}

function detectFinanceAccess(payload: any): boolean {
  const perms: string[] = Array.isArray(payload?.permissions)
    ? payload.permissions.map((p: unknown) => String(p || "").toLowerCase())
    : [];
  const slugs: string[] = [
    ...(Array.isArray(payload?.roleSlugs) ? payload.roleSlugs : []),
    ...(Array.isArray(payload?.role_slugs) ? payload.role_slugs : []),
    payload?.roleSlug,
    payload?.role_slug,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  const dept = String(
    payload?.departmentName || payload?.department_name || "",
  ).toLowerCase();
  if (perms.some((p) => p.includes("salary_disbursement"))) return true;
  if (slugs.some((s) => s.includes("finance"))) return true;
  if (/finance|accounts/.test(dept)) return true;
  return false;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function readStoredViewerId(): string {
  if (typeof window === "undefined") return "";
  try {
    const candidates = [
      localStorage.getItem("employeeId"),
      localStorage.getItem("hrmEmployeeId"),
      localStorage.getItem("loginId"),
    ];
    for (const raw of candidates) {
      const id = String(raw || "").trim();
      if (/^\d+$/.test(id)) return id;
    }
  } catch {
    /* ignore */
  }
  return "";
}

async function resolveViewerId(): Promise<string> {
  const direct = readStoredViewerId();
  if (direct) return direct;
  try {
    const loginId = String(localStorage.getItem("loginId") || "").trim();
    if (!loginId) return "";
    const res = await fetch(
      `/api/hrm_employees?employeeId=${encodeURIComponent(loginId)}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    const empId = String(data?.employee?.id || data?.employee?.employee_id || "").trim();
    if (/^\d+$/.test(empId)) {
      try {
        localStorage.setItem("employeeId", empId);
      } catch {
        /* ignore */
      }
      return empId;
    }
  } catch {
    /* ignore */
  }
  return "";
}

export default function ClaimsPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const yearOptions = useMemo(() => {
    const y = Number(CURRENT_YEAR);
    return [y - 3, y - 2, y - 1, y, y + 1].map(String);
  }, []);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [empPickerQuery, setEmpPickerQuery] = useState("");
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const empPickerRef = useRef<HTMLDivElement | null>(null);
  const [formAmount, setFormAmount] = useState("");
  const [formDate, setFormDate] = useState(todayIso);
  const [formType, setFormType] = useState("opd");
  const [formTitle, setFormTitle] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [balance, setBalance] = useState<ClaimBalance | null>(null);
  const [medicalBalances, setMedicalBalances] = useState<MedicalBalances | null>(
    null,
  );
  const [balanceError, setBalanceError] = useState("");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [viewerEmployeeId, setViewerEmployeeId] = useState("");
  /** null = role not resolved yet (avoid admin→finance flash). */
  const [isFinanceViewer, setIsFinanceViewer] = useState<boolean | null>(() =>
    readFinanceViewerCache(),
  );
  const [payingId, setPayingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkPaying, setBulkPaying] = useState(false);
  /** Finance bulk action: paid | unpaid (unpaid = revert paid → approved). */
  const [bulkAction, setBulkAction] = useState<"paid" | "unpaid">("paid");
  /** Admin bulk review: approve or reject pending claims. */
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected">(
    "approved",
  );
  const roleReady = isFinanceViewer !== null;
  const showFinance = isFinanceViewer === true;

  useEffect(() => {
    void (async () => {
      const id = await resolveViewerId();
      setViewerEmployeeId(id);
      if (!id) {
        setIsFinanceViewer(false);
        writeFinanceViewerCache(false);
        return;
      }
      try {
        const data = await fetchAccessControlMe(id);
        if (data?.success) {
          const finance = detectFinanceAccess(data);
          setIsFinanceViewer(finance);
          writeFinanceViewerCache(finance);
        } else if (isFinanceViewer === null) {
          setIsFinanceViewer(false);
          writeFinanceViewerCache(false);
        }
      } catch {
        if (isFinanceViewer === null) {
          setIsFinanceViewer(false);
          writeFinanceViewerCache(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolve once on mount
  }, []);

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true);
    try {
      // Same source as Advance / Loan — /api/hrm_employees is single-lookup only.
      const res = await fetch("/api/employee-list", { cache: "no-store" });
      const data = await res.json();
      const list = Array.isArray(data?.employees)
        ? data.employees
        : Array.isArray(data)
          ? data
          : [];
      setEmployees(list as Employee[]);
    } catch {
      setEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const vid = viewerEmployeeId || (await resolveViewerId());
      if (vid && vid !== viewerEmployeeId) setViewerEmployeeId(vid);
      const q = new URLSearchParams({ year });
      if (vid) q.set("viewerId", vid);
      if (statusFilter) q.set("status", statusFilter);
      if (typeFilter) q.set("claim_type", typeFilter);
      const headers: Record<string, string> = {};
      if (vid) {
        headers["x-employee-id"] = vid;
        headers["x-hrm-employee-id"] = vid;
      }
      const res = await fetch(`/api/employee-claims?${q}`, {
        cache: "no-store",
        headers,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load");
      setClaims(Array.isArray(data.claims) ? data.claims : []);
      setSummary(data.summary || null);
      setSelectedIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load claims");
      setClaims([]);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }, [year, statusFilter, typeFilter, viewerEmployeeId]);

  const loadBalance = useCallback(async (employeeId: string, claimType: string) => {
    if (!/^\d+$/.test(employeeId)) {
      setBalance(null);
      setMedicalBalances(null);
      setBalanceError("");
      return;
    }
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const vid = viewerEmployeeId || (await resolveViewerId());
      if (vid && vid !== viewerEmployeeId) setViewerEmployeeId(vid);
      const q = new URLSearchParams({
        balance: "1",
        employee_id: employeeId,
        year: year || String(new Date().getFullYear()),
        claim_type: claimType || "opd",
      });
      if (vid) q.set("viewerId", vid);
      const headers: Record<string, string> = {};
      if (vid) {
        headers["x-employee-id"] = vid;
        headers["x-hrm-employee-id"] = vid;
      }
      const res = await fetch(`/api/employee-claims?${q}`, {
        cache: "no-store",
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.balances?.opd && data.balances?.ipd) {
        setBalance(data.balance || data.balances.opd);
        setMedicalBalances({
          opd: data.balances.opd,
          ipd: data.balances.ipd,
        });
        setBalanceError("");
      } else if (data.success && data.balance) {
        setBalance(data.balance);
        setMedicalBalances(null);
        setBalanceError("");
      } else {
        setBalance(null);
        setMedicalBalances(null);
        setBalanceError(
          data.error || `Balance failed (${res.status || "network"})`,
        );
      }
    } catch (e) {
      setBalance(null);
      setMedicalBalances(null);
      setBalanceError(e instanceof Error ? e.message : "Balance failed");
    } finally {
      setBalanceLoading(false);
    }
  }, [year, viewerEmployeeId]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  useEffect(() => {
    void loadBalance(formEmployeeId, formType);
  }, [formEmployeeId, formType, loadBalance]);

  useEffect(() => {
    if (!empPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!empPickerRef.current?.contains(e.target as Node)) {
        setEmpPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [empPickerOpen]);

  const filteredClaims = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (!q) return claims;
    return claims.filter((c) => {
      const blob = [
        c.employee_name,
        c.pseudonym,
        c.department_name,
        String(c.employee_id),
        c.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [claims, nameSearch]);

  const employeeOptions = useMemo(() => {
    return [...employees].sort((a, b) =>
      fullName(a).localeCompare(fullName(b)),
    );
  }, [employees]);

  const selectedEmployee = useMemo(
    () => employeeOptions.find((e) => String(e.id) === formEmployeeId) || null,
    [employeeOptions, formEmployeeId],
  );

  const filteredEmployeeOptions = useMemo(() => {
    const q = empPickerQuery.trim().toLowerCase();
    if (!q) return employeeOptions;
    return employeeOptions.filter((e) => {
      const blob = [
        fullName(e),
        e.pseudonym,
        e.department_name,
        String(e.id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [employeeOptions, empPickerQuery]);

  function pickEmployee(emp: Employee) {
    setFormEmployeeId(String(emp.id));
    setEmpPickerQuery("");
    setEmpPickerOpen(false);
  }

  function clearEmployee() {
    setFormEmployeeId("");
    setEmpPickerQuery("");
    setBalance(null);
    setMedicalBalances(null);
    setBalanceError("");
  }

  function claimTypeLabel(t: string) {
    const v = String(t || "").toLowerCase();
    if (v === "opd" || v === "medical") return "OPD";
    if (v === "ipd") return "IPD";
    if (v === "travel") return "Travel";
    if (v === "other") return "Other";
    return t || "—";
  }

  async function onSaveClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!formEmployeeId) {
      setToast("Select an employee");
      return;
    }
    const amount = Number(formAmount);
    if (!(amount > 0)) {
      setToast("Enter a valid amount");
      return;
    }
    if (!formStatus) {
      setToast("Select a status");
      return;
    }
    setSaving(true);
    setToast("");
    try {
      const vid = viewerEmployeeId || (await resolveViewerId());
      if (vid && vid !== viewerEmployeeId) setViewerEmployeeId(vid);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (vid) {
        headers["x-employee-id"] = vid;
        headers["x-hrm-employee-id"] = vid;
      }
      const res = await fetch("/api/employee-claims", {
        method: "POST",
        headers,
        body: JSON.stringify({
          employee_id: Number(formEmployeeId),
          amount,
          claim_date: formDate,
          claim_type: formType === "ipd" ? "ipd" : "opd",
          title: formTitle || null,
          notes: formNotes || null,
          status: formStatus,
          viewerId: vid || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");
      setToast("Claim added");
      setFormAmount("");
      setFormTitle("");
      setFormNotes("");
      setFormStatus("");
      if (data.balances?.opd && data.balances?.ipd) {
        setMedicalBalances({ opd: data.balances.opd, ipd: data.balances.ipd });
        setBalance(
          formType === "ipd" ? data.balances.ipd : data.balances.opd,
        );
      } else if (data.balance) {
        setBalance(data.balance);
      }
      await loadClaims();
      await loadBalance(formEmployeeId, formType);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function setClaimStatus(
    id: number,
    status: string,
    opts?: { successToast?: string },
  ) {
    try {
      if (status === "paid" || opts?.successToast) setPayingId(id);
      const vid = viewerEmployeeId || (await resolveViewerId());
      if (vid && vid !== viewerEmployeeId) setViewerEmployeeId(vid);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (vid) {
        headers["x-employee-id"] = vid;
        headers["x-hrm-employee-id"] = vid;
      }
      const res = await fetch(`/api/employee-claims/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status,
          viewerId: vid || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Update failed");
      if (opts?.successToast) setToast(opts.successToast);
      else if (status === "paid") setToast("Marked as paid");
      else if (status === "unpaid") setToast("Marked as unpaid");
      await loadClaims();
      if (formEmployeeId) await loadBalance(formEmployeeId, formType);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPayingId(null);
    }
  }

  async function applyBulkStatusUpdate(
    nextStatus: string,
    ids: number[],
    emptyToast: string,
    label: string,
  ) {
    if (!ids.length) {
      setToast(emptyToast);
      return;
    }
    try {
      setBulkPaying(true);
      const vid = viewerEmployeeId || (await resolveViewerId());
      if (vid && vid !== viewerEmployeeId) setViewerEmployeeId(vid);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (vid) {
        headers["x-employee-id"] = vid;
        headers["x-hrm-employee-id"] = vid;
      }
      const res = await fetch("/api/employee-claims", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ids,
          status: nextStatus,
          viewerId: vid || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Bulk update failed");
      const ok = Number(data.updated_count || 0);
      const fail = Number(data.failed_count || 0);
      if (ok > 0 && fail === 0) {
        setToast(`${ok} claim${ok === 1 ? "" : "s"} marked as ${label}`);
      } else if (ok > 0) {
        setToast(`${ok} ${label}, ${fail} failed`);
      } else {
        throw new Error(
          Array.isArray(data.failed) && data.failed[0]?.error
            ? String(data.failed[0].error)
            : "Bulk update failed",
        );
      }
      setSelectedIds([]);
      await loadClaims();
      if (formEmployeeId) await loadBalance(formEmployeeId, formType);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Bulk update failed");
    } finally {
      setBulkPaying(false);
    }
  }

  async function applyBulkPaymentAction() {
    const nextStatus = bulkAction === "paid" ? "paid" : "unpaid";
    const ids = selectedIds.filter((id) =>
      claims.some((c) => {
        if (c.id !== id) return false;
        return bulkAction === "paid"
          ? canBulkMarkPaid(c.status)
          : canBulkMarkUnpaid(c.status);
      }),
    );
    await applyBulkStatusUpdate(
      nextStatus,
      ids,
      bulkAction === "paid"
        ? "Select Approved/Unpaid rows, then Apply"
        : "Select Paid (or Approved) rows, then Apply",
      bulkAction === "paid" ? "paid" : "unpaid",
    );
  }

  async function applyBulkReviewAction() {
    const ids = selectedIds.filter((id) =>
      claims.some((c) => {
        if (c.id !== id) return false;
        if (reviewAction === "approved") return c.status === "pending";
        return (
          c.status === "pending" ||
          c.status === "approved" ||
          c.status === "unpaid"
        );
      }),
    );
    await applyBulkStatusUpdate(
      reviewAction,
      ids,
      reviewAction === "approved"
        ? "Select Pending rows, then Apply"
        : "Select Pending/Approved rows, then Apply",
      reviewAction === "approved" ? "approved" : "rejected",
    );
  }

  function toggleSelectClaim(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  }

  const financeQueue = useMemo(() => {
    // Finance: payable first (approved/unpaid), then pending, then paid.
    const rank = (s: string) => {
      const v = String(s || "").toLowerCase();
      if (v === "approved" || v === "unpaid") return 0;
      if (v === "pending") return 1;
      if (v === "paid") return 2;
      return 3;
    };
    return [...filteredClaims].sort((a, b) => {
      const rd = rank(a.status) - rank(b.status);
      if (rd !== 0) return rd;
      return String(b.claim_date).localeCompare(String(a.claim_date));
    });
  }, [filteredClaims]);

  const adminReviewQueue = useMemo(() => {
    // Admin: pending first (to approve), then approved/unpaid, then paid.
    const rank = (s: string) => {
      const v = String(s || "").toLowerCase();
      if (v === "pending") return 0;
      if (v === "approved" || v === "unpaid") return 1;
      if (v === "paid") return 2;
      return 3;
    };
    return [...filteredClaims].sort((a, b) => {
      const rd = rank(a.status) - rank(b.status);
      if (rd !== 0) return rd;
      return String(b.claim_date).localeCompare(String(a.claim_date));
    });
  }, [filteredClaims]);

  const visibleClaims = showFinance ? financeQueue : adminReviewQueue;

  const readyToPayCount = useMemo(
    () => claims.filter((c) => isPayableStatus(c.status)).length,
    [claims],
  );
  const pendingCount = useMemo(
    () => claims.filter((c) => c.status === "pending").length,
    [claims],
  );
  const financeBulkTargetIds = useMemo(
    () =>
      visibleClaims
        .filter((c) =>
          bulkAction === "paid"
            ? canBulkMarkPaid(c.status)
            : canBulkMarkUnpaid(c.status),
        )
        .map((c) => c.id),
    [visibleClaims, bulkAction],
  );
  const reviewBulkTargetIds = useMemo(
    () =>
      visibleClaims
        .filter((c) => {
          if (reviewAction === "approved") return c.status === "pending";
          return (
            c.status === "pending" ||
            c.status === "approved" ||
            c.status === "unpaid"
          );
        })
        .map((c) => c.id),
    [visibleClaims, reviewAction],
  );
  const bulkTargetIds = showFinance ? financeBulkTargetIds : reviewBulkTargetIds;
  /** All rows that show a checkbox — header selects these together. */
  const selectableIds = useMemo(
    () =>
      showFinance
        ? visibleClaims
            .filter((c) => isPayableStatus(c.status) || c.status === "paid")
            .map((c) => c.id)
        : visibleClaims
            .filter(
              (c) =>
                c.status === "pending" ||
                c.status === "approved" ||
                c.status === "unpaid",
            )
            .map((c) => c.id),
    [showFinance, visibleClaims],
  );
  const allSelectableSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.includes(id));
  const someSelectableSelected =
    selectableIds.some((id) => selectedIds.includes(id)) &&
    !allSelectableSelected;
  const allBulkTargetsSelected =
    bulkTargetIds.length > 0 &&
    bulkTargetIds.every((id) => selectedIds.includes(id));
  const selectedForBulk = useMemo(() => {
    const set = new Set(selectedIds);
    return visibleClaims.filter((c) => {
      if (!set.has(c.id)) return false;
      if (showFinance) {
        return bulkAction === "paid"
          ? canBulkMarkPaid(c.status)
          : canBulkMarkUnpaid(c.status);
      }
      if (reviewAction === "approved") return c.status === "pending";
      return (
        c.status === "pending" ||
        c.status === "approved" ||
        c.status === "unpaid"
      );
    });
  }, [selectedIds, visibleClaims, showFinance, bulkAction, reviewAction]);
  const selectedBulkCount = selectedForBulk.length;
  const selectedBulkAmount = useMemo(
    () => selectedForBulk.reduce((sum, c) => sum + Number(c.amount || 0), 0),
    [selectedForBulk],
  );
  const anySelectedCount = selectedIds.length;
  const applyEnabled = selectedBulkCount > 0 && !bulkPaying;
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableSelected;
    }
  }, [someSelectableSelected]);

  function toggleSelectAllForBulk(checked: boolean) {
    setSelectedIds(checked ? [...bulkTargetIds] : []);
  }

  function toggleSelectAllRows(checked: boolean) {
    setSelectedIds(checked ? [...selectableIds] : []);
  }

  const activePkg =
    medicalBalances?.ipd?.medical_package ||
    medicalBalances?.opd?.medical_package ||
    balance?.medical_package ||
    null;
  const pkgLabel = activePkg
    ? MEDICAL_PACKAGES.find((p) => p.id === activePkg)?.label || activePkg
    : "—";

  return (
    <LayoutDashboard>
      <div className={`${fh.page} claimsPageCritical`}>
        <header className={fh.topBar}>
          <div className={fh.topLeft}>
            <p className={fh.eyebrow}>
              <span className={fh.eyebrowDot} aria-hidden />
              Interact Claims
            </p>
            <h1 className={fh.heroTitle}>
              {!roleReady
                ? "Claims"
                : showFinance
                  ? "Claims payment"
                  : "Claims management"}
            </h1>
            <p className={fh.heroSub}>
              {!roleReady
                ? "Loading your claims view…"
                : showFinance
                  ? "Select claims, choose Paid or Unpaid, then apply in one step."
                  : "Add claims, approve or reject — Finance marks Paid in one step."}
            </p>
          </div>
          <div className={fh.topRight}>
            <label className={fh.yearChip}>
              <span>Year</span>
              <select
                className={fh.yearSelect}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                aria-label="Claim year"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className={fh.metricStrip}>
          {!roleReady ? (
            <>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>Loading</div>
                <div className={fh.metricValue}>…</div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>—</div>
                <div className={fh.metricValue}>—</div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>—</div>
                <div className={fh.metricValue}>—</div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>—</div>
                <div className={fh.metricValue}>—</div>
              </div>
            </>
          ) : showFinance ? (
            <>
              <div className={`${fh.metric} ${fh.metricAccent}`}>
                <div className={fh.metricLabel}>Ready to pay</div>
                <div className={fh.metricValue}>{readyToPayCount}</div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>Pending</div>
                <div className={fh.metricValue}>{pendingCount}</div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>Approved amount</div>
                <div className={fh.metricValue}>
                  {money(summary?.total_approved_amount ?? 0)}
                </div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>Pending amount</div>
                <div className={fh.metricValue}>
                  {money(summary?.total_pending_amount ?? 0)}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={`${fh.metric} ${fh.metricAccent}`}>
                <div className={fh.metricLabel}>Pending</div>
                <div className={fh.metricValue}>{pendingCount}</div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>Ready for finance</div>
                <div className={fh.metricValue}>{readyToPayCount}</div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>Approved amount</div>
                <div className={fh.metricValue}>
                  {money(summary?.total_approved_amount ?? 0)}
                </div>
              </div>
              <div className={fh.metric}>
                <div className={fh.metricLabel}>Pending amount</div>
                <div className={fh.metricValue}>
                  {money(summary?.total_pending_amount ?? 0)}
                </div>
              </div>
            </>
          )}
        </div>

        {roleReady && !showFinance ? (
        <div className={`${fh.panel} ${fh.panelOverflow}`}>
          <div className={fh.panelHead}>
            <div className={fh.panelHeadLeft}>
              <h2 className={fh.panelTitle}>Add claim</h2>
              <p className={fh.panelHint}>
                Search employee, set amount & status, then save — OPD 150k · IPD
                Silver 30k / Gold 40k / Platinum 50k
              </p>
            </div>
          </div>
          <div className={fh.panelBody}>
          <form onSubmit={onSaveClaim}>
            <div className={fh.formGrid}>
              <div
                className={fh.field}
                ref={empPickerRef}
                style={{ position: "relative", zIndex: empPickerOpen ? 90 : 1 }}
              >
                <span className={fh.label}>Employee</span>
                <input
                  className={fh.input}
                  value={
                    empPickerOpen
                      ? empPickerQuery
                      : selectedEmployee
                        ? `${fullName(selectedEmployee) || `Employee ${selectedEmployee.id}`}${
                            selectedEmployee.pseudonym
                              ? ` (${selectedEmployee.pseudonym})`
                              : ""
                          }`
                        : empPickerQuery
                  }
                  onChange={(e) => {
                    setEmpPickerQuery(e.target.value);
                    setEmpPickerOpen(true);
                    if (formEmployeeId) setFormEmployeeId("");
                  }}
                  onFocus={() => {
                    setEmpPickerOpen(true);
                    if (selectedEmployee) setEmpPickerQuery("");
                  }}
                  placeholder={
                    employeesLoading
                      ? "Loading employees…"
                      : "Search by name or pseudo…"
                  }
                  autoComplete="off"
                  required={!formEmployeeId}
                />
                {formEmployeeId ? (
                  <button
                    type="button"
                    onClick={clearEmployee}
                    className={fh.clearEmpBtn}
                    aria-label="Clear employee"
                  >
                    ×
                  </button>
                ) : null}
                {empPickerOpen ? (
                  <div role="listbox" className={fh.pickerMenu}>
                    {employeesLoading ? (
                      <div className={fh.muted} style={{ padding: "10px 12px" }}>
                        Loading employees…
                      </div>
                    ) : filteredEmployeeOptions.length === 0 ? (
                      <div className={fh.muted} style={{ padding: "10px 12px" }}>
                        {employees.length === 0
                          ? "No employees found"
                          : "No match — try name or pseudo"}
                      </div>
                    ) : (
                      filteredEmployeeOptions.slice(0, 80).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          role="option"
                          className={fh.pickerItem}
                          onClick={() => pickEmployee(e)}
                          style={{
                            background:
                              String(e.id) === formEmployeeId
                                ? "#f0fdfa"
                                : undefined,
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>
                            {fullName(e) || `Employee ${e.id}`}
                            {e.pseudonym ? (
                              <span className={fh.pickerPseudo}>
                                {" "}
                                · {e.pseudonym}
                              </span>
                            ) : null}
                          </div>
                          <div className={fh.muted}>
                            ID {e.id}
                            {e.department_name ? ` · ${e.department_name}` : ""}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              <label className={fh.field}>
                <span className={fh.label}>Type</span>
                <select
                  className={fh.select}
                  value={formType === "ipd" ? "ipd" : "opd"}
                  onChange={(e) => setFormType(e.target.value)}
                >
                  <option value="opd">OPD</option>
                  <option value="ipd">IPD</option>
                </select>
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Amount</span>
                <input
                  className={fh.input}
                  type="number"
                  min={1}
                  step="0.01"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0"
                  required
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Claim date</span>
                <input
                  className={fh.input}
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  required
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Status</span>
                <select
                  className={fh.select}
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value)}
                  required
                >
                  <option value="">Select status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                </select>
              </label>
            </div>

            <div className={fh.formGridSecondary}>
              <label className={fh.field}>
                <span className={fh.label}>Title / reason</span>
                <input
                  className={fh.input}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Lab tests, pharmacy"
                />
              </label>
              <label className={fh.field}>
                <span className={fh.label}>Notes</span>
                <input
                  className={fh.input}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <button type="submit" className={fh.addBtn} disabled={saving}>
                {saving ? "Saving…" : "Add claim"}
              </button>
            </div>
          </form>

          {formEmployeeId ? (
            <div className={fh.selectedBar}>
              <div className={fh.selectedText}>
                {balanceLoading
                  ? "Loading balance…"
                  : medicalBalances
                    ? (
                      <>
                        Package <strong>{pkgLabel}</strong>
                        {" · "}OPD remaining{" "}
                        <strong
                          className={
                            medicalBalances.opd.remaining <= 0
                              ? fh.balanceBad
                              : fh.balanceOk
                          }
                        >
                          {money(medicalBalances.opd.remaining)}
                        </strong>
                        <span style={{ opacity: 0.75 }}>
                          {" "}
                          / {money(medicalBalances.opd.entitlement)}
                        </span>
                        {" · "}IPD remaining{" "}
                        <strong
                          className={
                            medicalBalances.ipd.remaining <= 0
                              ? fh.balanceBad
                              : fh.balanceOk
                          }
                        >
                          {money(medicalBalances.ipd.remaining)}
                        </strong>
                        <span style={{ opacity: 0.75 }}>
                          {" "}
                          / {money(medicalBalances.ipd.entitlement)}
                        </span>
                        {formType === "opd" || formType === "ipd" ? (
                          <>
                            {" · "}Selected {claimTypeLabel(formType)} used{" "}
                            <strong>{money(balance?.used ?? 0)}</strong>
                          </>
                        ) : null}
                        {!medicalBalances.ipd.medical_package &&
                        formType === "ipd" ? (
                          <span style={{ fontWeight: 500, opacity: 0.85 }}>
                            {" "}
                            (no package on salary — IPD entitlement is 0)
                          </span>
                        ) : null}
                      </>
                    )
                    : balance
                      ? (
                        <>
                          Package <strong>{pkgLabel}</strong>
                          {" · "}Entitlement{" "}
                          <strong>{money(balance.entitlement)}</strong>
                          {" · "}Remaining{" "}
                          <strong
                            className={
                              balance.remaining <= 0
                                ? fh.balanceBad
                                : fh.balanceOk
                            }
                          >
                            {money(balance.remaining)}
                          </strong>
                        </>
                      )
                      : (
                        <span className={fh.balanceBad}>
                          {balanceError || "Balance unavailable"}
                        </span>
                      )}
              </div>
            </div>
          ) : null}
          </div>
        </div>
        ) : null}

        {toast ? <p className={fh.toast}>{toast}</p> : null}

        {!roleReady ? (
          <div className={fh.panel}>
            <div className={fh.panelBody}>
              <p className={fh.loading}>Loading claims…</p>
            </div>
          </div>
        ) : (
        <div className={fh.panel}>
          <div className={fh.panelHead}>
            <div className={fh.panelHeadLeft}>
              <h2 className={fh.panelTitle}>
                {showFinance ? "Claims to pay" : "Claims to review"}
              </h2>
              <p className={fh.panelHint}>
                {showFinance
                  ? "Filter, select, then mark Paid or Unpaid"
                  : "Filter, approve or reject — then Finance marks paid"}
              </p>
            </div>
            <button type="button" className={fh.clearBtn} onClick={() => void loadClaims()}>
              {loading ? "…" : "Refresh"}
            </button>
          </div>
          <div className={fh.panelBody}>
          <div className={fh.filters}>
            <label className={fh.field}>
              <span className={fh.label}>Search</span>
              <input
                className={fh.input}
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="Name, pseudo, dept…"
              />
            </label>
            <label className={fh.field}>
              <span className={fh.label}>Status</span>
              <select
                className={fh.select}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="approved">Approved</option>
                <option value="unpaid">Unpaid</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                {roleReady && !showFinance ? (
                  <option value="rejected">Rejected</option>
                ) : null}
              </select>
            </label>
            <label className={fh.field}>
              <span className={fh.label}>Type</span>
              <select
                className={fh.select}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="opd">OPD</option>
                <option value="ipd">IPD</option>
              </select>
            </label>
            <div />
          </div>

          {error ? <p className={fh.error}>{error}</p> : null}

          <div className={fh.bulkBar}>
            <div className={fh.selectedText}>
              {showFinance
                ? selectedBulkCount > 0
                  ? `${selectedBulkCount} selected · ${money(selectedBulkAmount)} → ${
                      bulkAction === "paid" ? "Paid" : "Unpaid"
                    }`
                  : anySelectedCount > 0
                    ? bulkAction === "paid"
                      ? "Selected rows are already Paid — pick Mark as Unpaid, or select Approved/Unpaid"
                      : "Select Paid or Approved rows to mark Unpaid"
                    : bulkTargetIds.length > 0
                      ? bulkAction === "paid"
                        ? `${bulkTargetIds.length} ready — select, then Apply Paid`
                        : `${bulkTargetIds.length} can mark unpaid — select, then Apply`
                      : "No claims available for this action"
                : selectedBulkCount > 0
                  ? `${selectedBulkCount} selected · ${money(selectedBulkAmount)} → ${
                      reviewAction === "approved" ? "Approved" : "Rejected"
                    }`
                  : anySelectedCount > 0
                    ? reviewAction === "approved"
                      ? "Selected rows are not Pending — pick Mark as Rejected, or select Pending"
                      : "Select Pending/Approved rows to reject"
                    : bulkTargetIds.length > 0
                      ? reviewAction === "approved"
                        ? `${bulkTargetIds.length} pending — select, then Apply Approve`
                        : `${bulkTargetIds.length} can reject — select, then Apply`
                      : "No claims available for this action"}
            </div>
            <div className={fh.bulkActions}>
              {bulkTargetIds.length > 0 ? (
                <button
                  type="button"
                  className={fh.ghostBtn}
                  disabled={bulkPaying}
                  onClick={() => toggleSelectAllForBulk(!allBulkTargetsSelected)}
                >
                  {allBulkTargetsSelected
                    ? "Clear selection"
                    : showFinance
                      ? bulkAction === "paid"
                        ? "Select all ready"
                        : "Select all for unpaid"
                      : reviewAction === "approved"
                        ? "Select all pending"
                        : "Select all for reject"}
                </button>
              ) : null}
              {anySelectedCount > 0 ? (
                <button
                  type="button"
                  className={fh.ghostBtn}
                  disabled={bulkPaying}
                  onClick={() => setSelectedIds([])}
                >
                  Clear
                </button>
              ) : null}
              {showFinance ? (
                <select
                  className={fh.bulkSelect}
                  value={bulkAction}
                  disabled={bulkPaying}
                  onChange={(e) => {
                    setBulkAction(e.target.value === "unpaid" ? "unpaid" : "paid");
                  }}
                  aria-label="Payment action"
                >
                  <option value="paid">Mark as Paid</option>
                  <option value="unpaid">Mark as Unpaid</option>
                </select>
              ) : (
                <select
                  className={fh.bulkSelect}
                  value={reviewAction}
                  disabled={bulkPaying}
                  onChange={(e) => {
                    setReviewAction(
                      e.target.value === "rejected" ? "rejected" : "approved",
                    );
                  }}
                  aria-label="Review action"
                >
                  <option value="approved">Mark as Approved</option>
                  <option value="rejected">Mark as Rejected</option>
                </select>
              )}
              <button
                type="button"
                className={
                  showFinance
                    ? bulkAction === "paid"
                      ? fh.primaryBtn
                      : fh.primaryBtnDark
                    : reviewAction === "approved"
                      ? fh.primaryBtn
                      : fh.primaryBtnDark
                }
                style={{
                  opacity: applyEnabled ? 1 : 0.55,
                  cursor: applyEnabled ? "pointer" : "not-allowed",
                }}
                disabled={!applyEnabled}
                onClick={() =>
                  void (showFinance
                    ? applyBulkPaymentAction()
                    : applyBulkReviewAction())
                }
              >
                {bulkPaying
                  ? "Saving…"
                  : selectedBulkCount > 0
                    ? `Apply ${selectedBulkCount}`
                    : "Apply"}
              </button>
            </div>
          </div>

          <div className={fh.tableWrap}>
            <table className={fh.table}>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={allSelectableSelected}
                      disabled={selectableIds.length === 0 || bulkPaying}
                      onChange={(e) => toggleSelectAllRows(e.target.checked)}
                    />
                  </th>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Pseudo</th>
                  <th>Dept</th>
                  <th>Type</th>
                  {!showFinance ? <th>Title</th> : null}
                  <th>Amount</th>
                  <th>HR status</th>
                  <th>Finance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleClaims.length === 0 ? (
                  <tr>
                    <td colSpan={showFinance ? 10 : 11} className={fh.empty}>
                      {loading
                        ? "Loading…"
                        : showFinance
                          ? "No pending or approved claims to pay."
                          : "No claims yet. Add one above."}
                    </td>
                  </tr>
                ) : (
                  visibleClaims.map((c) => {
                    const canSelect = showFinance
                      ? isPayableStatus(c.status) || c.status === "paid"
                      : c.status === "pending" ||
                        c.status === "approved" ||
                        c.status === "unpaid";
                    const isSelected = selectedIds.includes(c.id);
                    const hr = hrStatusOf(c.status);
                    const fin = financeStatusOf(c.status);
                    return (
                    <tr
                      key={c.id}
                      className={isSelected ? fh.rowSelected : undefined}
                    >
                      <td>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            aria-label={`Select claim ${c.id}`}
                            checked={isSelected}
                            disabled={bulkPaying}
                            onChange={(e) =>
                              toggleSelectClaim(c.id, e.target.checked)
                            }
                          />
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>—</span>
                        )}
                      </td>
                      <td>{c.claim_date}</td>
                      <td>
                        <strong>
                          {c.employee_name || `Employee ${c.employee_id}`}
                        </strong>
                      </td>
                      <td>{c.pseudonym || "—"}</td>
                      <td>{c.department_name || "—"}</td>
                      <td>{claimTypeLabel(c.claim_type)}</td>
                      {!showFinance ? <td>{c.title || "—"}</td> : null}
                      <td>
                        <strong>{money(c.amount)}</strong>
                      </td>
                      <td>
                        <span className={`${fh.statusPill} ${hr.className}`}>
                          {hr.label}
                        </span>
                      </td>
                      <td>
                        {fin.label === "—" ? (
                          <span className={fh.muted}>—</span>
                        ) : (
                          <span className={`${fh.statusPill} ${fin.className}`}>
                            {fin.label}
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {showFinance ? (
                            isPayableStatus(c.status) ? (
                              <button
                                type="button"
                                className={fh.actionPaid}
                                disabled={payingId === c.id || bulkPaying}
                                onClick={() => void setClaimStatus(c.id, "paid")}
                              >
                                {payingId === c.id ? "Saving…" : "Mark as Paid"}
                              </button>
                            ) : c.status === "pending" ? (
                              <span className={fh.muted}>
                                Waiting for approval
                              </span>
                            ) : c.status === "paid" ? (
                              <button
                                type="button"
                                className={fh.actionUnpaid}
                                disabled={payingId === c.id || bulkPaying}
                                onClick={() => void setClaimStatus(c.id, "unpaid")}
                              >
                                {payingId === c.id ? "Saving…" : "Mark as Unpaid"}
                              </button>
                            ) : null
                          ) : (
                            <>
                              {c.status === "pending" ? (
                                <button
                                  type="button"
                                  className={fh.actionApprove}
                                  disabled={payingId === c.id}
                                  onClick={() => void setClaimStatus(c.id, "approved")}
                                >
                                  {payingId === c.id ? "Saving…" : "Approve"}
                                </button>
                              ) : null}
                              {/* Mark paid is Finance-only — HR/Admin approve/reject only */}
                              {isPayableStatus(c.status) ? (
                                <span className={fh.muted}>Waiting for Finance</span>
                              ) : null}
                              {c.status !== "rejected" &&
                              c.status !== "cancelled" &&
                              c.status !== "paid" ? (
                                <button
                                  type="button"
                                  className={fh.actionReject}
                                  disabled={payingId === c.id}
                                  onClick={() => void setClaimStatus(c.id, "rejected")}
                                >
                                  Reject
                                </button>
                              ) : null}
                            </>
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
        </div>
        )}
      </div>
    </LayoutDashboard>
  );
}
