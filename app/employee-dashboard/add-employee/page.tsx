"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import AddEmployeeForm from "../../add-employee/AddEmployeeForm";
import adminStyles from "../../admin/admin-page.module.css";

export default function EmployeeAddEmployeePage() {
  const router = useRouter();
  const [formKey, setFormKey] = useState(0);

  return (
    <div className={adminStyles.page}>
      <AddEmployeeForm
        key={formKey}
        onClose={() => router.push("/employee-dashboard/employee-list")}
        onRequestNew={() => setFormKey((k) => k + 1)}
      />
    </div>
  );
}
