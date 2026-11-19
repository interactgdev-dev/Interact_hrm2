-- Half-day leave tickets: store 0.5 days + which half (1st / 2nd).

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'employee_leaves'
        AND COLUMN_NAME = 'total_days'
    ),
    'ALTER TABLE employee_leaves MODIFY COLUMN total_days DECIMAL(8,2) NOT NULL',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'employee_leaves'
        AND COLUMN_NAME = 'half_day_part'
    ),
    'SELECT 1',
    'ALTER TABLE employee_leaves ADD COLUMN half_day_part VARCHAR(16) NULL DEFAULT NULL'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
