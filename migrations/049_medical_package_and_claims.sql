-- Medical package on employee salary (Silver 1k / Gold 2k / Platinum 3k monthly deduction).
-- Claims amount on monthly payroll adjustments (adds to salary / gross).

SET @col_pkg := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_salaries'
    AND COLUMN_NAME = 'medical_package'
);

SET @sql_pkg := IF(
  @col_pkg = 0,
  'ALTER TABLE employee_salaries ADD COLUMN medical_package varchar(20) DEFAULT NULL AFTER company_transport_deduction',
  'SELECT 1'
);

PREPARE stmt_pkg FROM @sql_pkg;
EXECUTE stmt_pkg;
DEALLOCATE PREPARE stmt_pkg;

SET @col_claims := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'monthly_payroll_adjustments'
    AND COLUMN_NAME = 'medical_claims'
);

SET @sql_claims := IF(
  @col_claims = 0,
  'ALTER TABLE monthly_payroll_adjustments ADD COLUMN medical_claims decimal(12,2) DEFAULT NULL AFTER unpaid_days',
  'SELECT 1'
);

PREPARE stmt_claims FROM @sql_claims;
EXECUTE stmt_claims;
DEALLOCATE PREPARE stmt_claims;
