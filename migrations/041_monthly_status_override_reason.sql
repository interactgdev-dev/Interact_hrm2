-- Reason/note when admin manually changes monthly attendance status.

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monthly_attendance_status_overrides'
    AND COLUMN_NAME = 'reason'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE monthly_attendance_status_overrides ADD COLUMN reason TEXT NULL AFTER status_label',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
