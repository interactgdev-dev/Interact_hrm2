"use client";

import React from "react";
import OptionalAdminShell from "@/app/components/OptionalAdminShell";
import styles from "../components/admin-module-page.module.css";
import { FaChartBar, FaStar } from "react-icons/fa";

const TEAM_SNAPSHOT = [
  { label: "Reviews completed", value: "—", hint: "This quarter" },
  { label: "Goals on track", value: "—", hint: "Active employees" },
  { label: "Avg. rating", value: "—", hint: "Last cycle" },
];

export default function PerformancePage() {
  return (
    <OptionalAdminShell>
      <div className={styles.page}>
        <div className={styles.inner}>
          <header className={styles.header}>
            <h1 className={styles.title}>
              <span className={styles.titleIcon}>
                <FaChartBar />
              </span>
              Performance
            </h1>
            <p className={styles.subtitle}>
              Monitor team performance reviews, goals, and ratings in one place.
            </p>
          </header>

          <div className={styles.statRow}>
            {TEAM_SNAPSHOT.map((item) => (
              <div key={item.label} className={styles.statCard}>
                <div className={styles.statLabel}>{item.label}</div>
                <div className={styles.statValue}>{item.value}</div>
                <div className={styles.listItemMeta}>{item.hint}</div>
              </div>
            ))}
          </div>

          <div className={styles.card}>
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <FaStar />
              </div>
              <h2 className={styles.emptyTitle}>Performance reviews</h2>
              <p className={styles.emptyText}>
                Review cycles and employee scorecards will appear here when configured for your organization.
              </p>
            </div>
          </div>
        </div>
      </div>
    </OptionalAdminShell>
  );
}
