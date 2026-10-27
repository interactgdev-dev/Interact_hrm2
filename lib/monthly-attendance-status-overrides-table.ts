import "server-only";

import { pool } from "@/lib/db";
import {
  isAllowedMonthlyAttendanceStatus,
  normalizeAttendanceStatus,
} from "@/lib/attendance-status";

export const MONTHLY_STATUS_OVERRIDES_TABLE = "monthly_attendance_status_overrides";

export type MonthlyStatusOverrideRow = {
  employee_id: string;
  attendance_date: string;
  /** 0 = whole day (legacy); >0 = specific attendance session/record */
  attendance_id: number;
  status_label: string;
  reason: string | null;
  updated_by: string | null;
};

function normalizeDateKey(value: string): string {
  return String(value || "").trim().slice(0, 10);
}

function normalizeReason(value: string | null | undefined): string | null {
  const t = String(value ?? "").trim();
  return t || null;
}

function normalizeAttendanceId(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function ensureMonthlyStatusOverridesTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${MONTHLY_STATUS_OVERRIDES_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id VARCHAR(64) NOT NULL,
      attendance_date DATE NOT NULL,
      attendance_id INT NOT NULL DEFAULT 0,
      status_label VARCHAR(64) NOT NULL,
      reason TEXT NULL,
      updated_by VARCHAR(128) NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_monthly_att_status_emp_date_att (employee_id, attendance_date, attendance_id),
      KEY idx_monthly_att_status_date (attendance_date)
    )
  `);

  try {
    await pool.execute(
      `ALTER TABLE ${MONTHLY_STATUS_OVERRIDES_TABLE} ADD COLUMN reason TEXT NULL`,
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const errno = (err as { errno?: number })?.errno;
    if (code !== "ER_DUP_FIELDNAME" && errno !== 1060) throw err;
  }

  try {
    await pool.execute(
      `ALTER TABLE ${MONTHLY_STATUS_OVERRIDES_TABLE}
       ADD COLUMN attendance_id INT NOT NULL DEFAULT 0 AFTER attendance_date`,
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const errno = (err as { errno?: number })?.errno;
    if (code !== "ER_DUP_FIELDNAME" && errno !== 1060) throw err;
  }

  try {
    await pool.execute(
      `ALTER TABLE ${MONTHLY_STATUS_OVERRIDES_TABLE}
       DROP INDEX uq_monthly_att_status_emp_date`,
    );
  } catch {
    /* old index may already be gone */
  }

  try {
    await pool.execute(
      `ALTER TABLE ${MONTHLY_STATUS_OVERRIDES_TABLE}
       ADD UNIQUE KEY uq_monthly_att_status_emp_date_att (employee_id, attendance_date, attendance_id)`,
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const errno = (err as { errno?: number })?.errno;
    // Duplicate key name / already exists
    if (code !== "ER_DUP_KEYNAME" && errno !== 1061) {
      // Some drivers use different codes — ignore if unique already present
      const msg = String((err as Error)?.message || "");
      if (!/duplicate|exists/i.test(msg)) throw err;
    }
  }
}

export async function listMonthlyStatusOverridesInRange(
  fromDate: string,
  toDate: string,
  employeeId?: string,
): Promise<MonthlyStatusOverrideRow[]> {
  await ensureMonthlyStatusOverridesTable();
  const from = normalizeDateKey(fromDate);
  const to = normalizeDateKey(toDate);
  if (!from || !to) return [];

  const normalizeRows = (rows: unknown): MonthlyStatusOverrideRow[] =>
    ((rows as MonthlyStatusOverrideRow[]) || []).map((r) => ({
      ...r,
      employee_id: String(r.employee_id ?? "").trim(),
      attendance_date: normalizeDateKey(String(r.attendance_date ?? "")),
      attendance_id: normalizeAttendanceId(
        (r as { attendance_id?: unknown }).attendance_id,
      ),
      status_label: String(r.status_label ?? ""),
      reason: r.reason ?? null,
      updated_by: r.updated_by ?? null,
    }));

  if (employeeId) {
    const [rows] = await pool.execute(
      `SELECT employee_id,
              DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
              attendance_id,
              status_label, reason, updated_by
       FROM ${MONTHLY_STATUS_OVERRIDES_TABLE}
       WHERE attendance_date BETWEEN ? AND ?
         AND employee_id = ?
       ORDER BY attendance_date ASC, attendance_id ASC`,
      [from, to, String(employeeId).trim()],
    );
    return normalizeRows(rows);
  }

  const [rows] = await pool.execute(
    `SELECT employee_id,
            DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
            attendance_id,
            status_label, reason, updated_by
     FROM ${MONTHLY_STATUS_OVERRIDES_TABLE}
     WHERE attendance_date BETWEEN ? AND ?
     ORDER BY attendance_date ASC, attendance_id ASC`,
    [from, to],
  );
  return normalizeRows(rows);
}

export async function upsertMonthlyStatusOverride(opts: {
  employeeId: string;
  attendanceDate: string;
  statusLabel: string;
  reason: string;
  updatedBy?: string | null;
  attendanceId?: number | null;
}): Promise<MonthlyStatusOverrideRow> {
  await ensureMonthlyStatusOverridesTable();
  const employeeId = String(opts.employeeId || "").trim();
  const attendanceDate = normalizeDateKey(opts.attendanceDate);
  const attendanceId = normalizeAttendanceId(opts.attendanceId);
  const statusLabel = normalizeAttendanceStatus(opts.statusLabel);
  const reason = normalizeReason(opts.reason);
  if (!employeeId || !attendanceDate) {
    throw new Error("employeeId and attendanceDate are required");
  }
  if (!isAllowedMonthlyAttendanceStatus(statusLabel)) {
    throw new Error("Invalid status");
  }
  if (!reason) {
    throw new Error("Reason is required when changing status manually");
  }

  await pool.execute(
    `INSERT INTO ${MONTHLY_STATUS_OVERRIDES_TABLE}
       (employee_id, attendance_date, attendance_id, status_label, reason, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status_label = VALUES(status_label),
       reason = VALUES(reason),
       updated_by = VALUES(updated_by),
       updated_at = CURRENT_TIMESTAMP`,
    [
      employeeId,
      attendanceDate,
      attendanceId,
      statusLabel,
      reason,
      opts.updatedBy || null,
    ],
  );

  return {
    employee_id: employeeId,
    attendance_date: attendanceDate,
    attendance_id: attendanceId,
    status_label: statusLabel,
    reason,
    updated_by: opts.updatedBy || null,
  };
}

export async function deleteMonthlyStatusOverride(
  employeeId: string,
  attendanceDate: string,
  attendanceId?: number | null,
): Promise<boolean> {
  await ensureMonthlyStatusOverridesTable();
  const eid = String(employeeId || "").trim();
  const date = normalizeDateKey(attendanceDate);
  const attId = normalizeAttendanceId(attendanceId);
  if (!eid || !date) return false;
  const [result] = await pool.execute(
    `DELETE FROM ${MONTHLY_STATUS_OVERRIDES_TABLE}
     WHERE employee_id = ? AND attendance_date = ? AND attendance_id = ?`,
    [eid, date, attId],
  );
  const info = result as { affectedRows?: number };
  return Number(info.affectedRows || 0) > 0;
}
