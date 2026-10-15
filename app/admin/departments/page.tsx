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
          <h1 className={styles.title}>Departments</h1>
          <p className={styles.subtitle}>Manage company departments and view assigned employees.</p>
          <DepartmentsTable />
        </div>
      </div>
    </OptionalAdminShell>
  );
}
