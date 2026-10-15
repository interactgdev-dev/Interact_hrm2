"use client";
import React, { useEffect, useState } from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../../break-summary/break-summary.module.css";
import adminStyles from "../admin-page.module.css";
import { FaSave, FaTimes, FaEdit, FaKey, FaEnvelope, FaUser } from "react-icons/fa";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { toastError } from "@/lib/app-toast";

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

export default function EmployeeCredentialsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
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

  const fetchEmployees = async () => {
    try {
      const res = await fetch("/api/employee-credentials");
      const data = await res.json();
      if (data.success) {
        const empListRes = await fetch("/api/employee-list");
        const empListData = await empListRes.json();
        const deptMap = new Map();
        if (empListData.success) {
          empListData.employees.forEach((emp: any) => {
            deptMap.set(emp.id, emp.department_name || '-');
          });
        }

        const attendanceRes = await fetch("/api/attendance?fromDate=2020-01-01&toDate=2099-12-31");
        const attendanceData = await attendanceRes.json();
        const pseudonymMap = new Map();
        if (attendanceData.success && Array.isArray(attendanceData.attendance)) {
          attendanceData.attendance.forEach((att: any) => {
            const empId = parseInt(att.employee_id);
            if (!pseudonymMap.has(empId)) {
              pseudonymMap.set(empId, att.pseudonym || '-');
            }
          });
        }

        const enrichedEmployees = data.employees.map((emp: Employee) => ({
          ...emp,
          department_name: deptMap.get(emp.id) || '-',
          pseudonym: pseudonymMap.get(emp.id) || '-'
        }));
        setEmployees(enrichedEmployees);
      } else {
        setError(data.error || "Failed to fetch employees");
      }
    } catch (err) {
      setError("Failed to fetch employees");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (employee: Employee) => {
    setEditingId(employee.id);
    setEditData({
      username: employee.username || "",
      email: employee.email_work || employee.email_other || "",
      password: "",
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditData({ username: "", email: "", password: "" });
  };

  const handleSave = async (id: number) => {
    setSaving(true);
    try {
      const res = await fetch("/api/employee-credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          username: editData.username,
          email: editData.email,
          password: editData.password || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setEmployees((prev) =>
          prev.map((emp) =>
            emp.id === id
              ? {
                  ...emp,
                  username: editData.username,
                  email_work: editData.email,
                }
              : emp
          )
        );
        setEditingId(null);
        setEditData({ username: "", email: "", password: "" });
      } else {
        toastError("Failed to update: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      toastError("Failed to update credentials");
    } finally {
      setSaving(false);
    }
  };

  const getFullName = (emp: Employee) =>
    `${emp.first_name || ""} ${emp.last_name || ""}`.trim();

  const filteredEmployees = employees.filter(
    (emp) =>
      emp.first_name?.toLowerCase().includes(search.toLowerCase()) ||
      emp.last_name?.toLowerCase().includes(search.toLowerCase()) ||
      emp.username?.toLowerCase().includes(search.toLowerCase()) ||
      emp.email_work?.toLowerCase().includes(search.toLowerCase()) ||
      emp.email_other?.toLowerCase().includes(search.toLowerCase()) ||
      emp.id?.toString().includes(search)
  );

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
      <div className={styles.breakSummaryContainer}>
        <h1 className={styles.pageTitle}>
          <FaKey style={{ marginRight: 10, verticalAlign: "middle" }} />
          Employee Credentials
        </h1>
        <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 14 }}>
          Manage employee login credentials — username, email, and password
        </p>

        <div className={styles.breakSummaryFilters}>
          <input
            type="text"
            placeholder="Search by name, username, email, or employee code..."
            className={styles.breakSummaryInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 280px", minWidth: 220 }}
          />
        </div>

        {loading && <div className={styles.breakSummaryNoRecords}>Loading...</div>}
        {error && (
          <div style={{ color: "#dc2626", marginBottom: 12, fontSize: 14 }}>{error}</div>
        )}

        {!loading && !error && (
          <div className={styles.breakSummaryTableWrapper}>
            <table className={styles.breakSummaryTable}>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Full Name</th>
                  <th>P.Name</th>
                  <th>Department</th>
                  <th>
                    <FaUser /> Username
                  </th>
                  <th>
                    <FaEnvelope /> Email
                  </th>
                  <th>
                    <FaKey /> Password
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.breakSummaryNoRecords}>
                      No employees found
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => {
                    const isEditing = editingId === emp.id;
                    const fullName = getFullName(emp);

                    return (
                      <tr key={emp.id}>
                        <td>
                          <strong>{emp.id}</strong>
                        </td>
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
                        <td>{emp.pseudonym || '-'}</td>
                        <td>{emp.department_name || '-'}</td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editData.username}
                              onChange={(e) =>
                                setEditData({ ...editData, username: e.target.value })
                              }
                              className={styles.breakSummaryInput}
                              placeholder="Username"
                              style={{ width: "100%", minWidth: 120 }}
                            />
                          ) : (
                            <span>{emp.username || <em>Not set</em>}</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="email"
                              value={editData.email}
                              onChange={(e) =>
                                setEditData({ ...editData, email: e.target.value })
                              }
                              className={styles.breakSummaryInput}
                              placeholder="Email"
                              style={{ width: "100%", minWidth: 160 }}
                            />
                          ) : (
                            <span>{emp.email_work || emp.email_other || <em>Not set</em>}</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editData.password}
                              onChange={(e) =>
                                setEditData({ ...editData, password: e.target.value })
                              }
                              className={styles.breakSummaryInput}
                              placeholder="New password (optional)"
                              style={{ width: "100%", minWidth: 140 }}
                            />
                          ) : (
                            <span style={{ color: "#94a3b8" }}>
                              {emp.password || "••••••••"}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={() => handleSave(emp.id)}
                                disabled={saving}
                                className={styles.breakSummaryXLSButton}
                                style={{ padding: "6px 12px", fontSize: 12 }}
                              >
                                <FaSave /> {saving ? "Saving..." : "Save"}
                              </button>
                              <button
                                onClick={handleCancel}
                                disabled={saving}
                                className={styles.breakSummaryInput}
                                style={{ padding: "6px 12px", fontWeight: 600, cursor: "pointer" }}
                              >
                                <FaTimes /> Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleEdit(emp)}
                              className={styles.breakSummaryInput}
                              style={{
                                padding: "6px 12px",
                                fontWeight: 600,
                                cursor: "pointer",
                                color: "#611f69",
                              }}
                            >
                              <FaEdit /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
      {popup}
    </OptionalAdminShell>
  );
}
