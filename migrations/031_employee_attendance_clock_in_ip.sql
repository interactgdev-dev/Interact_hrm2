-- Audit: store client IP on employee clock-in / clock-out (investigation only; not a UI field).

SET @col_in := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_attendance'
    AND COLUMN_NAME = 'clock_in_ip'
);

SET @sql_in := IF(
  @col_in = 0,
  'ALTER TABLE employee_attendance ADD COLUMN clock_in_ip VARCHAR(64) NULL DEFAULT NULL COMMENT ''Client IP at clock-in (server audit)'' AFTER late_minutes',
  'SELECT 1'
);

PREPARE stmt_in FROM @sql_in;
EXECUTE stmt_in;
DEALLOCATE PREPARE stmt_in;

SET @col_out := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_attendance'
    AND COLUMN_NAME = 'clock_out_ip'
);

SET @sql_out := IF(
  @col_out = 0,
  'ALTER TABLE employee_attendance ADD COLUMN clock_out_ip VARCHAR(64) NULL DEFAULT NULL COMMENT ''Client IP at clock-out (server audit)'' AFTER clock_in_ip',
  'SELECT 1'
);

PREPARE stmt_out FROM @sql_out;
EXECUTE stmt_out;
DEALLOCATE PREPARE stmt_out;
