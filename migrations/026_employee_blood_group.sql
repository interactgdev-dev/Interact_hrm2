-- Blood group on employee personal record

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'blood_group'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN blood_group VARCHAR(10) NULL DEFAULT NULL AFTER nationality',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
