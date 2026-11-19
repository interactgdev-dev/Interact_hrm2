import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../lib/db";

function viewerIdFrom(req: NextRequest) {
  return (
    req.headers.get("x-hrm-employee-id") ||
    req.headers.get("x-employee-id") ||
    req.nextUrl.searchParams.get("viewerId") ||
    ""
  ).trim();
}

export async function GET(req: NextRequest) {
  try {
    const sql = `
      SELECT 
        e.id,
        e.first_name,
        e.last_name,
        e.username,
        e.password,
        ec.email_work,
        ec.email_other,
        ec.phone_mobile,
        d.name AS department_name
      FROM hrm_employees e
      LEFT JOIN employee_contacts ec ON e.id = ec.employee_id
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      ORDER BY e.id
    `;

    const [rows] = (await query(sql)) as any;
    let employees = Array.isArray(rows) ? rows : [];

    const viewerId = viewerIdFrom(req);
    if (viewerId) {
      try {
        const { resolveViewerDataScope, rowInViewerScope } = await import(
          "@/lib/access-control/data-scope"
        );
        const scope = await resolveViewerDataScope(viewerId);
        if (scope.mode !== "all") {
          employees = employees.filter((e: any) =>
            rowInViewerScope(scope, {
              employeeId: e.id,
              departmentName: e.department_name,
            }),
          );
        }
      } catch {
        /* keep list if scope helper fails */
      }
    }

    return NextResponse.json({ success: true, employees });
  } catch (error: any) {
    console.error("Error fetching employee credentials:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

async function assertTargetInViewerScope(viewerId: string, targetId: string | number) {
  if (!viewerId) return true;
  const { resolveViewerDataScope, rowInViewerScope } = await import(
    "@/lib/access-control/data-scope"
  );
  const scope = await resolveViewerDataScope(viewerId);
  if (scope.mode === "all") return true;

  const [rows] = (await query(
    `SELECT d.name AS department_name
     FROM hrm_employees e
     LEFT JOIN employee_jobs j ON e.id = j.employee_id
     LEFT JOIN departments d ON j.department_id = d.id
     WHERE e.id = ?
     LIMIT 1`,
    [targetId],
  )) as any;
  const dept = Array.isArray(rows) && rows[0] ? rows[0].department_name : null;
  return rowInViewerScope(scope, {
    employeeId: targetId,
    departmentName: dept,
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, username, email, password, currentPassword } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Employee ID is required" },
        { status: 400 }
      );
    }

    const viewerId = viewerIdFrom(req);
    if (viewerId) {
      try {
        const ok = await assertTargetInViewerScope(viewerId, id);
        if (!ok) {
          return NextResponse.json(
            { success: false, error: "Out of scope for this employee" },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json(
          { success: false, error: "Scope check failed" },
          { status: 403 },
        );
      }
    }

    // Update username in hrm_employees table
    if (username !== undefined) {
      await query(
        `UPDATE hrm_employees SET username = ? WHERE id = ?`,
        [username, id]
      );
    }

    // Update password in hrm_employees table if provided (plain text)
    if (password !== undefined && password !== "") {
      if (currentPassword !== undefined) {
        const [rows] = (await query(
          `SELECT password FROM hrm_employees WHERE id = ? LIMIT 1`,
          [id]
        )) as [{ password?: string }[], unknown];
        const stored = Array.isArray(rows) && rows[0]?.password != null
          ? String(rows[0].password)
          : "";
        if (String(currentPassword) !== stored) {
          return NextResponse.json(
            { success: false, error: "Current password is incorrect" },
            { status: 400 }
          );
        }
      }
      await query(
        `UPDATE hrm_employees SET password = ? WHERE id = ?`,
        [password, id]
      );
    }

    // Update email in employee_contacts table
    if (email !== undefined) {
      const [contactCheck] = await query(
        `SELECT id FROM employee_contacts WHERE employee_id = ?`,
        [id]
      ) as any;

      if (contactCheck.length > 0) {
        await query(
          `UPDATE employee_contacts SET email_work = ? WHERE employee_id = ?`,
          [email, id]
        );
      } else {
        await query(
          `INSERT INTO employee_contacts (employee_id, email_work) VALUES (?, ?)`,
          [id, email]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error updating employee credentials:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
