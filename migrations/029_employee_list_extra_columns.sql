-- Staging (and any older MySQL DBs) may be missing columns used by Employee List /
-- Add Employee after feature push. Safe to re-run: each ALTER is guarded.

-- hrm_employees.father_name
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'father_name'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN father_name VARCHAR(150) NULL DEFAULT NULL AFTER last_name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- hrm_employees.cnic_issuance_date
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'cnic_issuance_date'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN cnic_issuance_date DATE NULL DEFAULT NULL AFTER cnic_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- hrm_employees.cnic_expiry_date
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'cnic_expiry_date'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN cnic_expiry_date DATE NULL DEFAULT NULL AFTER cnic_issuance_date',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- hrm_employees.blood_group
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'blood_group'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE hrm_employees ADD COLUMN blood_group VARCHAR(10) NULL DEFAULT NULL AFTER nationality',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_contacts permanent address
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

-- employee_salaries.fuel_allowance (Employee List / payroll)
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_salaries' AND COLUMN_NAME = 'fuel_allowance'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_salaries ADD COLUMN fuel_allowance DECIMAL(12,2) NULL DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_salaries.company_transport_deduction
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_salaries' AND COLUMN_NAME = 'company_transport_deduction'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_salaries ADD COLUMN company_transport_deduction DECIMAL(12,2) NULL DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
