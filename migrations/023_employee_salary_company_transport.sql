-- Default Company Transport Deduction (CTD) on employee salary
-- Used by Monthly Payroll when no monthly override is set.
SET @col_ctd := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_salaries'
    AND COLUMN_NAME = 'company_transport_deduction'
);

SET @sql_ctd := IF(
  @col_ctd = 0,
  'ALTER TABLE employee_salaries ADD COLUMN company_transport_deduction decimal(12,2) DEFAULT NULL AFTER fuel_allowance',
  'SELECT 1'
);

PREPARE stmt_ctd FROM @sql_ctd;
EXECUTE stmt_ctd;
DEALLOCATE PREPARE stmt_ctd;

-- Allow NULL monthly CTD so payroll can fall back to employee default
SET @sql_null_ctd := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'monthly_payroll_adjustments'
       AND COLUMN_NAME = 'ctd'
       AND IS_NULLABLE = 'NO') > 0,
    'ALTER TABLE monthly_payroll_adjustments MODIFY COLUMN ctd decimal(12,2) DEFAULT NULL COMMENT ''NULL = use employee Allowances default''',
    'SELECT 1'
  )
);

PREPARE stmt_null_ctd FROM @sql_null_ctd;
EXECUTE stmt_null_ctd;
DEALLOCATE PREPARE stmt_null_ctd;

-- Treat legacy 0 as "not set" so employee defaults apply
UPDATE monthly_payroll_adjustments SET ctd = NULL WHERE ctd = 0;
