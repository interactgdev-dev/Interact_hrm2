"use client";
import React, { useState, useEffect } from "react";

// Define Department type
interface Department {
  id: number;
  name: string;
}

interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  employee_id: string;
}

export default function DepartmentsTable() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employeesByDept, setEmployeesByDept] = useState<Record<number, Employee[]>>({});
  const [showEmp, setShowEmp] = useState<Record<number, boolean>>({});
  const [newDept, setNewDept] = useState<string>("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [showDialog, setShowDialog] = useState<boolean>(false);

  // Fetch departments
  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.departments)) {
          setDepartments(data.departments);
        } else {
          setDepartments([]);
        }
      });
  }, []);

  // Fetch employees for all departments
  useEffect(() => {
    if (departments.length === 0) return;
    departments.forEach(dep => {
      fetch(`/api/employee-list?department_id=${dep.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.employees)) {
            setEmployeesByDept(prev => ({ ...prev, [dep.id]: data.employees }));
          }
        });
    });
  }, [departments]);

  // Add department
  const handleAdd = async () => {
    if (!newDept.trim()) return;
    await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newDept })
    });
    setNewDept("");
    setShowDialog(false);
    // Refresh
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.departments)) {
          setDepartments(data.departments);
        }
      });
  };

  // Edit department
  const handleEdit = async (id: number) => {
    await fetch(`/api/departments?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName })
    });
    setEditId(null);
    setEditName("");
    // Refresh
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.departments)) {
          setDepartments(data.departments);
        }
      });
  };

  // Delete department
  const handleDelete = async (id: number) => {
    await fetch(`/api/departments?id=${id}`, { method: "DELETE" });
    // Refresh
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.departments)) {
          setDepartments(data.departments);
        }
      });
  };

  return (
    <div style={{ background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.2rem" }}>Departments</h2>
        <button style={{ background: "#38b2ac", color: "#fff", borderRadius: 8, padding: "8px 18px", fontWeight: 600, border: "none", cursor: "pointer" }} onClick={() => setShowDialog(true)}>Add Department</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#e2e8f0" }}>
            <th style={{ padding: 8, textAlign: "left" }}>Name</th>
            <th style={{ padding: 8, textAlign: "center" }}>Employees</th>
            <th style={{ padding: 8, textAlign: "center" }}>Edit</th>
            <th style={{ padding: 8, textAlign: "center" }}>Delete</th>
          </tr>
        </thead>
        <tbody>
          {departments.map((dept) => (
            <tr key={dept.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
              <td style={{ padding: 8, verticalAlign: "top" }}>
                {editId === dept.id ? (
                  <input value={editName} onChange={e => setEditName(e.target.value)} style={{ padding: 4, display: "block", marginBottom: 8 }} />
                ) : (
                  <span style={{ display: "block", marginBottom: 8 }}>{dept.name}</span>
                )}
              </td>
              <td style={{ padding: 8, verticalAlign: "top", textAlign: "center" }}>
                <button style={{ background: "#38b2ac", color: "#fff", borderRadius: 6, padding: "4px 12px", border: "none", cursor: "pointer", marginBottom: 4 }} onClick={() => setShowEmp(prev => ({ ...prev, [dept.id]: !prev[dept.id] }))}>
                  {showEmp[dept.id] ? "Hide" : "Show"} Employees
                </button>
                {showEmp[dept.id] && employeesByDept[dept.id] && (
                  <div style={{ marginTop: 8, background: "#f1f5f9", borderRadius: 8, padding: 8, maxHeight: 180, overflowY: "auto", minWidth: 180 }}>
                    {employeesByDept[dept.id].length === 0 ? (
                      <div style={{ color: '#888' }}>No employees</div>
                    ) : (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                        {employeesByDept[dept.id].map(emp => (
                          <li key={emp.id} style={{ padding: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
                            {emp.first_name} {emp.last_name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </td>
              <td style={{ padding: 8, verticalAlign: "top", textAlign: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {editId === dept.id ? (
                    <button style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "4px 12px", border: "none", marginBottom: 4, cursor: "pointer" }} onClick={() => handleEdit(dept.id)}>Save</button>
                  ) : (
                    <button style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "4px 12px", border: "none", marginBottom: 4, cursor: "pointer" }} onClick={() => { setEditId(dept.id); setEditName(dept.name); }}>Edit</button>
                  )}
                </div>
              </td>
              <td style={{ padding: 8, verticalAlign: "top", textAlign: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <button style={{ background: "#e53e3e", color: "#fff", borderRadius: 6, padding: "4px 12px", border: "none", marginBottom: 4, cursor: "pointer" }} onClick={() => handleDelete(dept.id)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Add Department Dialog */}
      {showDialog && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 32, minWidth: 320, boxShadow: "0 2px 12px #e2e8f0" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 18 }}>Add Department</h3>
            <input value={newDept} onChange={e => setNewDept(e.target.value)} placeholder="Department Name" style={{ width: "100%", padding: 8, marginBottom: 18, borderRadius: 6, border: "1px solid #e2e8f0" }} />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button style={{ background: "#38b2ac", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer" }} onClick={handleAdd}>Save</button>
              <button style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer" }} onClick={() => setShowDialog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
