import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  buildActivitySummaryFromData,
  buildYearOverview,
  fetchAdvances,
  fetchLoansWithInstallments,
  reconcileLegacyFinancialHistory,
} from "@/lib/employee-financial-history";

function yearOrCurrent(raw: string | null): string {
  if (raw && /^\d{4}$/.test(raw)) return raw;
  return String(new Date().getFullYear());
}

async function employeeNameMap(ids: number[]) {
  if (ids.length === 0) return new Map<number, { name: string; pseudonym: string | null }>();
  const placeholders = ids.map(() => "?").join(",");
  const [rows]: any = await query(
    `SELECT id, first_name, middle_name, last_name, pseudonym
     FROM hrm_employees
     WHERE id IN (${placeholders})`,
    ids,
  );
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map<number, { name: string; pseudonym: string | null }>();
  for (const e of list) {
    const name = `${e.first_name || ""} ${e.middle_name || ""} ${e.last_name || ""}`
      .replace(/\s+/g, " ")
      .trim();
    map.set(Number(e.id), { name, pseudonym: e.pseudonym || null });
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = yearOrCurrent(searchParams.get("year"));
    const employeeIdRaw = searchParams.get("employee_id");
    const employeeId =
      employeeIdRaw && /^\d+$/.test(employeeIdRaw) ? Number(employeeIdRaw) : null;

    // Best-effort persist into history tables (never blocks reads)
    await reconcileLegacyFinancialHistory();

    if (employeeId == null) {
      const advances = await fetchAdvances({ year });
      const loans = await fetchLoansWithInstallments({ year });
      const overview = buildYearOverview(advances, loans, year);
      const summary = buildActivitySummaryFromData(advances, loans);
      const names = await employeeNameMap(summary.map((s) => s.employee_id));
      const employees = summary.map((s) => {
        const info = names.get(s.employee_id);
        return {
          ...s,
          employee_name: info?.name || `Employee #${s.employee_id}`,
          pseudonym: info?.pseudonym || null,
        };
      });

      return NextResponse.json({
        success: true,
        history_version: "legacy-merge-v2",
        year,
        employee_id: null,
        overview,
        employees,
        advances: [],
        loans: [],
      });
    }

    const advances = await fetchAdvances({ employeeId, year });
    const loans = await fetchLoansWithInstallments({ employeeId, year });
    const overview = buildYearOverview(advances, loans, year);
    const names = await employeeNameMap([employeeId]);
    const info = names.get(employeeId);

    return NextResponse.json({
      success: true,
      history_version: "legacy-merge-v2",
      year,
      employee_id: employeeId,
      employee_name: info?.name || `Employee #${employeeId}`,
      pseudonym: info?.pseudonym || null,
      overview,
      advances: advances.map((a) => ({
        ...a,
        amount: Number(a.amount) || 0,
      })),
      loans,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
