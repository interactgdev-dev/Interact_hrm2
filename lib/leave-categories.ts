/** Canonical leave categories for tickets / filters. */

export type LeaveCategoryValue =
  | "annual"
  | "bereavement"
  | "maternity"
  | "paternity";

export const MATERNITY_ALLOWANCE = 90;
export const PATERNITY_ALLOWANCE = 5;
export const BEREAVEMENT_ALLOWANCE = 3;

export const LEAVE_CATEGORY_OPTIONS: ReadonlyArray<{
  value: LeaveCategoryValue;
  label: string;
}> = [
  { value: "annual", label: "Annual" },
  { value: "bereavement", label: "Bereavement" },
  { value: "maternity", label: "Maternity" },
  { value: "paternity", label: "Paternity" },
];

export function normalizeEmployeeGender(
  gender: string | null | undefined,
): "male" | "female" | "" {
  const g = String(gender || "").trim().toLowerCase();
  if (g === "male" || g === "m") return "male";
  if (g === "female" || g === "f") return "female";
  return "";
}

/** HR / admin filters — always all four. */
export function leaveCategoriesForHr(): typeof LEAVE_CATEGORY_OPTIONS {
  return LEAVE_CATEGORY_OPTIONS;
}

/**
 * Employee create-ticket list: Annual + Bereavement always;
 * Maternity for female, Paternity for male.
 * Unknown gender: Annual + Bereavement only (no mat/pat).
 */
export function leaveCategoriesForEmployeeGender(
  gender: string | null | undefined,
): Array<{ value: LeaveCategoryValue; label: string }> {
  const g = normalizeEmployeeGender(gender);
  return LEAVE_CATEGORY_OPTIONS.filter((c) => {
    if (c.value === "maternity") return g === "female";
    if (c.value === "paternity") return g === "male";
    return true;
  });
}

export function titleCaseLeaveCategory(raw: string): string {
  const s = String(raw || "").trim().toLowerCase();
  const hit = LEAVE_CATEGORY_OPTIONS.find((c) => c.value === s);
  if (hit) return hit.label;
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
