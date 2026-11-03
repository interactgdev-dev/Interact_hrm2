/** Office medical subscription packages — monthly payroll deduction + dashboard badge. */

export type MedicalPackageId = "silver" | "gold" | "platinum";

export const MEDICAL_PACKAGES: ReadonlyArray<{
  id: MedicalPackageId;
  label: string;
  monthlyDeduction: number;
  /** Diamond fill / accent for employee dashboard */
  diamondColor: string;
  diamondStroke: string;
}> = [
  {
    id: "silver",
    label: "Silver",
    monthlyDeduction: 1000,
    diamondColor: "#C0C7D1",
    diamondStroke: "#8A93A0",
  },
  {
    id: "gold",
    label: "Gold",
    monthlyDeduction: 2000,
    diamondColor: "#E6B422",
    diamondStroke: "#B8860B",
  },
  {
    id: "platinum",
    label: "Platinum",
    monthlyDeduction: 3000,
    diamondColor: "#A8D8FF",
    diamondStroke: "#5B8FB8",
  },
] as const;

export function normalizeMedicalPackage(
  raw: unknown,
): MedicalPackageId | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "silver" || v === "gold" || v === "platinum") return v;
  return null;
}

export function medicalDeductionForPackage(
  pkg: MedicalPackageId | null | undefined,
): number {
  if (!pkg) return 0;
  const found = MEDICAL_PACKAGES.find((p) => p.id === pkg);
  return found?.monthlyDeduction ?? 0;
}

export function medicalPackageMeta(pkg: MedicalPackageId | null | undefined) {
  if (!pkg) return null;
  return MEDICAL_PACKAGES.find((p) => p.id === pkg) ?? null;
}
