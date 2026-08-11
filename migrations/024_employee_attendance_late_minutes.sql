-- Persist clock-in late minutes on attendance rows (monthly attendance / audit).
-- UI shows Late time when late_minutes > 60; first-3 tardy deduction rules unchanged.

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_attendance'
    AND COLUMN_NAME = 'late_minutes'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE employee_attendance ADD COLUMN late_minutes INT NULL DEFAULT NULL COMMENT ''Minutes late past shift start (grace applied); NULL = not computed'' AFTER total_hours',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
