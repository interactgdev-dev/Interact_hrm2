"use client";

import React from "react";
import styles from "./manage-leaves.module.css";

export type SortDir = "asc" | "desc";

type SortableThProps = {
  label: React.ReactNode;
  column: string;
  sortKey: string;
  sortDir: SortDir;
  onSort: (column: string) => void;
  className?: string;
};

/** Compact A↔Z header control for leave tables. */
export function SortableTh({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className,
}: SortableThProps) {
  const active = sortKey === column;
  return (
    <th className={className}>
      <button
        type="button"
        className={styles.sortThBtn}
        onClick={() => onSort(column)}
        aria-label={`Sort by ${typeof label === "string" ? label : column}`}
        title="Sort A–Z / Z–A"
      >
        <span className={styles.sortThLabel}>{label}</span>
        <span className={styles.sortArrows} aria-hidden>
          <span
            className={
              active && sortDir === "asc" ? styles.sortArrowOn : styles.sortArrow
            }
          >
            ▲
          </span>
          <span
            className={
              active && sortDir === "desc" ? styles.sortArrowOn : styles.sortArrow
            }
          >
            ▼
          </span>
        </span>
      </button>
    </th>
  );
}

export function nextSortState(
  prevKey: string,
  prevDir: SortDir,
  column: string,
): { key: string; dir: SortDir } {
  if (prevKey === column) {
    return { key: column, dir: prevDir === "asc" ? "desc" : "asc" };
  }
  return { key: column, dir: "asc" };
}

export function cmpText(a: unknown, b: unknown, dir: SortDir): number {
  const r = String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return dir === "asc" ? r : -r;
}

export function cmpNum(a: unknown, b: unknown, dir: SortDir): number {
  const na = Number(a);
  const nb = Number(b);
  const av = Number.isFinite(na) ? na : 0;
  const bv = Number.isFinite(nb) ? nb : 0;
  const r = av - bv;
  return dir === "asc" ? r : -r;
}
