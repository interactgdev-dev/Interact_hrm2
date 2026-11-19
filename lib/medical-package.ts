/** Office medical subscription packages — monthly payroll deduction + claim pools. */

export type MedicalPackageId = "silver" | "gold" | "platinum";

/** OPD (pharmacy / medicine / OPD) — same yearly pool for every employee. */
export const MEDICAL_OPD_ANNUAL_ENTITLEMENT = 150_000;

/**
 * IPD (hospital admission) yearly pool by subscribed package.
 * Silver 1k → 30k · Gold 2k → 40k · Platinum 3k → 50k.
 */
export const MEDICAL_IPD_ANNUAL_BY_PACKAGE: Record<MedicalPackageId, number> = {
  silver: 30_000,
  gold: 40_000,
  platinum: 50_000,
};

export const MEDICAL_PACKAGES: ReadonlyArray<{
  id: MedicalPackageId;
  label: string;
  monthlyDeduction: number;
  ipdAnnualEntitlement: number;
  opdAnnualEntitlement: number;
  /** Diamond fill / accent for employee dashboard */
  diamondColor: string;
  diamondStroke: string;
}> = [
  {
    id: "silver",
    label: "Silver",
    monthlyDeduction: 1000,
    ipdAnnualEntitlement: MEDICAL_IPD_ANNUAL_BY_PACKAGE.silver,
    opdAnnualEntitlement: MEDICAL_OPD_ANNUAL_ENTITLEMENT,
    diamondColor: "#C0C7D1",
    diamondStroke: "#8A93A0",
  },
  {
    id: "gold",
    label: "Gold",
    monthlyDeduction: 2000,
    ipdAnnualEntitlement: MEDICAL_IPD_ANNUAL_BY_PACKAGE.gold,
    opdAnnualEntitlement: MEDICAL_OPD_ANNUAL_ENTITLEMENT,
    diamondColor: "#E6B422",
    diamondStroke: "#B8860B",
  },
  {
    id: "platinum",
    label: "Platinum",
    monthlyDeduction: 3000,
    ipdAnnualEntitlement: MEDICAL_IPD_ANNUAL_BY_PACKAGE.platinum,
    opdAnnualEntitlement: MEDICAL_OPD_ANNUAL_ENTITLEMENT,
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

/** OPD yearly entitlement — all employees (150k). */
export function medicalOpdEntitlement(): number {
  return MEDICAL_OPD_ANNUAL_ENTITLEMENT;
}

/** IPD yearly entitlement from subscribed package (0 if none). */
export function medicalIpdEntitlementForPackage(
  pkg: MedicalPackageId | null | undefined,
): number {
  if (!pkg) return 0;
  return MEDICAL_IPD_ANNUAL_BY_PACKAGE[pkg] ?? 0;
}

export function medicalPackageMeta(pkg: MedicalPackageId | null | undefined) {
  if (!pkg) return null;
  return MEDICAL_PACKAGES.find((p) => p.id === pkg) ?? null;
}
