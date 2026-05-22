// POST: Submit a new leave request
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_id, employee_name, leave_category, start_date, end_date, total_days, reason, document_paths } = body;
    if (!employee_id || !leave_category || !start_date || !end_date || !total_days) {
      return NextResponse.json({ success: false, error: "Missing required fields" });
    }
    await query(
      "INSERT INTO employee_leaves (employee_id, employee_name, leave_category, start_date, end_date, total_days, reason, status, document_paths, requested_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())",
      [employee_id, employee_name || '', leave_category, start_date, end_date, total_days, reason || '', JSON.stringify(document_paths || [])]
    );
    // WebSocket broadcast (if available)
    try {
      const wsApi = globalThis as any;
      if (wsApi?.wss) {
        wsApi.wss.clients.forEach((client: any) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: "leave_update" }));
          }
        });
      }
    } catch {}
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
}
import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../lib/db";

// GET: Fetch all leave requests
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeesParam = searchParams.get('employees');
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');
    const status = searchParams.get('status');

    let sql = "SELECT * FROM employee_leaves WHERE 1=1";
    const params: any[] = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    if (employeesParam) {
      const employees = employeesParam.split(',').map(e => e.trim()).filter(Boolean);
      if (employees.length > 0) {
        sql += ` AND employee_id IN (${employees.map(() => '?').join(',')})`;
        params.push(...employees);
      }
    }

    if (fromDate && toDate) {
      // leave overlaps with range: (start_date <= toDate AND end_date >= fromDate)
      sql += ' AND start_date <= ? AND end_date >= ?';
      params.push(toDate, fromDate);
    } else if (fromDate) {
      sql += ' AND end_date >= ?';
      params.push(fromDate);
    } else if (toDate) {
      sql += ' AND start_date <= ?';
      params.push(toDate);
    }

    sql += ' ORDER BY requested_at DESC';
    const [rows] = (await query(sql, params)) as any;
    const leaves = Array.isArray(rows) ? rows : [];
    return NextResponse.json({ success: true, leaves });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

// PATCH: Update leave status (approve/reject)
export async function PATCH(req: NextRequest) {
  try {
    const { id, status, admin_remark } = await req.json();
    if (!id || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ success: false, error: "Invalid data" });
    }
    if (status === "rejected") {
      await query("UPDATE employee_leaves SET status = ?, admin_remark = ?, updated_at = NOW() WHERE id = ?", [status, admin_remark || "", id]);
    } else {
      await query("UPDATE employee_leaves SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
    }
    // WebSocket broadcast (if available)
    try {
      const wsApi = globalThis as any;
      if (wsApi?.wss) {
        wsApi.wss.clients.forEach((client: any) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: "leave_update" }));
          }
        });
      }
    } catch {}
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
}
