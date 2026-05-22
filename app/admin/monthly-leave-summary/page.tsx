"use client";
import React, { useState, useEffect } from "react";
import { FaFilter, FaSort, FaSortUp, FaSortDown } from "react-icons/fa";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../break-summary/break-summary.module.css";

export default function MonthlyLeaveSummaryPage() {
  // Sorting logic and helpers must be inside the component
  type SortKey = "id" | "employeeName" | "pseudonym" | "department" | "total" | "approved" | "rejected" | "pending" | "leaveTypes";
  type SortDirection = "asc" | "desc";
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);

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
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  // Default to current month in yyyy-MM format
  const getCurrentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };
  const [month, setMonth] = useState<string>(getCurrentMonth());

  const [leaveData, setLeaveData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!month) return;
    fetchSummary();
  }, [month]);

  // Unique departments for filter dropdown
  const uniqueDepartments = React.useMemo(() => {
    return Array.from(new Set(leaveData.map((row) => row.department).filter(Boolean)));
  }, [leaveData]);

  async function fetchSummary() {
    setLoading(true);
    setError("");
    try {
      // 1. Fetch all employees
      const empRes = await fetch("/api/employee-list");
      const empData = await empRes.json();
      if (!empData.success) throw new Error(empData.error || "Failed to fetch employees");
      const employees = empData.employees || [];

      // 2. Fetch all leaves for the selected month
      const [year, monthNum] = month.split("-");
      const fromDate = `${year}-${monthNum}-01`;
      const toDate = new Date(Number(year), Number(monthNum), 0); // last day of month
      const toDateStr = `${year}-${monthNum}-${String(toDate.getDate()).padStart(2, "0")}`;
      const leavesRes = await fetch(`/api/leaves?fromDate=${fromDate}&toDate=${toDateStr}`);
      const leavesData = await leavesRes.json();
      if (!leavesData.success) throw new Error(leavesData.error || "Failed to fetch leaves");
      const leaves = leavesData.leaves || [];

      // 3. Aggregate leave data per employee
      const summary = employees.map((emp: any) => {
        const empLeaves = leaves.filter((l: any) => String(l.employee_id) === String(emp.id));
        const approved = empLeaves.filter((l: any) => l.status === "approved");
        const rejected = empLeaves.filter((l: any) => l.status === "rejected");
        const pending = empLeaves.filter((l: any) => l.status === "pending");
        const leaveTypes = Array.from(new Set(empLeaves.map((l: any) => l.leave_category))).join(", ");
        return {
          id: emp.id,
          employeeName: `${emp.first_name} ${emp.last_name}`,
          pseudonym: emp.pseudonym || "-",
          department: emp.department_name || "-",
          total: empLeaves.length,
          approved: approved.length,
          rejected: rejected.length,
          pending: pending.length,
          leaveTypes: leaveTypes || "-",
        };
      });
      setLeaveData(summary);
    } catch (e: any) {
      setError(e.message || "Failed to fetch data");
      setLeaveData([]);
    }
    setLoading(false);
  }

  return (
    <LayoutDashboard>
      <div className={styles.breakSummaryContainer} style={{ position: 'relative', maxWidth: 1200, margin: '0 auto' }}>
        <div className={styles.breakSummaryHeader}>Leave Summary</div>
        <div className={styles.breakSummaryFilters} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
              <label style={{ fontWeight: 600 }}>Month:</label>
              <input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
                className={styles.breakSummaryInput}
                style={{ width: 180, fontSize: 16 }}
              />
              <input
                type="text"
                placeholder="Search by name, ID or P.Name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className={styles.breakSummaryInput}
                style={{ width: 220, fontSize: 15 }}
              />
              <select
                value={departmentFilter}
                onChange={e => setDepartmentFilter(e.target.value)}
                className={styles.breakSummaryInput}
                style={{ width: 180, fontSize: 15 }}
              >
                <option value="">All Departments</option>
                {uniqueDepartments.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
        </div>
        <div className={styles.breakSummaryTableWrapper} style={{ overflowY: "auto", maxHeight: "74vh" }}>
          <table className={styles.breakSummaryTable} style={{ minWidth: 900 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 12 }}>
              <tr>
                <th>{renderSortableHeader("ID", "id")}</th>
                <th>{renderSortableHeader("Employee", "employeeName")}</th>
                <th>{renderSortableHeader("P.Name", "pseudonym")}</th>
                <th>{renderSortableHeader("Department", "department")}</th>
                <th>{renderSortableHeader("Total Leaves", "total")}</th>
                <th>{renderSortableHeader("Approved", "approved")}</th>
                <th>{renderSortableHeader("Rejected", "rejected")}</th>
                <th>{renderSortableHeader("Pending", "pending")}</th>
                <th>{renderSortableHeader("Leave Types", "leaveTypes")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className={styles.breakSummaryNoRecords}>Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className={styles.breakSummaryNoRecords} style={{ color: 'red' }}>{error}</td></tr>
              ) : leaveData.length === 0 ? (
                <tr><td colSpan={6} className={styles.breakSummaryNoRecords}>No data available.</td></tr>
              ) : (
                [...leaveData
                  .filter(row => {
                    const searchLower = search.toLowerCase();
                    const matchesSearch =
                      !search ||
                      row.employeeName.toLowerCase().includes(searchLower) ||
                      String(row.id).includes(searchLower) ||
                      (row.pseudonym || "").toLowerCase().includes(searchLower);
                    const matchesDept = !departmentFilter || row.department === departmentFilter;
                    return matchesSearch && matchesDept;
                  })]
                  .sort((a, b) => {
                    if (!sortConfig) return 0;
                    let comparison = 0;
                    const key = sortConfig.key;
                    if (key === "employeeName" || key === "pseudonym" || key === "department" || key === "leaveTypes") {
                      comparison = String(a[key]).localeCompare(String(b[key]), undefined, { sensitivity: "base" });
                    } else {
                      comparison = Number(a[key]) - Number(b[key]);
                    }
                    return sortConfig.direction === "asc" ? comparison : -comparison;
                  })
                  .map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.id}</td>
                      <td>{row.employeeName}</td>
                      <td>{row.pseudonym}</td>
                      <td>{row.department}</td>
                      <td>{row.total}</td>
                      <td>{row.approved}</td>
                      <td>{row.rejected}</td>
                      <td>{row.pending}</td>
                      <td>{row.leaveTypes}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutDashboard>
  );
}
