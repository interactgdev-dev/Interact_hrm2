-- Maternity (90) / Paternity (5) leave balances + category support

SET @db := DATABASE();

-- maternity_balance_adjustment
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leave_allowances'
    AND COLUMN_NAME = 'maternity_balance_adjustment'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE employee_leave_allowances ADD COLUMN maternity_balance_adjustment DECIMAL(8,2) DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- paternity_balance_adjustment
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leave_allowances'
    AND COLUMN_NAME = 'paternity_balance_adjustment'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE employee_leave_allowances ADD COLUMN paternity_balance_adjustment DECIMAL(8,2) DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- maternity_allowance (policy default 90; stored for reference)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leave_allowances'
    AND COLUMN_NAME = 'maternity_allowance'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE employee_leave_allowances ADD COLUMN maternity_allowance INT DEFAULT 90',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- paternity_allowance (policy default 5)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leave_allowances'
    AND COLUMN_NAME = 'paternity_allowance'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE employee_leave_allowances ADD COLUMN paternity_allowance INT DEFAULT 5',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Allow maternity/paternity on leave rows (VARCHAR is safer than expanding ENUM)
SET @col_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leaves' AND COLUMN_NAME = 'leave_category'
  LIMIT 1
);
SET @sql := IF(
  @col_type = 'enum',
  'ALTER TABLE employee_leaves MODIFY COLUMN leave_category VARCHAR(32) NOT NULL DEFAULT ''annual''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
