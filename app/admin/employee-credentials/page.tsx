"use client";
import React, { useEffect, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "./employee-credentials.module.css";
import { FaSave, FaTimes, FaEdit, FaKey, FaEnvelope, FaUser } from "react-icons/fa";

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

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const res = await fetch("/api/employee-credentials");
      const data = await res.json();
      if (data.success) {
        // Fetch employee list for department
        const empListRes = await fetch("/api/employee-list");
        const empListData = await empListRes.json();
        const deptMap = new Map();
        if (empListData.success) {
          empListData.employees.forEach((emp: any) => {
            deptMap.set(emp.id, emp.department_name || '-');
          });
        }
        
        // Fetch attendance data to get pseudonym
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
        
        // Merge data into employees
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
        // Update local state
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
        alert("Failed to update: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Failed to update credentials");
    } finally {
      setSaving(false);
    }
  };

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
    <LayoutDashboard>
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>
            <FaKey style={{ marginRight: "10px" }} />
            Employee Credentials
          </h1>
          <p className={styles.pageSubtitle}>
            Manage employee login credentials - username, email, and password
          </p>
        </div>

        <div className={styles.controlsBar}>
          <input
            type="text"
            placeholder="Search by name, username, email, or employee code..."
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading && <div className={styles.loading}>Loading...</div>}
        {error && <div className={styles.error}>{error}</div>}

        {!loading && !error && (
          <div className={styles.tableContainer} style={{ overflowY: "auto", maxHeight: "74vh" }}>
            <table className={styles.table}>
              <thead style={{ position: "sticky", top: 0, zIndex: 12 }}>
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
                    <td colSpan={8} style={{ textAlign: "center", padding: "20px" }}>
                      No employees found
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => {
                    const isEditing = editingId === emp.id;
                    const fullName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();

                    return (
                      <tr key={emp.id}>
                        <td>
                          <strong>{emp.id}</strong>
                        </td>
                        <td>
                          <strong>{fullName || "N/A"}</strong>
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
                              className={styles.editInput}
                              placeholder="Username"
                            />
                          ) : (
                            <span className={styles.credentialText}>
                              {emp.username || <em>Not set</em>}
                            </span>
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
                              className={styles.editInput}
                              placeholder="Email"
                            />
                          ) : (
                            <span className={styles.credentialText}>
                              {emp.email_work || emp.email_other || <em>Not set</em>}
                            </span>
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
                              className={styles.editInput}
                              placeholder="New password (optional)"
                            />
                          ) : (
                            <span className={styles.passwordPlaceholder}>
                              {emp.password || "••••••••"}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <div className={styles.actionButtons}>
                              <button
                                onClick={() => handleSave(emp.id)}
                                className={styles.saveButton}
                                disabled={saving}
                              >
                                <FaSave /> {saving ? "Saving..." : "Save"}
                              </button>
                              <button
                                onClick={handleCancel}
                                className={styles.cancelButton}
                                disabled={saving}
                              >
                                <FaTimes /> Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleEdit(emp)}
                              className={styles.editButton}
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
    </LayoutDashboard>
  );
}
