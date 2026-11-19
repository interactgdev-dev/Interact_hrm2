-- Staging/older dumps sometimes recreate tables with `id` NOT NULL but without AUTO_INCREMENT.
-- Onboarding Job Details INSERT omits `id`, so MySQL errors: Field 'id' doesn't have a default value.

-- employee_jobs
SET @has_pk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_jobs' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);
SET @sql := IF(@has_pk = 0,
  'ALTER TABLE employee_jobs ADD PRIMARY KEY (id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ai := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_jobs' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%'
);
SET @sql := IF(@ai = 0,
  'ALTER TABLE employee_jobs MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_contacts (Contact Details tab)
SET @has_pk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_contacts' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);
SET @sql := IF(@has_pk = 0,
  'ALTER TABLE employee_contacts ADD PRIMARY KEY (id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ai := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_contacts' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%'
);
SET @sql := IF(@ai = 0,
  'ALTER TABLE employee_contacts MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_emergency_contacts
SET @tbl := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_emergency_contacts'
);
SET @has_pk := IF(@tbl = 0, 1, (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_emergency_contacts' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
));
SET @sql := IF(@tbl > 0 AND @has_pk = 0,
  'ALTER TABLE employee_emergency_contacts ADD PRIMARY KEY (id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ai := IF(@tbl = 0, 1, (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_emergency_contacts' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%'
));
SET @sql := IF(@tbl > 0 AND @ai = 0,
  'ALTER TABLE employee_emergency_contacts MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_salaries
SET @has_pk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_salaries' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);
SET @sql := IF(@has_pk = 0,
  'ALTER TABLE employee_salaries ADD PRIMARY KEY (id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ai := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_salaries' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%'
);
SET @sql := IF(@ai = 0,
  'ALTER TABLE employee_salaries MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_leave_allowances
SET @has_pk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_leave_allowances' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);
SET @sql := IF(@has_pk = 0,
  'ALTER TABLE employee_leave_allowances ADD PRIMARY KEY (id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ai := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_leave_allowances' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%'
);
SET @sql := IF(@ai = 0,
  'ALTER TABLE employee_leave_allowances MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Appraisal timing columns used by Job Details save (idempotent)
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_jobs' AND COLUMN_NAME = 'first_appraisal_months'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_jobs ADD COLUMN first_appraisal_months TINYINT UNSIGNED NULL AFTER joined_date',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_jobs' AND COLUMN_NAME = 'second_appraisal_months'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE employee_jobs ADD COLUMN second_appraisal_months TINYINT UNSIGNED NULL AFTER first_appraisal_months',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
