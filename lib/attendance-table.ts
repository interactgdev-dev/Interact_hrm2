export const ATTENDANCE_TABLE = "employee_attendance";

export async function ensureAttendanceTable(conn: {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
}) {
  const createSql = `
    CREATE TABLE IF NOT EXISTS ${ATTENDANCE_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id VARCHAR(50) NOT NULL,
      employee_name VARCHAR(150) NULL,
      date DATE NOT NULL,
      clock_in DATETIME NULL,
      clock_out DATETIME NULL,
      total_hours DECIMAL(5,2) NULL,
      late_minutes INT NULL DEFAULT NULL,
      auto_clock_out TINYINT(1) NOT NULL DEFAULT 0,
      last_presence_ack_at DATETIME NULL,
      INDEX (employee_id),
      INDEX (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await conn.execute(createSql);

  const columns: [string, string][] = [
    ["auto_clock_out", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["last_presence_ack_at", "DATETIME NULL"],
    ["late_minutes", "INT NULL DEFAULT NULL"],
    ["clock_in_ip", "VARCHAR(64) NULL DEFAULT NULL"],
    ["clock_out_ip", "VARCHAR(64) NULL DEFAULT NULL"],
  ];
  for (const [name, def] of columns) {
    try {
      await conn.execute(`ALTER TABLE ${ATTENDANCE_TABLE} ADD COLUMN ${name} ${def}`);
    } catch (err: unknown) {
      const code = (err as { errno?: number; code?: string })?.code;
      const errno = (err as { errno?: number })?.errno;
      if (code !== "ER_DUP_FIELDNAME" && errno !== 1060) throw err;
    }
  }
}
