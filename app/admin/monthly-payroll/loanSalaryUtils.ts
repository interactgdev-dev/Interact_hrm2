import { fetchPayrollLoanAdvance } from "./advanceSalaryUtils";

/** @deprecated Prefer fetchPayrollLoanAdvance */
export async function fetchLoanSalary(month: string): Promise<Record<string, number>> {
  const data = await fetchPayrollLoanAdvance(month);
  return data.loans;
}
