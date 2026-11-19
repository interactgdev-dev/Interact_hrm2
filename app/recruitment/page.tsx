"use client";

import React from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../components/admin-module-page.module.css";
import { FaBriefcase, FaUserPlus } from "react-icons/fa";
import { useRouter } from "next/navigation";

const OPEN_ROLES = [
  { role: "Software Engineer", candidates: 2 },
  { role: "HR Manager", candidates: 1 },
  { role: "Accountant", candidates: 1 },
];

export default function RecruitmentPage() {
  const router = useRouter();
  const totalCandidates = OPEN_ROLES.reduce((sum, r) => sum + r.candidates, 0);

  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <header className={styles.header}>
            <h1 className={styles.title}>
              <span className={styles.titleIcon}>
                <FaBriefcase />
              </span>
              Recruitment
            </h1>
            <p className={styles.subtitle}>
              Track open roles and candidate pipeline for your organization.
            </p>
          </header>

          <div className={styles.statRow}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Open roles</div>
              <div className={styles.statValue}>{OPEN_ROLES.length}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Active candidates</div>
              <div className={styles.statValue}>{totalCandidates}</div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.list}>
              {OPEN_ROLES.map((item) => (
                <div key={item.role} className={styles.listItem}>
                  <div>
                    <div className={styles.listItemTitle}>{item.role}</div>
                    <div className={styles.listItemMeta}>Hiring pipeline</div>
                  </div>
                  <span className={styles.badge}>{item.candidates} candidates</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.card} style={{ marginTop: 16 }}>
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <FaUserPlus />
              </div>
              <h2 className={styles.emptyTitle}>Onboard a new hire</h2>
              <p className={styles.emptyText}>
                When a candidate is selected, add them to the system from the employee onboarding flow.
              </p>
              <button
                type="button"
                className={`${styles.badge} ${styles.btnLink}`}
                onClick={() => router.push("/add-employee")}
              >
                Go to Add Employee
              </button>
            </div>
          </div>
        </div>
      </div>
    </OptionalAdminShell>
  );
}
