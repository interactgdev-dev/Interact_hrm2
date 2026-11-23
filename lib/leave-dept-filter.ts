/**
 * Leave page department filter helpers.
 * Strict match only (trim + case-insensitive) — do not fold Marketing→IT etc.
 */

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
  const filter = normLeaveDept(selectedFilter);
  if (!filter) return true;
  const row = normLeaveDept(rowDepartment);
  if (!row || row === "-") return false;
  return row === filter;
}
