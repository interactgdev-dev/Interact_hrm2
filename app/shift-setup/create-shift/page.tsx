import React from "react";
import LayoutDashboard from "../../layout-dashboard";
import MasterShiftsTable from "../../components/MasterShiftsTable";

export default function CreateShiftPage() {
  return (
    <LayoutDashboard>
      <div style={{ padding: 32 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.2rem", marginBottom: 18 }}>Create Shift</h2>
        <MasterShiftsTable />
      </div>
    </LayoutDashboard>
  );
}
