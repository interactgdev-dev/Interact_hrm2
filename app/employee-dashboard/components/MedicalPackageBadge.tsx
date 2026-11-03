"use client";

import React from "react";
import {
  medicalPackageMeta,
  normalizeMedicalPackage,
  type MedicalPackageId,
} from "@/lib/medical-package";
import styles from "./MedicalPackageBadge.module.css";

type Props = {
  packageId?: MedicalPackageId | string | null;
  size?: "sm" | "md";
};

export function MedicalPackageBadge({ packageId, size = "md" }: Props) {
  const id = normalizeMedicalPackage(packageId);
  const meta = medicalPackageMeta(id);
  if (!meta) return null;

  return (
    <span
      className={`${styles.badge} ${size === "sm" ? styles.sm : styles.md}`}
      title={`${meta.label} medical package`}
      aria-label={`${meta.label} medical package`}
    >
      <svg
        className={styles.diamond}
        viewBox="0 0 24 24"
        width={size === "sm" ? 14 : 18}
        height={size === "sm" ? 14 : 18}
        aria-hidden
      >
        <defs>
          <linearGradient id={`med-diamond-${meta.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="45%" stopColor={meta.diamondColor} />
            <stop offset="100%" stopColor={meta.diamondStroke} />
          </linearGradient>
        </defs>
        <path
          d="M12 2.5 L20.5 9.2 L12 21.5 L3.5 9.2 Z"
          fill={`url(#med-diamond-${meta.id})`}
          stroke={meta.diamondStroke}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M3.5 9.2 L12 9.2 L20.5 9.2"
          fill="none"
          stroke={meta.diamondStroke}
          strokeWidth="0.9"
          opacity="0.55"
        />
      </svg>
      <span className={styles.label} style={{ color: meta.diamondStroke }}>
        {meta.label}
      </span>
    </span>
  );
}
