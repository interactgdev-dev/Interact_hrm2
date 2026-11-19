"use client";
import React from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import DepartmentsTable from "../../components/DepartmentsTable";
import styles from "../admin-page.module.css";

export default function DepartmentsPage() {
  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.pageHeader}>
            <div>
              <h1 className={styles.pageHeaderTitle}>Departments</h1>
              <p className={styles.subtitle} style={{ marginBottom: 0 }}>
                Manage company departments and view assigned employees.
              </p>
            </div>
          </div>
          <DepartmentsTable />
        </div>
      </div>
    </OptionalAdminShell>
  );
}
