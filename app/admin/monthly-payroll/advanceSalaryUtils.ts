/** @deprecated Prefer fetchPayrollLoanAdvance — kept for compatibility */
export async function fetchAdvanceSalary(month: string) {
  const data = await fetchPayrollLoanAdvance(month);
  return data.advances;
}

export async function fetchPayrollLoanAdvance(month: string): Promise<{
  advances: Record<string, number>;
  loans: Record<string, number>;
  combined: Record<string, number>;
  breakdown: Record<string, { advance: number; loan: number; total: number }>;
}> {
  const empty = { advances: {}, loans: {}, combined: {}, breakdown: {} };
  if (!month) return empty;
  try {
    const res = await fetch(
      `/api/payroll-loan-advance?month=${encodeURIComponent(month)}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!data?.success) return empty;
    return {
      advances: data.advances || {},
      loans: data.loans || {},
      combined: data.combined || {},
      breakdown: data.breakdown || {},
    };
  } catch {
    return empty;
  }
}
