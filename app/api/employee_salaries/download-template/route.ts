import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool } from "@/lib/db";
import {
  resolveViewerDataScope,
  rowInViewerScope,
} from "@/lib/access-control/data-scope";
import {
  filterSalariesForViewer,
  viewerIdFromRequest,
} from "@/lib/access-control/salary-visibility";

function asEmployeeId(raw: unknown): string {
  return String(raw ?? "").trim();
}

function fullName(row: Record<string, unknown>): string {
  const parts = [row.first_name, row.middle_name, row.last_name]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean);
  return parts.join(" ") || "";
}

function normalizeViewerEmployeeId(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^\d+$/.test(v)) return String(Number(v));
  return "";
}

/** Mongo SQL adapter does not support SUM/GROUP BY — aggregate in JS. */
function salaryAmountByEmployee(
  salaryRows: Array<Record<string, unknown>>,
): Map<string, number> {
  const byEmp = new Map<string, number>();
  for (const s of salaryRows) {
    const eid = asEmployeeId(s.employee_id);
    if (!eid) continue;
    const amt = Number(s.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const prev = byEmp.get(eid) || 0;
    byEmp.set(eid, prev + amt);
    if (/^\d+$/.test(eid)) byEmp.set(String(Number(eid)), prev + amt);
  }
  return byEmp;
}

/**
 * GET /api/employee_salaries/download-template
 * Excel: Employee ID | Full Name | Pseudo Name | Basic Salary
 * Existing salaries are pre-filled; blank = none yet.
 */
export async function GET(req: NextRequest) {
  try {
    const viewerRaw = viewerIdFromRequest(req) || req.nextUrl.searchParams.get("viewerId") || "";
    const viewerId = normalizeViewerEmployeeId(viewerRaw);

    const [employees]: any = await pool.execute(`
      SELECT
        e.id AS employee_id,
        e.first_name,
        e.middle_name,
        e.last_name,
        e.pseudonym,
        d.name AS department_name
      FROM hrm_employees e
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      WHERE e.status IS NULL OR e.status IN ('enabled', 'active', 'Enabled', 'Active')
      ORDER BY e.id ASC
    `);
    const [salaryRows]: any = await pool.execute(`
      SELECT employee_id, amount FROM employee_salaries
    `);

    const amounts = salaryAmountByEmployee(
      (salaryRows || []) as Record<string, unknown>[],
    );

    let rows = ((employees || []) as Record<string, unknown>[]).map((e) => {
      const eid = asEmployeeId(e.employee_id);
      const amt =
        amounts.get(eid) ||
        (/^\d+$/.test(eid) ? amounts.get(String(Number(eid))) : undefined) ||
        0;
      return {
        employee_id: /^\d+$/.test(eid) ? Number(eid) : eid,
        full_name: fullName(e),
        first_name: e.first_name ?? null,
        last_name: e.last_name ?? null,
        pseudonym: e.pseudonym ?? null,
        department_name: e.department_name ?? null,
        amount: amt > 0 ? amt : 0,
      };
    });

    if (viewerId) {
      const scope = await resolveViewerDataScope(viewerId);
      rows = rows.filter((r) =>
        rowInViewerScope(scope, {
          employeeId: r.employee_id,
          departmentName: r.department_name as string | null,
        }),
      );
      rows = (await filterSalariesForViewer(
        viewerId,
        rows as Record<string, unknown>[],
      )) as typeof rows;
    }

    const excelData = rows.map((r) => ({
      "Employee ID": r.employee_id,
      "Full Name": r.full_name,
      "Pseudo Name": r.pseudonym ? String(r.pseudonym) : "",
      "Basic Salary": Number(r.amount) > 0 ? Number(r.amount) : "",
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    ws["!cols"] = [
      { wch: 12 },
      { wch: 28 },
      { wch: 18 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Salaries");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="employee-salary-template.xlsx"',
      },
    });
  } catch (err) {
    console.error("salary download-template:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
