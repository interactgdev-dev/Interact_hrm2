-- Add default fuel allowance on employee salary (used by Monthly Payroll when no monthly override)
SET @col_fuel := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_salaries'
    AND COLUMN_NAME = 'fuel_allowance'
);

SET @sql_fuel := IF(
  @col_fuel = 0,
  'ALTER TABLE employee_salaries ADD COLUMN fuel_allowance decimal(12,2) DEFAULT NULL AFTER deposit_amount',
  'SELECT 1'
);

PREPARE stmt_fuel FROM @sql_fuel;
EXECUTE stmt_fuel;
DEALLOCATE PREPARE stmt_fuel;
