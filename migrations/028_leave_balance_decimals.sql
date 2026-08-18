-- Allow half-day leave balance adjustments (0.5, 1.5, ...)

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'employee_leave_allowances'
        AND COLUMN_NAME = 'annual_balance_adjustment'
    ),
    'ALTER TABLE employee_leave_allowances MODIFY COLUMN annual_balance_adjustment DECIMAL(8,2) DEFAULT 0',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'employee_leave_allowances'
        AND COLUMN_NAME = 'bereavement_balance_adjustment'
    ),
    'ALTER TABLE employee_leave_allowances MODIFY COLUMN bereavement_balance_adjustment DECIMAL(8,2) DEFAULT 0',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
