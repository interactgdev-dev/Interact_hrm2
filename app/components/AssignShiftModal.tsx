"use client";
import React, { useEffect, useState } from "react";

interface Department {
  id: number;
  name: string;
}
interface Employee {
  id: number;
  first_name: string;
  last_name: string;
}
interface Shift {
  id: number;
  name: string;
}

export default function AssignShiftModal({ onClose }: { onClose: () => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [selectedEmp, setSelectedEmp] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<string>("");
  const [assignDate, setAssignDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data: Department[]) => setDepartments(data));
    fetch("/api/employees")
      .then((res) => res.json())
      .then((data: Employee[]) => setEmployees(data));
    fetch("/api/shifts")
      .then((res) => res.json())
      .then((data: Shift[]) => setShifts(data));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    let empIds: number[] = [];
    if (selectedEmp === "all") {
      empIds = employees.map(emp => emp.id);
    } else if (selectedEmp) {
      empIds = [parseInt(selectedEmp)];
    }
    let deptId = selectedDept === "all" ? null : parseInt(selectedDept);
    for (const empId of empIds) {
      await fetch("/api/shift-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department_id: deptId,
          employee_id: empId,
          shift_id: selectedShift === "all" ? null : parseInt(selectedShift),
          assign_date: assignDate
        })
      });
    }
    setLoading(false);
    setSuccess(true);
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 32, minWidth: 420, boxShadow: "0 2px 12px #e2e8f0", position: "relative" }}>
        <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 18 }}>Bulk Shift Assign to Employees</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 18, marginBottom: 18 }}>
            <div style={{ flex: 1 }}>
              <label>Department</label>
              <select value={selectedDept} onChange={e => setSelectedDept(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <option value="">Select Department</option>
                <option value="all">All Departments</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Employee</label>
              <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <option value="">Select Employee</option>
                <option value="all">All Employees</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, marginBottom: 18 }}>
            <div style={{ flex: 1 }}>
              <label>Select Date</label>
              <input type="date" value={assignDate} onChange={e => setAssignDate(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Select Shift</label>
              <select value={selectedShift} onChange={e => setSelectedShift(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <option value="">Select Shift</option>
                <option value="all">To All Employees</option>
                {shifts.map(shift => (
                  <option key={shift.id} value={shift.id}>{shift.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button type="submit" style={{ background: "#3182ce", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer" }} disabled={loading}>Save</button>
            <button type="button" style={{ background: "#a0aec0", color: "#fff", borderRadius: 6, padding: "6px 18px", border: "none", cursor: "pointer" }} onClick={onClose}>Close</button>
            {success && <span style={{ color: "#38b2ac", fontWeight: 600 }}>Saved!</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
