"use client";

import AddEmployeeForm from "../../add-employee/AddEmployeeForm";
import adminStyles from "../../admin/admin-page.module.css";

export default function EmployeeAddEmployeePage() {
  return (
    <div className={adminStyles.page}>
      <AddEmployeeForm />
    </div>
  );
}