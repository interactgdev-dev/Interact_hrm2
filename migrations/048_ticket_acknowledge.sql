-- Non-leave tickets: HR can Acknowledge (who/when) without closing.
-- Guarded so re-runs are safe on MySQL 8.
SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_tickets' AND COLUMN_NAME = 'acknowledged_by'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE employee_tickets ADD COLUMN acknowledged_by VARCHAR(64) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_tickets' AND COLUMN_NAME = 'acknowledged_by_name'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE employee_tickets ADD COLUMN acknowledged_by_name VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_tickets' AND COLUMN_NAME = 'acknowledged_at'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE employee_tickets ADD COLUMN acknowledged_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
