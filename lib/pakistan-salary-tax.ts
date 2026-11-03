/**
 * Pakistan salaried individual income tax (Sec 149 / Division I Part I).
 * Tax Year 2026-27 slabs (Finance Act 2026) — progressive annual taxable income.
 *
 * Employer monthly withholding ≈ annual tax on (monthly gross × 12) ÷ 12.
 */

export type SalaryTaxSlab = {
  /** Inclusive upper bound of this band (Infinity for top). */
  upTo: number;
  /** Fixed tax for all income up to previous band's end. */
  baseTax: number;
  /** Rate on amount above previous band end. */
  rate: number;
  /** Lower bound exclusive for rate application (previous upTo). */
  excessOver: number;
};

/** Salaried person slabs — TY 2026-27. */
export const PAKISTAN_SALARIED_TAX_SLABS_TY2027: SalaryTaxSlab[] = [
  { upTo: 600_000, baseTax: 0, rate: 0, excessOver: 0 },
  { upTo: 1_200_000, baseTax: 0, rate: 0.01, excessOver: 600_000 },
  { upTo: 2_200_000, baseTax: 6_000, rate: 0.11, excessOver: 1_200_000 },
  { upTo: 3_200_000, baseTax: 116_000, rate: 0.2, excessOver: 2_200_000 },
  { upTo: 4_100_000, baseTax: 316_000, rate: 0.25, excessOver: 3_200_000 },
  { upTo: 5_600_000, baseTax: 541_000, rate: 0.29, excessOver: 4_100_000 },
  { upTo: 7_000_000, baseTax: 976_000, rate: 0.32, excessOver: 5_600_000 },
  { upTo: Infinity, baseTax: 1_424_000, rate: 0.35, excessOver: 7_000_000 },
];

/** Annual tax on annual taxable income (PKR). */
export function annualSalariedIncomeTax(
  annualTaxableIncome: number,
  slabs: SalaryTaxSlab[] = PAKISTAN_SALARIED_TAX_SLABS_TY2027,
): number {
  const income = Number(annualTaxableIncome);
  if (!Number.isFinite(income) || income <= 0) return 0;

  for (const slab of slabs) {
    if (income <= slab.upTo) {
      if (slab.rate <= 0) return slab.baseTax;
      return slab.baseTax + slab.rate * (income - slab.excessOver);
    }
  }
  return 0;
}

/**
 * Monthly tax from this month's taxable pay (Net before Tax / similar).
 * Annualize ×12 → slab tax → ÷12. Rounded to nearest rupee for payroll.
 */
export function monthlySalaryTaxFromGross(
  monthlyTaxable: number,
  slabs: SalaryTaxSlab[] = PAKISTAN_SALARIED_TAX_SLABS_TY2027,
): number {
  const monthly = Number(monthlyTaxable);
  if (!Number.isFinite(monthly) || monthly <= 0) return 0;
  const annual = monthly * 12;
  const annualTax = annualSalariedIncomeTax(annual, slabs);
  return Math.max(0, Math.round(annualTax / 12));
}
