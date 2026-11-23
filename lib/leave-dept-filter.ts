/**
 * Leave page department filter — strict exact department name only.
 * Do NOT fold Marketing → IT (org chart chips); selecting Marketing must hide IT rows.
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
  const filterRaw = String(selectedFilter || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!filterRaw) return true;

  const rowRaw = String(rowDepartment || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!rowRaw || rowRaw === "-") return false;

  // Exact name only (case/whitespace insensitive). Marketing ≠ IT.
  if (normLeaveDept(rowRaw) === normLeaveDept(filterRaw)) return true;

  // DM aliases only — never fold Marketing into IT.
  const f = normLeaveDept(filterRaw);
  const r = normLeaveDept(rowRaw);
  const isDm = (n: string) =>
    n === "dm" ||
    n === "digital marketing" ||
    n.startsWith("dm ") ||
    n.includes("digital marketing");
  if (isDm(f) && isDm(r)) return true;

  return false;
}
