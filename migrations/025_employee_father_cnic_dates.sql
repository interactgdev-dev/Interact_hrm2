-- Add father_name + CNIC issuance/expiry dates on hrm_employees.
-- CNIC address column remains in DB for legacy data; form no longer collects it.

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'father_name'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN father_name VARCHAR(150) NULL DEFAULT NULL AFTER last_name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'cnic_issuance_date'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN cnic_issuance_date DATE NULL DEFAULT NULL AFTER cnic_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'cnic_expiry_date'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN cnic_expiry_date DATE NULL DEFAULT NULL AFTER cnic_issuance_date',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
