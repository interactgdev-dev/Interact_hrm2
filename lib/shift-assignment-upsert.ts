import type { PoolConnection } from "mysql2/promise";
import { ensureLegacyEmployeeRow } from "@/lib/ensure-legacy-employee-row";

export function normalizeShiftTimeValue(time: string): string {
  const t = String(time || "").trim();
  if (!t) return t;
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t;
}

export async function upsertShiftAssignment(
  conn: PoolConnection,
  empId: number,
  shiftName: string,
  startTime: string,
  endTime: string,
  assignDate: string,
  allowOT: boolean,
) {
  const [hrmRows] = await conn.execute(
    `SELECT first_name, last_name FROM hrm_employees WHERE id = ? LIMIT 1`,
    [empId],
  );
  const hrm = (hrmRows as Array<{ first_name?: string; last_name?: string }>)[0];
  if (!hrm) {
    throw new Error(`Employee id ${empId} not found`);
  }

  const employeeName = `${hrm.first_name || ""} ${hrm.last_name || ""}`.trim();
  await ensureLegacyEmployeeRow(conn, String(empId), employeeName);

  const start = normalizeShiftTimeValue(startTime);
  const end = normalizeShiftTimeValue(endTime);

  const [existing] = await conn.execute(
    `SELECT id FROM shift_assignments WHERE employee_id = ? AND assigned_date = ?`,
    [empId, assignDate],
  );
  const rows = existing as { id: number }[];

  if (rows.length > 0) {
    await conn.execute(
      `UPDATE shift_assignments
       SET shift_name = ?, start_time = ?, end_time = ?, allow_overtime = ?, updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = ? AND assigned_date = ?`,
      [shiftName, start, end, allowOT ? 1 : 0, empId, assignDate],
    );
    return;
  }

  await conn.execute(
    `INSERT INTO shift_assignments
     (employee_id, shift_name, start_time, end_time, assigned_date, allow_overtime)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [empId, shiftName, start, end, assignDate, allowOT ? 1 : 0],
  );
}
