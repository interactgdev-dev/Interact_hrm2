"use client";

import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "./manage-leaves.module.css";
import tableStyles from "../../break-summary/break-summary.module.css";
import adminStyles from "../admin-page.module.css";
import { EmployeeTableNameCell } from "../../components/EmployeeTableNameCell";
import { useEmployeeDetailPopup } from "../../components/use-employee-detail-popup";
import { ModalPortal } from "@/app/components/ModalPortal";
import { FaFilter, FaSort, FaSortDown, FaSortUp } from "react-icons/fa";
import { toastError, toastSuccess } from "@/lib/app-toast";

interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  employee_code: string;
  employment_status: string;
  annual_allowance: number;
  bereavement_allowance: number;
  annual_used: number;
  bereavement_used: number;
  annual_current_balance: number;
  bereavement_current_balance: number;
  annual_balance_adjustment: number;
  bereavement_balance_adjustment: number;
  department_name?: string;
  pseudonym?: string;
}

type SortKey =
  | "id"
  | "full_name"
  | "pseudonym"
  | "department_name"
  | "employment_status"
  | "annual_balance"
  | "bereavement_balance";

type SortDirection = "asc" | "desc";

export default function ManageLeavesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    annual_current_balance: 20,
    bereavement_current_balance: 3
  });
  const [saving, setSaving] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [searchName, setSearchName] = useState("");
  const deferredSearchName = useDeferredValue(searchName);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [departments, setDepartments] = useState<{ id: number | string; name?: string; department_name?: string }[]>([]);
  const { openFromRow, popup, getPhoto } = useEmployeeDetailPopup();

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

  async function fetchEmployees() {
    try {
      setLoading(true);
      const res = await fetch("/api/employee-leave-allowances");
      const data = await res.json();
      if (data.success) {
        const empDetailsMap = new Map<
          number,
          { pseudonym: string; department_name: string }
        >();

        try {
          const listRes = await fetch("/api/employee-list", { cache: "no-store" });
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
          department_name: empDetailsMap.get(emp.id)?.department_name || "-",
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
    setEditingEmployee(employee);
    setFormData({
      annual_current_balance: employee.annual_current_balance,
      bereavement_current_balance: employee.bereavement_current_balance
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!editingEmployee) return;

    try {
      setSaving(true);
      const res = await fetch("/api/employee-leave-allowances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: editingEmployee.id,
          ...formData
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

  const handleFilterClick = (key: SortKey) => {
    setSortConfig((prev) => {
      if (prev?.key === key) return null;
      return { key, direction: "asc" };
    });
  };

  const handleSortToggle = (key: SortKey) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  };

  const getSortIcon = (key: SortKey) => {
    if (!sortConfig || sortConfig.key !== key) return <FaSort style={{ opacity: 0.75 }} />;
    return sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />;
  };

  const filteredEmployees = useMemo(() => {
    let rows = employees;
    const term = deferredSearchName.trim().toLowerCase();
    if (term) {
      rows = rows.filter((emp) => {
        const fullName = getFullName(emp).toLowerCase();
        const pseudo = (emp.pseudonym || "").toLowerCase();
        return fullName.includes(term) || pseudo.includes(term);
      });
    }
    if (selectedDepartment) {
      rows = rows.filter(
        (emp) =>
          (emp.department_name || "").toLowerCase() === selectedDepartment.toLowerCase()
      );
    }
    return rows;
  }, [employees, deferredSearchName, selectedDepartment]);

  const sortedEmployees = useMemo(() => {
    if (!sortConfig) return filteredEmployees;

    const getText = (value: unknown) => String(value || "").toLowerCase();

    return [...filteredEmployees].sort((a, b) => {
      let cmp = 0;

      switch (sortConfig.key) {
        case "id":
          cmp = Number(a.id || 0) - Number(b.id || 0);
          break;
        case "full_name":
          cmp = getText(getFullName(a)).localeCompare(getText(getFullName(b)), undefined, {
            sensitivity: "base",
          });
          break;
        case "pseudonym":
          cmp = getText(a.pseudonym).localeCompare(getText(b.pseudonym), undefined, {
            sensitivity: "base",
          });
          break;
        case "department_name":
          cmp = getText(a.department_name).localeCompare(getText(b.department_name), undefined, {
            sensitivity: "base",
          });
          break;
        case "employment_status":
          cmp = getText(a.employment_status).localeCompare(getText(b.employment_status), undefined, {
            sensitivity: "base",
          });
          break;
        case "annual_balance":
          cmp = Number(a.annual_current_balance || 0) - Number(b.annual_current_balance || 0);
          break;
        case "bereavement_balance":
          cmp = Number(a.bereavement_current_balance || 0) - Number(b.bereavement_current_balance || 0);
          break;
        default:
          cmp = 0;
      }

      return sortConfig.direction === "asc" ? cmp : -cmp;
    });
  }, [filteredEmployees, sortConfig]);

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

  const thStyle: React.CSSProperties = {
    color: "#fff",
    fontSize: "12px",
    padding: "10px 10px",
    whiteSpace: "nowrap",
    textAlign: "left",
    verticalAlign: "middle",
  };

  const tdStyle: React.CSSProperties = {
    fontSize: "13px",
    padding: "8px 10px",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  };

  const tdAlignedStyle: React.CSSProperties = { ...tdStyle, paddingLeft: 54 };
  const thActionsStyle: React.CSSProperties = { ...thStyle, minWidth: 200, paddingRight: 30 };
  const tdActionsStyle: React.CSSProperties = { ...tdStyle, minWidth: 210, paddingRight: 30 };

  const renderSortableHeader = (label: string, key: SortKey) => {
    const isActive = sortConfig?.key === key;

    return (
      <div style={{ display: "grid", gridTemplateColumns: "38px 1fr", alignItems: "center", gap: 6, width: "100%" }}>
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
        <span style={{ lineHeight: 1.2 }}>{label}</span>
      </div>
    );
  };

  if (loading) {
    return (
      <LayoutDashboard>
        <div className={styles.container}>
          <h1 className={styles.title}>Manage Leaves</h1>
          <p>Loading employees...</p>
        </div>
      </LayoutDashboard>
    );
  }

  return (
    <LayoutDashboard>
      <div className={adminStyles.page}>
        <div className={adminStyles.inner}>
          <h1 className={adminStyles.title}>Manage leaves</h1>
          <p className={adminStyles.subtitle}>Update annual and bereavement leave balances per employee.</p>

          <div className={tableStyles.breakSummaryFilters}>
            <input
              type="text"
              placeholder="Search by name or pseudo name..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className={tableStyles.breakSummaryInput}
              style={{ width: 220 }}
            />
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className={tableStyles.breakSummaryDate}
              style={{ width: 180 }}
            >
              <option value="">All Departments</option>
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

          <div className={adminStyles.card}>
        <div className={tableStyles.breakSummaryTableWrapper} style={{ overflowY: "auto", maxHeight: "74vh" }}>
          <table className={tableStyles.breakSummaryTable}>
            <thead>
              <tr>
                <th>{renderSortableHeader("Id", "id")}</th>
                <th>{renderSortableHeader("Full Name", "full_name")}</th>
                <th>{renderSortableHeader("P.Name", "pseudonym")}</th>
                <th>{renderSortableHeader("Department", "department_name")}</th>
                <th>{renderSortableHeader("Employment Status", "employment_status")}</th>
                <th>{renderSortableHeader("Annual Leave Balance", "annual_balance")}</th>
                <th>{renderSortableHeader("Bereavement Leave Balance", "bereavement_balance")}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className={tableStyles.breakSummaryNoRecords}>
                    No employees found
                  </td>
                </tr>
              ) : (
                sortedEmployees.map((emp) => {
                  return (
                    <tr key={emp.id}>
                      <td>{emp.id}</td>
                      <td>
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
                      </td>
                      <td>{emp.pseudonym || "-"}</td>
                      <td>{emp.department_name || "-"}</td>
                      <td>
                        <span className={emp.employment_status === "Permanent" ? styles.statusPermanent : styles.statusProbation}>
                          {emp.employment_status || "Permanent"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: "#007a5a" }}>
                          {emp.annual_current_balance} / {emp.annual_allowance}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: "#007a5a" }}>
                          {emp.bereavement_current_balance} / {emp.bereavement_allowance}
                        </span>
                      </td>
                      <td>
                        <button
                          className={styles.editBtn}
                          onClick={() => handleEdit(emp)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
          </div>

        {/* Edit Modal */}
        {showModal && editingEmployee && (
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
                Total Allowance: <strong>{editingEmployee.annual_allowance}</strong> Annual, <strong>{editingEmployee.bereavement_allowance}</strong> Bereavement (Fixed)
              </p>

              <div className={styles.currentBalances}>
                <div className={styles.balanceCard}>
                  <div className={styles.balanceLabel}>Current Annual Leave</div>
                  <div className={styles.balanceValue}>
                    <span className={styles.remaining}>{editingEmployee.annual_current_balance}</span>
                    <span className={styles.separator}>/</span>
                    <span className={styles.total}>{editingEmployee.annual_allowance}</span>
                  </div>
                </div>
                
                <div className={styles.balanceCard}>
                  <div className={styles.balanceLabel}>Current Bereavement Leave</div>
                  <div className={styles.balanceValue}>
                    <span className={styles.remaining}>{editingEmployee.bereavement_current_balance}</span>
                    <span className={styles.separator}>/</span>
                    <span className={styles.total}>{editingEmployee.bereavement_allowance}</span>
                  </div>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Update Annual Current Balance</label>
                <input
                  type="number"
                  min="0"
                  value={formData.annual_current_balance}
                  onChange={(e) => setFormData({ ...formData, annual_current_balance: parseInt(e.target.value) || 0 })}
                  className={styles.input}
                />
                <div className={styles.helpText}>
                  {formData.annual_current_balance > editingEmployee.annual_current_balance && 
                    <span style={{color: '#10b981'}}>+{formData.annual_current_balance - editingEmployee.annual_current_balance} leaves added</span>
                  }
                  {formData.annual_current_balance < editingEmployee.annual_current_balance && 
                    <span style={{color: '#ef4444'}}>{formData.annual_current_balance - editingEmployee.annual_current_balance} leaves removed</span>
                  }
                  {formData.annual_current_balance === editingEmployee.annual_current_balance && 
                    <span>No change</span>
                  }
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Update Bereavement Current Balance</label>
                <input
                  type="number"
                  min="0"
                  value={formData.bereavement_current_balance}
                  onChange={(e) => setFormData({ ...formData, bereavement_current_balance: parseInt(e.target.value) || 0 })}
                  className={styles.input}
                />
                <div className={styles.helpText}>
                  {formData.bereavement_current_balance > editingEmployee.bereavement_current_balance && 
                    <span style={{color: '#10b981'}}>+{formData.bereavement_current_balance - editingEmployee.bereavement_current_balance} leaves added</span>
                  }
                  {formData.bereavement_current_balance < editingEmployee.bereavement_current_balance && 
                    <span style={{color: '#ef4444'}}>{formData.bereavement_current_balance - editingEmployee.bereavement_current_balance} leaves removed</span>
                  }
                  {formData.bereavement_current_balance === editingEmployee.bereavement_current_balance && 
                    <span>No change</span>
                  }
                </div>
              </div>

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
        )}
        </div>
      </div>
      {popup}
    </LayoutDashboard>
  );
}
