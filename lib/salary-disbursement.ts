/** Bank name is stored on employee_salaries.routing_number (Add Employee → Salary → Bank Name). */

export type SalaryBankGroup = "askari" | "other";
export type SalaryDisbursementStatus = "paid" | "unpaid";

export function isAskariBank(bankName: string | null | undefined): boolean {
  const t = String(bankName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t) return false;
  return t.includes("askari");
}

export function bankGroupFromName(
  bankName: string | null | undefined,
): SalaryBankGroup {
  return isAskariBank(bankName) ? "askari" : "other";
}

export function normalizeDisbursementStatus(
  raw: string | null | undefined,
): SalaryDisbursementStatus {
  return String(raw || "").trim().toLowerCase() === "paid" ? "paid" : "unpaid";
}
