import LayoutDashboard from "../../layout-dashboard";
import React from "react";

// Only show actual admin sidebar modules/pages
const modules = [
  "Dashboard",
  "Admin",
  "Leave",
  "Calendar",
  "Manage Leaves",
  "Time",
  "Manage Attendance",
  "Monthly Attendance",
  "Tungsten IN/OUT",
  "Manage Breaks",
  "Recruitment",
  "Add Employee",
  "Employee List",
  "Employee Credentials",
  "Shift Scheduler",
  "Shift Management",
  "Events",
  "Departments",
  "My Info",
  "Performance"
];

const roles = [
  "Super Admin",
  "HR",
  "Accountant",
  "Manager",
  "Executive",
  "Recruiter",
  "Employee",
  "Team Lead"
];

export default function RolesPermissionsPage() {
  return (
    <LayoutDashboard>
      <div style={{ padding: 32 }}>
        <h1 style={{ fontWeight: 700, fontSize: "1.5rem", marginBottom: 24 }}>Roles & Permissions</h1>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, background: "#fff", borderRadius: 8, boxShadow: "0 2px 12px rgba(0,82,204,0.08)" }}>
            <thead>
              <tr style={{ background: "#f5f7fa" }}>
                <th style={{ padding: "12px 18px", fontWeight: 700, fontSize: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>Module / Roles</th>
                {roles.map(role => (
                  <th key={role} style={{ padding: "12px 18px", fontWeight: 700, fontSize: "1rem", textAlign: "center", borderBottom: "2px solid #e2e8f0" }}>{role}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map(module => (
                <tr key={module}>
                  <td style={{ padding: "10px 18px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>{module}</td>
                  {roles.map(role => (
                    <td key={role} style={{ textAlign: "center", borderBottom: "1px solid #e2e8f0" }}>
                      <input type="checkbox" disabled={role === "Super Admin"} checked={role === "Super Admin"} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutDashboard>
  );
}
