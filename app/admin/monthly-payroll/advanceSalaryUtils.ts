// Utility to fetch advance salary for employees for a given month
export async function fetchAdvanceSalary(month: string) {
  const response = await fetch(`/api/advance-salary?month=${month}`, { cache: "no-store" });
  const data = await response.json();
  if (data.success && Array.isArray(data.records)) {
    // Map employee_id to advance_amount
    const map: Record<string, number> = {};
    data.records.forEach((row: any) => {
      if (row.employee_id && row.advance_amount !== undefined) {
        const key = String(row.employee_id);
        if (map[key] === undefined) map[key] = Number(row.advance_amount);
      }
    });
    return map;
  }
  return {};
}
