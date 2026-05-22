import React from "react";
import Link from "next/link";
import LayoutDashboard from "../layout-dashboard";

export default function ShiftSetupPage() {
  return (
    <LayoutDashboard>
      <div style={{ padding: 32 }}>
        <h1 style={{ fontWeight: 700, fontSize: "1.5rem", marginBottom: 24 }}>Shift Setup</h1>
        <div style={{ display: "flex", gap: 24 }}>
          <Link href="/shift-setup/create-shift">
            <button style={{ padding: "12px 32px", borderRadius: 8, background: "#38b2ac", color: "#fff", fontWeight: 600, border: "none", cursor: "pointer" }}>Create Shift</button>
          </Link>
          <Link href="/shift-setup/assign-shift-employee">
            <button style={{ padding: "12px 32px", borderRadius: 8, background: "#3182ce", color: "#fff", fontWeight: 600, border: "none", cursor: "pointer" }}>Assign Shift Employee</button>
          </Link>
        </div>
      </div>
    </LayoutDashboard>
  );
}
