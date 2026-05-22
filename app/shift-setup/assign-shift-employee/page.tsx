"use client";
import React, { useState } from "react";
import LayoutDashboard from "../../layout-dashboard";
import ShiftAssignmentsTable from "../../components/ShiftAssignmentsTable";
import AssignShiftModal from "../../components/AssignShiftModal";

export default function AssignShiftEmployeePage() {
  const [showAssignModal, setShowAssignModal] = useState(false);

  return (
    <LayoutDashboard>
      <div style={{ padding: 32 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.2rem", marginBottom: 18 }}>
          Assign Shift to Employee
        </h2>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 18,
          }}
        >
          <button
            style={{
              background: "#3182ce",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 28px",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
            }}
            onClick={() => setShowAssignModal(true)}
          >
            Assign Shift
          </button>
        </div>
        <ShiftAssignmentsTable />
        {showAssignModal && <AssignShiftModal onClose={() => setShowAssignModal(false)} />}
      </div>
    </LayoutDashboard>
  );
}
