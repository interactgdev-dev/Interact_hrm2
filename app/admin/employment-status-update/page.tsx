"use client";

import React from "react";
import LayoutDashboard from "../../layout-dashboard";
import styles from "../../attendance-summary/attendance-summary.module.css";

export default function EmploymentStatusUpdatePage() {
  return (
    <LayoutDashboard>
      <div className={styles.attendanceSummaryContainer}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#22223B", margin: 0 }}>
            Employment Status (Manual Only)
          </h1>
          <p style={{ color: "#4A5568", fontSize: "0.9rem", marginTop: 4 }}>
            Automatic probation-to-permanent updates are disabled.
          </p>
        </div>

        <div
          style={{
            background: "#F7FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h3 style={{ marginTop: 0, color: "#0f1d40" }}>Current Behavior</h3>
          <ul style={{ color: "#4A5568", lineHeight: 1.8 }}>
            <li>Employment status is updated manually from Add Employee or Edit Employee form.</li>
            <li>Date of joining no longer auto-changes status to Permanent.</li>
            <li>Leave balance and employee dashboard read the latest saved manual status.</li>
          </ul>

          <h3 style={{ color: "#0f1d40" }}>Manual Update Steps</h3>
          <ol style={{ color: "#4A5568", lineHeight: 1.8, paddingLeft: 20 }}>
            <li>Open employee form (Add/Edit).</li>
            <li>Set Employment Status to Probation or Permanent.</li>
            <li>Save Personal Details and then save Job Details.</li>
            <li>Open Leave and Employee Dashboard pages to see updated status/balance.</li>
          </ol>
        </div>

        <div
          style={{
            background: "#FFF5F5",
            border: "1px solid #FEB2B2",
            borderRadius: 8,
            padding: 12,
            color: "#742A2A",
          }}
        >
          Auto-update endpoint is intentionally disabled to keep status changes manual.
        </div>
      </div>
    </LayoutDashboard>
  );
}
