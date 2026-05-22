export async function fetchLoanSalary(month: string): Promise<Record<string, number>> {
  try {
    const response = await fetch(`/api/loan-installments?month=${month}`, { cache: "no-store" });
    const data = await response.json();
    if (!data?.success || !Array.isArray(data.records)) return {};

    const map: Record<string, number> = {};
    data.records.forEach((row: any) => {
      const empId = String(row.employee_id);
      const val = Number(row.payable_this_month ?? row.original_amount ?? 0);
      if (!Number.isFinite(val)) return;
      map[empId] = (map[empId] || 0) + val;
    });
    return map;
  } catch {
    return {};
  }
}
