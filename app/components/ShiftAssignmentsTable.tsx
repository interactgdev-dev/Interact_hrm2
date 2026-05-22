"use client";
import React, { useEffect, useState } from "react";

interface ShiftAssignment {
  id: number;
  department_name: string | null;
  first_name: string | null;
  last_name: string | null;
  shift_name: string | null;
  assign_date: string;
  created_at: string;
}

export default function ShiftAssignmentsTable() {
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);

  useEffect(() => {
    fetch("/api/shift-assignments")
      .then((res) => res.json())
      .then((data: ShiftAssignment[]) => setAssignments(data));
  }, []);

  return (
    <div style={{ background: "#f7fafc", borderRadius: 16, boxShadow: "0 2px 8px #e2e8f0", padding: 24, marginTop: 24 }}>
      <h2 style={{ fontWeight: 700, fontSize: "1.2rem", marginBottom: 18 }}>Assigned Shifts</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#e2e8f0" }}>
            <th style={{ padding: 8 }}>Department</th>
            <th style={{ padding: 8 }}>Employee</th>
            <th style={{ padding: 8 }}>Shift</th>
            <th style={{ padding: 8 }}>Assign Date</th>
            <th style={{ padding: 8 }}>Assigned At</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
              <td style={{ padding: 8 }}>{a.department_name || '-'}</td>
              <td style={{ padding: 8 }}>{a.first_name || ''} {a.last_name || ''}</td>
              <td style={{ padding: 8 }}>{a.shift_name || '-'}</td>
              <td style={{ padding: 8 }}>{a.assign_date}</td>
              <td style={{ padding: 8 }}>{a.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
