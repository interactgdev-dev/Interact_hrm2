"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import AddEmployeeForm from "./AddEmployeeForm";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import adminStyles from "../admin/admin-page.module.css";

export default function AddEmployeePage() {
  const router = useRouter();
  const [formKey, setFormKey] = useState(0);

  return (
    <OptionalAdminShell>
      <div className={adminStyles.page}>
        <AddEmployeeForm
          key={formKey}
          onClose={() => router.push("/admin/employee-list")}
          onRequestNew={() => setFormKey((k) => k + 1)}
        />
      </div>
    </OptionalAdminShell>
  );
}
