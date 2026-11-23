/**
 * Leave page department filter helpers.
 * Exact name match, plus org chip match (DM ↔ Digital Marketing) —
 * never cross chips (DM must not match IT / Medical Billing).
 */

import { orgDeptChipLabel } from "@/app/admin/roles-permissions/system-control-data";

export function normLeaveDept(name: unknown): string {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when row department matches the selected filter (or filter is empty). */
export function leaveDeptMatches(
  rowDepartment: unknown,
  selectedFilter: string,
): boolean {
  const filterRaw = String(selectedFilter || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!filterRaw) return true;

  const rowRaw = String(rowDepartment || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!rowRaw || rowRaw === "-") return false;

  if (normLeaveDept(rowRaw) === normLeaveDept(filterRaw)) return true;

  const filterChip = normLeaveDept(orgDeptChipLabel(filterRaw) || "");
  const rowChip = normLeaveDept(orgDeptChipLabel(rowRaw) || "");
  if (filterChip && rowChip && filterChip === rowChip) return true;

  return false;
}
