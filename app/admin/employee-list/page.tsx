"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../break-summary/break-summary.module.css";
import {
  FaUserEdit,
  FaTrash,
  FaToggleOn,
  FaToggleOff,
  FaFilter,
  FaSort,
  FaSortUp,
  FaSortDown,
} from "react-icons/fa";
import Modal from "react-modal";
import AddEmployeeForm from "../../add-employee/AddEmployeeForm";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { toastError, toastInfo, toastSuccess } from "@/lib/app-toast";
import { showAppConfirm } from "@/lib/app-confirm";

type SortKey =
  | "id"
  | "fullName"
  | "pseudonym"
  | "department"
  | "gender"
  | "nationality"
  | "status";

type SortDirection = "asc" | "desc";

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
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [visibleExtras, setVisibleExtras] = useState<Record<string, boolean>>(() => emptyExtraVisibility());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    Modal.setAppElement("body");
  }, []);

  const refreshEmployees = () => {
    fetch("/api/employee-list")
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

  const handleSort = (key: SortKey) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) {
        return { key, direction: "asc" };
      }

      if (prev.direction === "asc") {
        return { key, direction: "desc" };
      }

      return null;
    });
  };

  const getSortIcon = (key: SortKey) => {
    if (!sortConfig || sortConfig.key !== key) {
      return <FaSort style={{ opacity: 0.75 }} />;
    }

    if (sortConfig.direction === "asc") {
      return <FaSortUp />;
    }

    return <FaSortDown />;
  };

  const getText = (value: unknown) => String(value || "").toLowerCase();

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

    const deptFiltered = statusFiltered.filter((employee) => {
      if (!departmentFilter) return true;
      return (employee.department_name || "") === departmentFilter;
    });

    if (!sortConfig) return deptFiltered;

    const sorted = [...deptFiltered].sort((a, b) => {
      let comparison = 0;

      switch (sortConfig.key) {
        case "id": {
          const aId = Number(a.id || 0);
          const bId = Number(b.id || 0);
          comparison = aId - bId;
          break;
        }
        case "fullName": {
          comparison = getEmployeeFullName(a).localeCompare(getEmployeeFullName(b), undefined, {
            sensitivity: "base",
          });
          break;
        }
        case "pseudonym": {
          comparison = getText(a.pseudonym).localeCompare(getText(b.pseudonym), undefined, {
            sensitivity: "base",
          });
          break;
        }
        case "department": {
          comparison = getText(a.department_name).localeCompare(getText(b.department_name), undefined, {
            sensitivity: "base",
          });
          break;
        }
        case "gender": {
          comparison = getText(a.gender).localeCompare(getText(b.gender), undefined, {
            sensitivity: "base",
          });
          break;
        }
        case "nationality": {
          comparison = getText(a.nationality).localeCompare(getText(b.nationality), undefined, {
            sensitivity: "base",
          });
          break;
        }
        case "status": {
          comparison = getNormalizedStatus(a.status).localeCompare(getNormalizedStatus(b.status), undefined, {
            sensitivity: "base",
          });
          break;
        }
        default:
          comparison = 0;
      }

      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [employees, search, statusFilter, departmentFilter, sortConfig]);

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

  const sortButtonStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    fontSize: "0.8rem",
  };

  const renderSortableHeader = (label: string, key: SortKey) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => handleSort(key)}
          style={sortButtonStyle}
          title={`Sort ${label}`}
          aria-label={`Sort ${label}`}
        >
          <FaFilter />
        </button>
        <span>{label}</span>
      </div>
      <button
        type="button"
        onClick={() => handleSort(key)}
        style={sortButtonStyle}
        title={`Toggle sort direction for ${label}`}
        aria-label={`Toggle sort direction for ${label}`}
      >
        {getSortIcon(key)}
      </button>
    </div>
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const menu = document.getElementById("dropdown-menu-actions");
      const dots = document.getElementById("dropdown-menu-dots");
      if (menu && !menu.contains(e.target as Node) && dots && !dots.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer}>
        <div className={styles.breakSummaryHeader}>Employee List</div>

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

        <div className={styles.breakSummaryFilters} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="text"
            placeholder="Search by name, ID or P.Name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 220 }}
          />
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className={styles.breakSummaryInput}
            style={{ width: 180 }}
          >
            <option value="">All Departments</option>
            {uniqueDepartments.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
          <div style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 600, color: statusFilter === 'active' ? '#38A169' : statusFilter === 'inactive' ? '#E53E3E' : '#0052CC', background: 'rgba(255,255,255,0.18)', borderRadius: 4, padding: '2px 10px', minWidth: 60, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            {`Showing: ${filtered.length}`}
          </div>
          <div style={{ marginLeft: 16, display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <div style={{ position: "relative" }}>
              <button
                id="dropdown-menu-dots"
                type="button"
                title="Show or hide columns"
                aria-label="Show or hide columns"
                aria-expanded={dropdownOpen}
                onClick={() => setDropdownOpen((open) => !open)}
                style={{
                  height: 38,
                  minWidth: 38,
                  padding: "0 12px",
                  background: dropdownOpen ? "#0052CC" : "#fff",
                  color: dropdownOpen ? "#fff" : "#0052CC",
                  border: `1.5px solid ${dropdownOpen ? "#0052CC" : "#c5d4e8"}`,
                  borderRadius: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  cursor: "pointer",
                  boxShadow: dropdownOpen ? "0 2px 8px rgba(0,82,204,0.22)" : "0 1px 3px rgba(15,23,42,0.06)",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <circle cx="8" cy="3.2" r="1.45" />
                  <circle cx="8" cy="8" r="1.45" />
                  <circle cx="8" cy="12.8" r="1.45" />
                </svg>
                Columns
                {visibleExtraCols.length > 0 && (
                  <span
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 999,
                      background: dropdownOpen ? "rgba(255,255,255,0.22)" : "#e8f0fc",
                      color: dropdownOpen ? "#fff" : "#0052CC",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {visibleExtraCols.length}
                  </span>
                )}
              </button>
              {dropdownOpen && (
                <div
                  id="dropdown-menu-actions"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    background: "#fff",
                    borderRadius: 12,
                    boxShadow: "0 10px 28px rgba(15,23,42,0.14)",
                    border: "1px solid #e2e8f0",
                    padding: "10px 8px 8px",
                    zIndex: 300,
                    minWidth: 248,
                    maxHeight: 360,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <div style={{ padding: "2px 10px 8px", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", letterSpacing: "0.04em" }}>
                    SHOW COLUMNS
                  </div>
                  {EXTRA_COLUMNS.map((col) => (
                    <label
                      key={col.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <input
                        type="checkbox"
                        checked={!!visibleExtras[col.key]}
                        onChange={() => setVisibleExtras((prev) => ({ ...prev, [col.key]: !prev[col.key] }))}
                        style={{ accentColor: "#0052CC", width: 15, height: 15 }}
                      />
                      <span style={{ color: "#1e293b", fontSize: "0.9rem", fontWeight: 500 }}>{col.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button
              style={{ height: 38, background: '#0052CC', color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontWeight: 600, fontSize: '0.95rem', cursor: exporting ? 'wait' : 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
              onClick={handleExportList}
              disabled={exporting || importing}
            >
              {exporting ? "Exporting…" : selectedIds.size ? `Export XLS (${selectedIds.size})` : "Export XLS"}
            </button>
            <button
              style={{ height: 38, background: '#007a5a', color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontWeight: 600, fontSize: '0.95rem', cursor: importing ? 'wait' : 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
              onClick={() => importInputRef.current?.click()}
              disabled={exporting || importing}
            >
              {importing ? "Importing…" : "Import XLS"}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: "none" }}
              onChange={handleImportList}
            />
          </div>
        </div>

        {/* Table wrapper without horizontal scroll, table fits container */}
        <div
          className={styles.breakSummaryTableWrapper}
          style={{
            width: '100%',
            overflowX: extraColsVisible ? 'auto' : 'unset',
            overflowY: 'auto',
            maxHeight: '74vh',
            borderBottom: extraColsVisible ? '1px solid #e2e8f0' : 'none',
            paddingBottom: extraColsVisible ? 2 : 0,
            minHeight: 0,
            maxWidth: '100%',
          }}
        >
          <table
            className={styles.breakSummaryTable}
            style={{
              minWidth: extraColsVisible ? 900 : 'unset',
              width: extraColsVisible ? 'max-content' : '100%',
              tableLayout: 'auto',
            }}
          >
            <thead style={{ position: "sticky", top: 0, zIndex: 12 }}>
              <tr>
                <th style={{ width: 42, minWidth: 42, textAlign: "center" }}>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    disabled={filteredIds.length === 0}
                    title="Select all in this list"
                    style={{ width: 16, height: 16, accentColor: "#0052CC", cursor: "pointer" }}
                  />
                </th>
                <th>{renderSortableHeader("Id", "id")}</th>
                <th>{renderSortableHeader("Full Name", "fullName")}</th>
                <th>{renderSortableHeader("P.Name", "pseudonym")}</th>
                <th>{renderSortableHeader("Department", "department")}</th>
                <th>{renderSortableHeader("Gender", "gender")}</th>
                <th>{renderSortableHeader("Nationality", "nationality")}</th>
                <th>{renderSortableHeader("Status", "status")}</th>
                {visibleExtraCols.map((col) => (
                  <th
                    key={col.key}
                    style={{
                      minWidth: col.width || 120,
                      width: col.width || 120,
                      fontSize: '0.95rem',
                      whiteSpace: col.wrap ? 'normal' : 'nowrap',
                    }}
                  >
                    {col.label}
                  </th>
                ))}
                <th>
                  <span>Actions</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
                    style={{
                      fontSize: "0.72rem",
                      borderRadius: 4,
                      border: "1px solid rgba(255,255,255,0.45)",
                      background: "rgba(255,255,255,0.18)",
                      color: "#fff",
                      padding: "2px 4px",
                      marginLeft: 10,
                    }}
                    title="Filter by status"
                  >
                    <option value="all" style={{ color: "#0f1d40" }}>All</option>
                    <option value="active" style={{ color: "#0f1d40" }}>Active</option>
                    <option value="inactive" style={{ color: "#0f1d40" }}>Inactive</option>
                  </select>
                </th>
                    {/* Floating 3 dots menu at top right of card */}
                    {/* Removed duplicate dropdown menu and trigger from inside the table */}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan}>Loading...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={tableColSpan} style={{ color: "red" }}>{error}</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan}>No records found.</td>
                </tr>
              ) : (
                filtered.map((employee) => (
                  <tr key={employee.id}>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(Number(employee.id))}
                        onChange={() => toggleEmployeeSelected(Number(employee.id))}
                        style={{ width: 16, height: 16, accentColor: "#0052CC", cursor: "pointer" }}
                      />
                    </td>
                    <td>{employee.id}</td>
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
                        ? employee.gender.charAt(0).toUpperCase() + employee.gender.slice(1).toLowerCase()
                        : "-"}
                    </td>
                    <td>{employee.nationality || "-"}</td>
                    <td
                      style={{
                        fontWeight: 600,
                        color:
                          employee.status === "active" || employee.status === "enabled"
                            ? "#38A169"
                            : "#E53E3E",
                      }}
                    >
                      {employee.status === "active" || employee.status === "enabled"
                        ? "Active"
                        : "Inactive"}
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
                                fontSize: "0.95rem",
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
                                fontSize: "0.95rem",
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
                      <button
                        title={
                          employee.status === "active" || employee.status === "enabled"
                            ? "Set Inactive"
                            : "Set Active"
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color:
                            employee.status === "active" || employee.status === "enabled"
                              ? "#00b894"
                              : "#b2bec3",
                          cursor: "pointer",
                          marginRight: 8,
                          fontSize: "1.3rem",
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
                        title="Edit"
                        style={{
                          background: "none",
                          border: "none",
                          color: "#0052CC",
                          cursor: "pointer",
                          marginRight: 8,
                        }}
                        onClick={() => {
                          setModalOpen(true);
                          setSelectedEmployee(employee);
                        }}
                      >
                        <FaUserEdit />
                      </button>

                      <button
                        title="Delete"
                        style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer" }}
                        onClick={() => handleDelete(employee.id)}
                      >
                        <FaTrash />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
                onSaved={() => {
                  setModalOpen(false);
                  setSelectedEmployee(null);
                  refreshEmployees();
                }}
              />

              <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
                <button
                  style={{
                    background: "#EDF2F7",
                    color: "#0052CC",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 18px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setModalOpen(false);
                    setSelectedEmployee(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </Modal>
        {popup}
      </div>
    </LayoutDashboard>
  );
}
