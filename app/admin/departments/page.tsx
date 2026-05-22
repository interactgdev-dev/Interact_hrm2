"use client";
import React from "react";
import LayoutDashboard from "../../layout-dashboard";
import DepartmentsTable from "../../components/DepartmentsTable";

export default function DepartmentsPage() {
  return (
    <LayoutDashboard>
      <div style={{ padding: 32 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 24 }}>
          <h1 style={{ fontWeight: 700, fontSize: "1.5rem", margin: 0 }}>Departments</h1>
        </div>
        <DepartmentsTable />
      </div>
    </LayoutDashboard>
  );
}
