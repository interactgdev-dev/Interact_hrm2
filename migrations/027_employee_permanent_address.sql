-- Permanent address fields on employee_contacts (alongside current address)

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_contacts' AND COLUMN_NAME = 'permanent_street'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_contacts ADD COLUMN permanent_street VARCHAR(500) NULL DEFAULT NULL AFTER country',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_contacts' AND COLUMN_NAME = 'permanent_city'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_contacts ADD COLUMN permanent_city VARCHAR(100) NULL DEFAULT NULL AFTER permanent_street',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_contacts' AND COLUMN_NAME = 'permanent_state'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_contacts ADD COLUMN permanent_state VARCHAR(100) NULL DEFAULT NULL AFTER permanent_city',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_contacts' AND COLUMN_NAME = 'permanent_zip'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_contacts ADD COLUMN permanent_zip VARCHAR(30) NULL DEFAULT NULL AFTER permanent_state',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_contacts' AND COLUMN_NAME = 'permanent_country'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_contacts ADD COLUMN permanent_country VARCHAR(100) NULL DEFAULT NULL AFTER permanent_zip',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
