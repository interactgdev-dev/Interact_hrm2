-- Per attendance-session status overrides (same calendar day can have independent statuses).
-- attendance_id = 0 → day-level (legacy). attendance_id > 0 → that HRM attendance row only.

SET @col_att := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monthly_attendance_status_overrides'
    AND COLUMN_NAME = 'attendance_id'
);

SET @sql_att := IF(
  @col_att = 0,
  'ALTER TABLE monthly_attendance_status_overrides ADD COLUMN attendance_id INT NOT NULL DEFAULT 0 AFTER attendance_date',
  'SELECT 1'
);

PREPARE stmt_att FROM @sql_att;
EXECUTE stmt_att;
DEALLOCATE PREPARE stmt_att;

-- Replace unique (employee_id, attendance_date) with (employee_id, attendance_date, attendance_id)
SET @idx_old := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monthly_attendance_status_overrides'
    AND INDEX_NAME = 'uq_monthly_att_status_emp_date'
);

SET @sql_drop_old := IF(
  @idx_old > 0,
  'ALTER TABLE monthly_attendance_status_overrides DROP INDEX uq_monthly_att_status_emp_date',
  'SELECT 1'
);

PREPARE stmt_drop_old FROM @sql_drop_old;
EXECUTE stmt_drop_old;
DEALLOCATE PREPARE stmt_drop_old;

SET @idx_new := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monthly_attendance_status_overrides'
    AND INDEX_NAME = 'uq_monthly_att_status_emp_date_att'
);

SET @sql_add_new := IF(
  @idx_new = 0,
  'ALTER TABLE monthly_attendance_status_overrides ADD UNIQUE KEY uq_monthly_att_status_emp_date_att (employee_id, attendance_date, attendance_id)',
  'SELECT 1'
);

PREPARE stmt_add_new FROM @sql_add_new;
EXECUTE stmt_add_new;
DEALLOCATE PREPARE stmt_add_new;
