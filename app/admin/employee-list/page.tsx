"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import leaveStyles from "../../leave/leave.module.css";
import adminStyles from "../admin-page.module.css";
import {
  FaUserEdit,
  FaTrash,
  FaToggleOn,
  FaToggleOff,
  FaFileExcel,
} from "react-icons/fa";
import Modal from "react-modal";
import AddEmployeeForm from "../../add-employee/AddEmployeeForm";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";
import { showAppConfirm } from "@/lib/app-confirm";

type ExtraColumn = {
  key: string;
  label: string;
  field: string;
  format?: "date" | "salary";
  width?: number;
  wrap?: boolean;
};

const EXTRA_COLUMNS: ExtraColumn[] = [
  { key: "phone", label: "Phone #", field: "phone_mobile", width: 90 },
  { key: "personalEmail", label: "Personal Email", field: "email_other", width: 120 },
  { key: "professionalEmail", label: "Professional Email", field: "email_work", width: 120 },
  { key: "jobTitle", label: "Job Title/Designation", field: "job_title", width: 140 },
  { key: "fatherName", label: "Father Name", field: "father_name", width: 130 },
  { key: "dob", label: "Date of Birth", field: "dob", format: "date", width: 110 },
  { key: "cnic", label: "CNIC Number", field: "cnic_number", width: 130 },
  { key: "cnicIssuance", label: "Date of Issuance", field: "cnic_issuance_date", format: "date", width: 120 },
  { key: "cnicExpiry", label: "Date of Expiry of CNIC", field: "cnic_expiry_date", format: "date", width: 130 },
  { key: "presentAddress", label: "Present Address", field: "present_address", width: 280, wrap: true },
  { key: "permanentAddress", label: "Permanent Address", field: "permanent_address", width: 280, wrap: true },
  { key: "basicSalary", label: "Basic Salary", field: "basic_salary", format: "salary", width: 110 },
  { key: "bankName", label: "Bank Name", field: "bank_name", width: 140 },
  { key: "accountNumber", label: "Account Number", field: "account_number", width: 150 },
  { key: "fuelAllowance", label: "Fuel Allowance", field: "fuel_allowance", format: "salary", width: 120 },
  { key: "emergencyPhone", label: "Emergency Contact Number", field: "emergency_phone", width: 150 },
  { key: "bloodGroup", label: "Blood Group", field: "blood_group", width: 90 },
];

function emptyExtraVisibility(): Record<string, boolean> {
  return Object.fromEntries(EXTRA_COLUMNS.map((col) => [col.key, false]));
}

function formatListDate(value: unknown) {
  if (value == null || value === "") return "-";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  // Calendar dates only — do not slice YYYY-MM-DD off an ISO UTC timestamp
  // (e.g. 2000-01-18 PK becomes 2000-01-17T19:00:00.000Z).
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatListSalary(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "-";
  return amount.toLocaleString();
}

function extraColumnValue(employee: any, col: ExtraColumn) {
  if (col.format === "date") return formatListDate(employee[col.field]);
  if (col.format === "salary") return formatListSalary(employee[col.field]);
  const value = employee[col.field];
  return value == null || String(value).trim() === "" ? "-" : String(value);
}

export default function EmployeeListStyledPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [columnsMenuPos, setColumnsMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [visibleExtras, setVisibleExtras] = useState<Record<string, boolean>>(() => emptyExtraVisibility());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [salaryTplBusy, setSalaryTplBusy] = useState(false);
  const [salaryUploading, setSalaryUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const salaryUploadInputRef = useRef<HTMLInputElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const columnsBtnRef = useRef<HTMLButtonElement | null>(null);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  const placeColumnsMenu = () => {
    const btn = columnsBtnRef.current;
    if (!btn || typeof window === "undefined") return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 260;
    const gap = 8;
    const pad = 12;
    let left = rect.left;
    // Keep full menu inside viewport (no left/right clip)
    left = Math.min(left, window.innerWidth - menuWidth - pad);
    left = Math.max(pad, left);
    const top = rect.bottom + gap;
    setColumnsMenuPos({ top, left });
  };

  const toggleColumnsMenu = () => {
    setDropdownOpen((open) => {
      const next = !open;
      if (next) {
        // Defer measure so button ref is painted with open state
        requestAnimationFrame(() => placeColumnsMenu());
      } else {
        setColumnsMenuPos(null);
      }
      return next;
    });
  };

  useEffect(() => {
    Modal.setAppElement("body");
  }, []);

  const refreshEmployees = () => {
    const viewerId =
      typeof window !== "undefined"
        ? String(localStorage.getItem("employeeId") || "").trim()
        : "";
    const qs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
    fetch(`/api/employee-list${qs}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setEmployees(data.employees);
          setError("");
        } else {
          setError(data.error || "Failed to fetch employees");
        }
      })
      .catch(() => {
        setError("Failed to fetch employees");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    refreshEmployees();
  }, []);

  const handleExportList = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      toastError("Select at least one employee to export.");
      return;
    }
    try {
      setExporting(true);
      const res = await fetch(`/api/employee-import?export=1&ids=${ids.join(",")}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toastError(data.error || "Could not export employees");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "employee-list-export.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError("Export failed: " + String(err));
    } finally {
      setExporting(false);
    }
  };

  const handleImportList = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("source", "employee-list");
      const res = await fetch("/api/employee-import", { method: "POST", body });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Import failed");
        return;
      }
      const s = data.summary || { inserted: 0, updated: 0, skipped: 0, failed: 0 };
      const failedRows = (data.results || [])
        .filter((r: any) => r.status === "failed" || r.status === "skipped")
        .slice(0, 8)
        .map((r: any) => `Row ${r.row}: ${r.reason || r.status}`)
        .join("\n");
      if (s.updated || s.inserted) {
        toastSuccess(
          `Updated ${s.updated || 0}, created ${s.inserted || 0}. Skipped ${s.skipped || 0}, failed ${s.failed || 0}.`
        );
        refreshEmployees();
      } else {
        toastInfo(
          `No employees changed. Skipped ${s.skipped || 0}, failed ${s.failed || 0}.${
            failedRows ? ` ${failedRows}` : ""
          }`
        );
      }
      if ((s.skipped || 0) + (s.failed || 0) > 0 && (s.updated || s.inserted)) {
        toastInfo(failedRows || `${s.skipped} skipped, ${s.failed} failed.`);
      }
    } catch (err) {
      toastError("Import failed: " + String(err));
    } finally {
      setImporting(false);
    }
  };

  const viewerHeaders = (): HeadersInit => {
    const viewerId =
      typeof window !== "undefined"
        ? String(localStorage.getItem("employeeId") || "").trim()
        : "";
    if (!viewerId) return {};
    return {
      "x-hrm-employee-id": viewerId,
      "x-employee-id": viewerId,
    };
  };

  const handleDownloadSalaryTemplate = async () => {
    try {
      setSalaryTplBusy(true);
      const viewerId =
        typeof window !== "undefined"
          ? String(localStorage.getItem("employeeId") || "").trim()
          : "";
      const qs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
      const res = await fetch(`/api/employee_salaries/download-template${qs}`, {
        headers: viewerHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toastError(data.error || "Could not download salary template");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "employee-salary-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toastSuccess("Salary template downloaded. Existing salaries are filled in.");
    } catch (err) {
      toastError("Salary template download failed: " + String(err));
    } finally {
      setSalaryTplBusy(false);
    }
  };

  const handleUploadSalaryTemplate = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSalaryUploading(true);
    try {
      const viewerId =
        typeof window !== "undefined"
          ? String(localStorage.getItem("employeeId") || "").trim()
          : "";
      const body = new FormData();
      body.append("file", file);
      if (viewerId) body.append("viewerId", viewerId);
      const res = await fetch("/api/employee_salaries/upload-template", {
        method: "POST",
        headers: viewerHeaders(),
        body,
      });
      const data = await res.json();
      if (!data.success) {
        toastError(data.error || "Salary upload failed");
        return;
      }
      const s = data.summary || { inserted: 0, updated: 0, skipped: 0, failed: 0 };
      const errPreview = (data.errors || []).slice(0, 5).join(" · ");
      if (s.updated || s.inserted) {
        toastSuccess(
          `Salaries: updated ${s.updated || 0}, added ${s.inserted || 0}. Skipped ${s.skipped || 0}, failed ${s.failed || 0}.`,
        );
        refreshEmployees();
      } else {
        toastInfo(
          `No salaries changed. Skipped ${s.skipped || 0}, failed ${s.failed || 0}.${
            errPreview ? ` ${errPreview}` : ""
          }`,
        );
      }
      if ((s.failed || 0) > 0 && (s.updated || s.inserted) && errPreview) {
        toastInfo(errPreview);
      }
    } catch (err) {
      toastError("Salary upload failed: " + String(err));
    } finally {
      setSalaryUploading(false);
    }
  };

  const handleStatusToggle = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "enabled" || currentStatus === "active" ? "inactive" : "active";

    // Optimistic UI update
    setEmployees((prev) =>
      prev.map((employee) =>
        employee.id === id ? { ...employee, status: newStatus } : employee
      )
    );

    const res = await fetch("/api/employee-list", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus }),
    });

    const data = await res.json();

    if (!data.success) {
      // Revert on API failure
      setEmployees((prev) =>
        prev.map((employee) =>
          employee.id === id ? { ...employee, status: currentStatus } : employee
        )
      );
      toastError("Status update failed: " + (data.error || "Unknown error"));
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await showAppConfirm({
      message: "Are you sure you want to delete this employee?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;

    const res = await fetch("/api/employee-list", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const data = await res.json();

    if (data.success) {
      setEmployees((prev) => prev.filter((employee) => employee.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      toastError("Delete failed: " + (data.error || "Unknown error"));
    }
  };

  const getNormalizedStatus = (status: string) => {
    return status === "active" || status === "enabled" ? "active" : "inactive";
  };

  const getEmployeeFullName = (employee: any) => {
    return [employee.first_name, employee.middle_name, employee.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
  };

  const uniqueDepartments = useMemo(() => {
    const depts = employees
      .map((e) => e.department_name)
      .filter((d): d is string => Boolean(d));
    return Array.from(new Set(depts)).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    const searchLower = search.toLowerCase();

    const searchFiltered = employees.filter((employee) => {
      if (!search) return true;
      const empId = (employee.employee_code || employee.id || "").toString();
      const fullName = getEmployeeFullName(employee).toLowerCase();
      const pseudo = (employee.pseudonym || "").toLowerCase();

      return fullName.includes(searchLower) || empId.includes(searchLower) || pseudo.includes(searchLower);
    });

    const statusFiltered = searchFiltered.filter((employee) => {
      if (statusFilter === "all") return true;
      return getNormalizedStatus(employee.status) === statusFilter;
    });

    return statusFiltered.filter((employee) => {
      if (!departmentFilter) return true;
      return (employee.department_name || "") === departmentFilter;
    });
  }, [employees, search, statusFilter, departmentFilter]);

  const filteredIds = useMemo(
    () => filtered.map((employee) => Number(employee.id)).filter((id) => Number.isFinite(id) && id > 0),
    [filtered]
  );
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someFilteredSelected = filteredIds.some((id) => selectedIds.has(id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [someFilteredSelected, allFilteredSelected]);

  const toggleEmployeeSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredIds.forEach((id) => next.delete(id));
      } else {
        filteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  // Close dropdown on outside click; keep fixed menu under the Columns button on resize/scroll
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const menu = document.getElementById("dropdown-menu-actions");
      const dots = document.getElementById("dropdown-menu-dots");
      if (menu && !menu.contains(e.target as Node) && dots && !dots.contains(e.target as Node)) {
        setDropdownOpen(false);
        setColumnsMenuPos(null);
      }
    };
    const reposition = () => placeColumnsMenu();
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    placeColumnsMenu();
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [dropdownOpen]);

  const listStats = useMemo(() => {
    const scoped = departmentFilter
      ? employees.filter((e) => (e.department_name || "") === departmentFilter)
      : employees;
    const total = scoped.length;
    const active = scoped.filter((e) => getNormalizedStatus(e.status) === "active").length;
    const inactive = total - active;
    return {
      total,
      active,
      inactive,
      activePct: total ? Math.round((active / total) * 100) : 0,
      inactivePct: total ? Math.round((inactive / total) * 100) : 0,
    };
  }, [employees, departmentFilter]);

  const visibleExtraCols = EXTRA_COLUMNS.filter((col) => visibleExtras[col.key]);
  const extraColsVisible = visibleExtraCols.length > 0;
  const tableColSpan = 9 + visibleExtraCols.length;

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={styles.breakSummaryContainer}>
          <div className={adminStyles.pageHeader}>
            <div>
              <h1 className={adminStyles.pageHeaderTitle}>Employee List</h1>
              <p className={styles.mgmtAttMeta} style={{ marginTop: 4 }}>
                Showing {filtered.length} of {listStats.total} employee
                {listStats.total === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className={styles.listStatsRow}>
            <button
              type="button"
              className={`${styles.listStatCard} ${styles.listStatPurple} ${styles.listStatClickable} ${statusFilter === "all" ? styles.listStatSelected : ""}`}
              onClick={() => setStatusFilter("all")}
              title="Show all employees"
            >
              <span className={styles.listStatLabel}>All Employees</span>
              <span className={styles.listStatValue}>{listStats.total}</span>
              <span className={styles.listStatHint}>
                {departmentFilter
                  ? departmentFilter
                  : `${uniqueDepartments.length} department${uniqueDepartments.length === 1 ? "" : "s"}`}
              </span>
            </button>
            <button
              type="button"
              className={`${styles.listStatCard} ${styles.listStatGreen} ${styles.listStatClickable} ${statusFilter === "active" ? styles.listStatSelected : ""}`}
              onClick={() => setStatusFilter("active")}
              title="Show active employees"
            >
              <span className={styles.listStatLabel}>Active</span>
              <span className={styles.listStatValue}>{listStats.active}</span>
              <span className={styles.listStatHint}>
                {listStats.activePct}% of {departmentFilter || "workforce"}
              </span>
            </button>
            <button
              type="button"
              className={`${styles.listStatCard} ${styles.listStatRed} ${styles.listStatClickable} ${statusFilter === "inactive" ? styles.listStatSelected : ""}`}
              onClick={() => setStatusFilter("inactive")}
              title="Show inactive employees"
            >
              <span className={styles.listStatLabel}>Inactive</span>
              <span className={styles.listStatValue}>{listStats.inactive}</span>
              <span className={styles.listStatHint}>
                {listStats.inactivePct}% of {departmentFilter || "workforce"}
              </span>
            </button>
          </div>

          <div className={leaveStyles.toolbar}>
            <div className={leaveStyles.searchWrap}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className={leaveStyles.toolbarSearch}
                placeholder="Search by name, ID or P.Name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className={leaveStyles.toolbarSelect}
              aria-label="Filter by department"
            >
              <option value="">All Departments</option>
              {uniqueDepartments.map((dept) => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
              className={leaveStyles.toolbarSelect}
              aria-label="Filter by status"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <span className={styles.empListShowing}>Showing: {filtered.length}</span>
            <div className={styles.empListActions}>
              <div style={{ position: "relative", zIndex: 50 }}>
                <button
                  ref={columnsBtnRef}
                  id="dropdown-menu-dots"
                  type="button"
                  title="Show or hide columns"
                  aria-label="Show or hide columns"
                  aria-expanded={dropdownOpen}
                  onClick={toggleColumnsMenu}
                  className={`${styles.mgmtAttGhostBtn} ${dropdownOpen ? styles.empListColumnsActive : ""}`}
                >
                  Columns
                  {visibleExtraCols.length > 0 ? (
                    <span className={styles.empListColumnsCount}>{visibleExtraCols.length}</span>
                  ) : null}
                </button>
                {dropdownOpen && columnsMenuPos && (
                  <div
                    id="dropdown-menu-actions"
                    className={styles.empListColumnsMenu}
                    style={{ top: columnsMenuPos.top, left: columnsMenuPos.left }}
                  >
                    <div className={styles.empListColumnsMenuTitle}>SHOW COLUMNS</div>
                    {EXTRA_COLUMNS.map((col) => (
                      <label key={col.key} className={styles.empListColumnsItem}>
                        <input
                          type="checkbox"
                          checked={!!visibleExtras[col.key]}
                          onChange={() =>
                            setVisibleExtras((prev) => ({ ...prev, [col.key]: !prev[col.key] }))
                          }
                        />
                        <span>{col.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={styles.breakSummaryXLSButton}
                onClick={handleExportList}
                disabled={exporting || importing || salaryTplBusy || salaryUploading}
              >
                <FaFileExcel size={16} />
                <span>
                  {exporting
                    ? "Exporting…"
                    : selectedIds.size
                      ? `Export XLS (${selectedIds.size})`
                      : "Export XLS"}
                </span>
              </button>
              <button
                type="button"
                className={adminStyles.btnGreen}
                onClick={() => importInputRef.current?.click()}
                disabled={exporting || importing || salaryTplBusy || salaryUploading}
              >
                {importing ? "Importing…" : "Import XLS"}
              </button>
              <button
                type="button"
                title="Download Excel with Employee ID, Name, Pseudo Name, and current Basic Salary"
                className={styles.mgmtAttGhostBtn}
                onClick={handleDownloadSalaryTemplate}
                disabled={exporting || importing || salaryTplBusy || salaryUploading}
              >
                {salaryTplBusy ? "Preparing…" : "Salary Template"}
              </button>
              <button
                type="button"
                title="Upload filled salary template to add or update basic salaries"
                className={styles.mgmtAttGhostBtn}
                onClick={() => salaryUploadInputRef.current?.click()}
                disabled={exporting || importing || salaryTplBusy || salaryUploading}
              >
                {salaryUploading ? "Uploading…" : "Upload Salaries"}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={handleImportList}
              />
              <input
                ref={salaryUploadInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={handleUploadSalaryTemplate}
              />
            </div>
          </div>

          <div className={leaveStyles.reqTableShell}>
            <div
              className={styles.mgmtAttScroll}
              style={{
                overflowX: extraColsVisible ? "auto" : "hidden",
              }}
            >
              <table
                className={`${leaveStyles.reqTable} ${styles.empListTableFit}`}
                style={{
                  minWidth: extraColsVisible ? 900 : undefined,
                  width: extraColsVisible ? "max-content" : "100%",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ width: 42, minWidth: 42, textAlign: "center" }}>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAllFiltered}
                        disabled={filteredIds.length === 0}
                        title="Select all in this list"
                        className={styles.empListCheck}
                      />
                    </th>
                    <th>ID</th>
                    <th>Full Name</th>
                    <th>P.Name</th>
                    <th>Department</th>
                    <th>Gender</th>
                    <th>Nationality</th>
                    <th>Status</th>
                    {visibleExtraCols.map((col) => (
                      <th
                        key={col.key}
                        style={{
                          minWidth: col.width || 120,
                          width: col.width || 120,
                          whiteSpace: col.wrap ? "normal" : "nowrap",
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={tableColSpan} className={leaveStyles.reqEmpty}>
                        Loading…
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={tableColSpan} className={leaveStyles.reqEmpty} style={{ color: "#b91c1c" }}>
                        {error}
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={tableColSpan} className={leaveStyles.reqEmpty}>
                        No records found.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((employee) => (
                      <tr key={employee.id}>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(Number(employee.id))}
                            onChange={() => toggleEmployeeSelected(Number(employee.id))}
                            className={styles.empListCheck}
                          />
                        </td>
                        <td className={leaveStyles.reqId}>{employee.id}</td>
                        <td>
                          <EmployeeTableNameCell
                            name={getEmployeeFullName(employee)}
                            employeeId={employee.id}
                            photo={getPhoto(employee.id)}
                            onOpen={() =>
                              openFromRow({
                                employee_id: employee.id,
                                employee_name: getEmployeeFullName(employee),
                                first_name: employee.first_name,
                                middle_name: employee.middle_name,
                                last_name: employee.last_name,
                                pseudonym: employee.pseudonym,
                                department_name: employee.department_name,
                                email: employee.professional_email || employee.email_work,
                              })
                            }
                          />
                        </td>
                        <td>{employee.pseudonym || "-"}</td>
                        <td>{employee.department_name || "-"}</td>
                        <td>
                          {employee.gender
                            ? employee.gender.charAt(0).toUpperCase() +
                              employee.gender.slice(1).toLowerCase()
                            : "-"}
                        </td>
                        <td>{employee.nationality || "-"}</td>
                        <td>
                          <span
                            className={
                              employee.status === "active" || employee.status === "enabled"
                                ? styles.empListStatusActive
                                : styles.empListStatusInactive
                            }
                          >
                            {employee.status === "active" || employee.status === "enabled"
                              ? "Active"
                              : "Inactive"}
                          </span>
                        </td>
                        {visibleExtraCols.map((col) => (
                          <td
                            key={col.key}
                            title={extraColumnValue(employee, col)}
                            style={
                              col.wrap
                                ? {
                                    minWidth: col.width || 280,
                                    width: col.width || 280,
                                    whiteSpace: "normal",
                                    wordBreak: "break-word",
                                    overflowWrap: "anywhere",
                                    lineHeight: 1.35,
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                  }
                                : {
                                    maxWidth: col.width || 120,
                                    width: col.width || 120,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }
                            }
                          >
                            {extraColumnValue(employee, col)}
                          </td>
                        ))}
                        <td>
                          <div className={styles.empListRowActions}>
                            <button
                              type="button"
                              title={
                                employee.status === "active" || employee.status === "enabled"
                                  ? "Set Inactive"
                                  : "Set Active"
                              }
                              className={styles.empListIconBtn}
                              style={{
                                color:
                                  employee.status === "active" || employee.status === "enabled"
                                    ? "#0f766e"
                                    : "#94a3b8",
                                fontSize: "1.25rem",
                              }}
                              onClick={() => handleStatusToggle(employee.id, employee.status)}
                            >
                              {employee.status === "active" || employee.status === "enabled" ? (
                                <FaToggleOn />
                              ) : (
                                <FaToggleOff />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Edit"
                              className={styles.empListIconBtn}
                              style={{ color: "#0f766e" }}
                              onClick={() => {
                                setModalOpen(true);
                                setSelectedEmployee(employee);
                              }}
                            >
                              <FaUserEdit />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              className={styles.empListIconBtn}
                              style={{ color: "#dc2626" }}
                              onClick={() => handleDelete(employee.id)}
                            >
                              <FaTrash />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <Modal
            isOpen={modalOpen}
            onRequestClose={() => {
              setModalOpen(false);
              setSelectedEmployee(null);
            }}
            contentLabel="Edit Employee"
            style={{
              overlay: { zIndex: 1000, background: "rgba(0,0,0,0.18)" },
              content: { maxWidth: 900, margin: "auto", borderRadius: 16, padding: 24 },
            }}
          >
            {selectedEmployee ? (
              <div>
                <AddEmployeeForm
                  edit={true}
                  employeeId={String(selectedEmployee.id)}
                  onClose={() => {
                    setModalOpen(false);
                    setSelectedEmployee(null);
                  }}
                  onSaved={() => {
                    setModalOpen(false);
                    setSelectedEmployee(null);
                    refreshEmployees();
                  }}
                />
              </div>
            ) : null}
          </Modal>
          {popup}
        </div>
      </div>
    </OptionalAdminShell>
  );
}
