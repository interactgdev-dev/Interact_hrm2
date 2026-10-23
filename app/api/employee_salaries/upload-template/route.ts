import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool } from "@/lib/db";
import {
  resolveViewerDataScope,
  rowInViewerScope,
} from "@/lib/access-control/data-scope";
import {
  resolveSalaryVisibility,
  viewerIdFromRequest,
} from "@/lib/access-control/salary-visibility";

function normalizeViewerEmployeeId(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^\d+$/.test(v)) return String(Number(v));
  return "";
}

function normHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_*]+/g, " ")
    .replace(/\s+/g, " ");
}

function cell(row: Record<string, unknown>, aliases: string[]): unknown {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const want = normHeader(alias);
    const hit = keys.find((k) => normHeader(k) === want);
    if (hit != null && row[hit] !== undefined && row[hit] !== null) {
      return row[hit];
    }
  }
  return undefined;
}

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function loadEmpDept(employeeId: string): Promise<{
  id: string;
  department_name: string | null;
} | null> {
  const idParam = /^\d+$/.test(employeeId) ? Number(employeeId) : employeeId;
  const [rows]: any = await pool.execute(
    `SELECT e.id, d.name AS department_name
     FROM hrm_employees e
     LEFT JOIN employee_jobs j ON e.id = j.employee_id
     LEFT JOIN departments d ON j.department_id = d.id
     WHERE e.id = ?
     LIMIT 1`,
    [idParam],
  );
  if (!rows?.[0]) return null;
  return {
    id: String(rows[0].id),
    department_name: rows[0].department_name
      ? String(rows[0].department_name)
      : null,
  };
}

async function upsertBasicSalary(employeeId: string, amount: number) {
  const idParam = /^\d+$/.test(employeeId) ? Number(employeeId) : employeeId;
  const [existing]: any = await pool.execute(
    `SELECT id, fuel_allowance, company_transport_deduction, pay_frequency, currency
     FROM employee_salaries WHERE employee_id = ? ORDER BY id DESC LIMIT 1`,
    [idParam],
  );

  if (existing?.[0]?.id) {
    await pool.execute(`UPDATE employee_salaries SET amount = ? WHERE id = ?`, [
      amount,
      existing[0].id,
    ]);
    return "updated" as const;
  }

  await pool.execute(
    `INSERT INTO employee_salaries
       (employee_id, component, pay_grade, pay_frequency, currency, amount, comments,
        direct_deposit, account_number, account_type, routing_number, deposit_amount,
        fuel_allowance, company_transport_deduction)
     VALUES (?, NULL, NULL, NULL, NULL, ?, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL)`,
    [idParam, amount],
  );
  return "inserted" as const;
}

/**
 * POST /api/employee_salaries/upload-template
 * Match by Employee ID. Blank Basic Salary cells are skipped (existing kept).
 * Filled amounts create or update salary.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "File is required" },
        { status: 400 },
      );
    }

    const viewerRaw =
      viewerIdFromRequest(req) ||
      String(formData.get("viewerId") || "").trim() ||
      "";
    const viewerId = normalizeViewerEmployeeId(viewerRaw);
    const scope = viewerId ? await resolveViewerDataScope(viewerId) : null;

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json(
        { success: false, error: "Excel file has no sheets" },
        { status: 400 },
      );
    }
    const data = XLSX.utils.sheet_to_json(
      workbook.Sheets[sheetName],
    ) as Record<string, unknown>[];

    if (!data.length) {
      return NextResponse.json(
        { success: false, error: "Excel file is empty" },
        { status: 400 },
      );
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // header is row 1
      const idRaw = cell(row, [
        "Employee ID",
        "Employee Id",
        "Id",
        "ID",
        "employee_id",
      ]);
      const employeeId = String(idRaw ?? "").trim();
      if (!employeeId) {
        skipped++;
        continue;
      }

      const amount = parseAmount(
        cell(row, ["Basic Salary", "Salary", "Amount", "basic_salary"]),
      );
      if (amount == null) {
        skipped++;
        continue;
      }
      if (amount < 0) {
        failed++;
        errors.push(`Row ${rowNum}: salary cannot be negative`);
        continue;
      }

      try {
        const emp = await loadEmpDept(employeeId);
        if (!emp) {
          failed++;
          errors.push(`Row ${rowNum}: employee ID ${employeeId} not found`);
          continue;
        }

        if (
          scope &&
          !rowInViewerScope(scope, {
            employeeId: emp.id,
            departmentName: emp.department_name,
          })
        ) {
          failed++;
          errors.push(`Row ${rowNum}: employee ${employeeId} out of your scope`);
          continue;
        }

        if (viewerId) {
          const canSee = await resolveSalaryVisibility(viewerId, emp.id);
          if (!canSee) {
            failed++;
            errors.push(
              `Row ${rowNum}: no salary permission for employee ${employeeId}`,
            );
            continue;
          }
        }

        const action = await upsertBasicSalary(emp.id, amount);
        if (action === "inserted") inserted++;
        else updated++;
      } catch (err) {
        failed++;
        errors.push(`Row ${rowNum}: ${String(err)}`);
      }
    }

    return NextResponse.json({
      success: true,
      summary: { inserted, updated, skipped, failed },
      errors: errors.slice(0, 40),
    });
  } catch (err) {
    console.error("salary upload-template:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}
