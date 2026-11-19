"use client";

import React from "react";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { employeeInitials } from "@/lib/employee-photo-shared";
import styles from "./employee-table-name-cell.module.css";

type Props = {
  name: string;
  employeeId: string | number;
  photo?: string | null;
  onOpen: () => void;
};

export function EmployeeTableNameCell({ name, employeeId, photo, onOpen }: Props) {
  const initials = employeeInitials(name || String(employeeId));

  return (
    <div className={styles.cell}>
      <button
        type="button"
        className={styles.avatarBtn}
        onClick={onOpen}
        aria-label={`View ${name} profile`}
        title="View profile"
      >
        <EmployeeAvatar name={name} initials={initials} photo={photo} size="sm" ring="purple" />
      </button>
      <button type="button" className={styles.nameBtn} onClick={onOpen}>
        <span className={styles.name}>{name || "—"}</span>
      </button>
    </div>
  );
}
