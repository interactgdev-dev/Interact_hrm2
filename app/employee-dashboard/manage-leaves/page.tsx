"use client";

import ManageLeavesPage from "../../admin/manage-leaves/page";
import { BackToDashboard } from "../components/BackToDashboard";

export default function EmployeeManageLeavesPage() {
  return (
    <div>
      <div style={{ padding: "8px 20px 0" }}>
        <BackToDashboard />
      </div>
      <ManageLeavesPage />
    </div>
  );
}
