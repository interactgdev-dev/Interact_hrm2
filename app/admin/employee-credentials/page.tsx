"use client";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import leaveStyles from "../../leave/leave.module.css";
import adminStyles from "../admin-page.module.css";
import { FaSave, FaTimes, FaEdit, FaKey, FaEnvelope, FaUser } from "react-icons/fa";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { toastError } from "@/lib/app-toast";
import { leaveDeptMatches } from "@/lib/leave-dept-filter";

interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email_work: string;
  email_other: string;
  phone_mobile: string;
  password?: string;
  department_name?: string;
  pseudonym?: string;
}

function normText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getFullName(emp: Employee): string {
  return `${emp.first_name || ""} ${emp.last_name || ""}`.replace(/\s+/g, " ").trim();
}

function employeeMatchesSearch(emp: Employee, searchRaw: string): boolean {
  const q = normText(searchRaw);
  if (!q) return true;
  const haystacks = [
    getFullName(emp),
    emp.first_name,
    emp.last_name,
    emp.username,
    emp.email_work,
    emp.email_other,
    emp.pseudonym,
    emp.department_name,
    String(emp.id ?? ""),
  ].map(normText);
  return haystacks.some((h) => h.includes(q));
}

export default function EmployeeCredentialsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [detailEmp, setDetailEmp] = useState<Employee | null>(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    username: "",
    email: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    if (!detailEmp) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDetailEmp(null);
        setEditing(false);
        setEditData({ username: "", email: "", password: "" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailEmp]);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setError("");
      const viewerId =
        typeof window !== "undefined"
          ? String(localStorage.getItem("employeeId") || "").trim()
          : "";
      const qs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
      const scopeHeaders: HeadersInit = viewerId
        ? { "x-employee-id": viewerId, "x-hrm-employee-id": viewerId }
        : {};

      const res = await fetch(`/api/employee-credentials${qs}`, {
        cache: "no-store",
        headers: scopeHeaders,
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Failed to fetch employees");
        return;
      }

      const empListRes = await fetch(`/api/employee-list${qs}`, {
        cache: "no-store",
        headers: scopeHeaders,
      });
      const empListData = await empListRes.json();
      const metaMap = new Map<
        number,
        { department_name: string; pseudonym: string }
      >();
      const list = Array.isArray(empListData?.employees)
        ? empListData.employees
        : Array.isArray(empListData)
          ? empListData
          : [];
      for (const row of list) {
        const empId = Number(row.id);
        if (!Number.isFinite(empId) || empId <= 0 || metaMap.has(empId)) continue;
        metaMap.set(empId, {
          department_name: String(row.department_name || "").trim() || "-",
          pseudonym: String(row.pseudonym || "").trim() || "-",
        });
      }

      const byId = new Map<number, Employee>();
      for (const emp of data.employees as Employee[]) {
        const id = Number(emp.id);
        if (!Number.isFinite(id) || id <= 0 || byId.has(id)) continue;
        const meta = metaMap.get(id);
        byId.set(id, {
          ...emp,
          id,
          department_name:
            String(emp.department_name || "").trim() ||
            meta?.department_name ||
            "-",
          pseudonym: meta?.pseudonym || "-",
        });
      }
      setEmployees([...byId.values()].sort((a, b) => a.id - b.id));
    } catch {
      setError("Failed to fetch employees");
    } finally {
      setLoading(false);
    }
  };

  const openView = (employee: Employee) => {
    setDetailEmp(employee);
    setEditing(false);
    setEditData({
      username: employee.username || "",
      email: employee.email_work || employee.email_other || "",
      password: "",
    });
  };

  const startEdit = () => {
    if (!detailEmp) return;
    setEditing(true);
    setEditData({
      username: detailEmp.username || "",
      email: detailEmp.email_work || detailEmp.email_other || "",
      password: "",
    });
  };

  const closeDetail = () => {
    setDetailEmp(null);
    setEditing(false);
    setEditData({ username: "", email: "", password: "" });
  };

  const handleSave = async () => {
    if (!detailEmp) return;
    const id = detailEmp.id;
    setSaving(true);
    try {
      const viewerId =
        typeof window !== "undefined"
          ? String(localStorage.getItem("employeeId") || "").trim()
          : "";
      const res = await fetch("/api/employee-credentials", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(viewerId
            ? { "x-employee-id": viewerId, "x-hrm-employee-id": viewerId }
            : {}),
        },
        body: JSON.stringify({
          id,
          username: editData.username,
          email: editData.email,
          password: editData.password || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const updated: Employee = {
          ...detailEmp,
          username: editData.username,
          email_work: editData.email,
        };
        setEmployees((prev) => prev.map((emp) => (emp.id === id ? updated : emp)));
        setDetailEmp(updated);
        setEditing(false);
        setEditData({ username: "", email: "", password: "" });
      } else {
        toastError("Failed to update: " + (data.error || "Unknown error"));
      }
    } catch {
      toastError("Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  const uniqueDepartments = useMemo(() => {
    const depts = employees
      .map((e) => String(e.department_name || "").replace(/\s+/g, " ").trim())
      .filter((d) => d && d !== "-");
    return Array.from(new Set(depts)).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (!employeeMatchesSearch(emp, search)) return false;
      return leaveDeptMatches(emp.department_name, departmentFilter);
    });
  }, [employees, search, departmentFilter]);

  const detailEmail = detailEmp?.email_work || detailEmp?.email_other || "";

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <div className={styles.breakSummaryContainer}>
          <div className={adminStyles.pageHeader}>
            <div>
              <h1 className={adminStyles.pageHeaderTitle}>
                <FaKey style={{ marginRight: 10, verticalAlign: "middle" }} />
                Employee Credentials
              </h1>
              <p className={styles.mgmtAttMeta} style={{ marginTop: 4 }}>
                Manage employee login credentials — username, email, and password
              </p>
            </div>
          </div>

          <div className={leaveStyles.toolbar}>
            <div className={leaveStyles.searchWrap}>
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
                className={leaveStyles.toolbarSearch}
                placeholder="Search by name, username, email, or ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            <select
              className={leaveStyles.toolbarSelect}
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              aria-label="Filter by department"
            >
              <option value="">All departments</option>
              {uniqueDepartments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
            <span className={styles.empListShowing}>
              Showing: {filteredEmployees.length}
            </span>
          </div>

          {error ? (
            <div className={styles.tungstenError} role="alert">
              {error}
            </div>
          ) : null}

          <div className={leaveStyles.reqTableShell}>
            <div className={styles.mgmtAttScroll}>
              {loading ? (
                <div className={leaveStyles.loading}>Loading credentials…</div>
              ) : (
                <table className={`${leaveStyles.reqTable} ${styles.credTableFit}`}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Full Name</th>
                      <th>P.Name</th>
                      <th>Department</th>
                      <th>Credentials</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={leaveStyles.reqEmpty}>
                          No employees found
                        </td>
                      </tr>
                    ) : (
                      filteredEmployees.map((emp) => {
                        const fullName = getFullName(emp);
                        return (
                          <tr key={emp.id}>
                            <td className={leaveStyles.reqId}>{emp.id}</td>
                            <td>
                              <EmployeeTableNameCell
                                name={fullName || "N/A"}
                                employeeId={emp.id}
                                photo={getPhoto(emp.id)}
                                onOpen={() =>
                                  openFromRow({
                                    employee_id: emp.id,
                                    employee_name: fullName,
                                    first_name: emp.first_name,
                                    last_name: emp.last_name,
                                    pseudonym: emp.pseudonym,
                                    department_name: emp.department_name,
                                    email: emp.email_work || emp.email_other,
                                  })
                                }
                              />
                            </td>
                            <td title={emp.pseudonym || undefined}>
                              {emp.pseudonym || "-"}
                            </td>
                            <td title={emp.department_name || undefined}>
                              {emp.department_name || "-"}
                            </td>
                            <td>
                              <button
                                type="button"
                                className={styles.mgmtAttGhostBtn}
                                style={{ padding: "5px 10px", fontSize: 12 }}
                                onClick={() => openView(emp)}
                              >
                                View
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => {
                                  openView(emp);
                                  setEditing(true);
                                  setEditData({
                                    username: emp.username || "",
                                    email: emp.email_work || emp.email_other || "",
                                    password: "",
                                  });
                                }}
                                className={styles.mgmtAttGhostBtn}
                                style={{
                                  padding: "5px 10px",
                                  fontSize: 12,
                                  color: "#0f766e",
                                }}
                              >
                                <FaEdit /> Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {typeof document !== "undefined" && detailEmp
        ? createPortal(
            <div
              className={styles.credModalOverlay}
              data-hrm-modal-overlay
              onClick={closeDetail}
            >
              <div
                className={styles.credModalCard}
                role="dialog"
                aria-modal="true"
                aria-labelledby="cred-detail-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.credModalHead}>
                  <h3 id="cred-detail-title" className={styles.credModalTitle}>
                    {editing ? "Edit Credentials" : "Credentials"}
                  </h3>
                  <p className={styles.credModalSub}>
                    {getFullName(detailEmp)} · Emp. ID {detailEmp.id}
                  </p>
                </div>
                <div className={styles.credModalBody}>
                  {editing ? (
                    <div className={styles.credModalFields}>
                      <label className={styles.credField}>
                        <span>
                          <FaUser /> Username
                        </span>
                        <input
                          type="text"
                          value={editData.username}
                          onChange={(e) =>
                            setEditData({ ...editData, username: e.target.value })
                          }
                          className={leaveStyles.toolbarSelect}
                          placeholder="Username"
                        />
                      </label>
                      <label className={styles.credField}>
                        <span>
                          <FaEnvelope /> Email
                        </span>
                        <input
                          type="email"
                          value={editData.email}
                          onChange={(e) =>
                            setEditData({ ...editData, email: e.target.value })
                          }
                          className={leaveStyles.toolbarSelect}
                          placeholder="Email"
                        />
                      </label>
                      <label className={styles.credField}>
                        <span>
                          <FaKey /> Password
                        </span>
                        <input
                          type="text"
                          value={editData.password}
                          onChange={(e) =>
                            setEditData({ ...editData, password: e.target.value })
                          }
                          className={leaveStyles.toolbarSelect}
                          placeholder="New password (optional)"
                        />
                      </label>
                    </div>
                  ) : (
                    <dl className={styles.credDetailList}>
                      <div>
                        <dt>
                          <FaUser /> Username
                        </dt>
                        <dd>{detailEmp.username || "Not set"}</dd>
                      </div>
                      <div>
                        <dt>
                          <FaEnvelope /> Email
                        </dt>
                        <dd>{detailEmail || "Not set"}</dd>
                      </div>
                      <div>
                        <dt>
                          <FaKey /> Password
                        </dt>
                        <dd className={styles.credPasswordMask}>
                          {detailEmp.password || "••••••••"}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
                <div className={styles.credModalActions}>
                  <button
                    type="button"
                    className={styles.mgmtAttGhostBtn}
                    onClick={closeDetail}
                  >
                    <FaTimes /> Close
                  </button>
                  {editing ? (
                    <button
                      type="button"
                      className={styles.breakSummaryXLSButton}
                      disabled={saving}
                      onClick={() => void handleSave()}
                    >
                      <FaSave /> {saving ? "Saving…" : "Save"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.mgmtAttGhostBtn}
                      style={{ color: "#0f766e" }}
                      onClick={startEdit}
                    >
                      <FaEdit /> Edit
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {popup}
    </OptionalAdminShell>
  );
}
