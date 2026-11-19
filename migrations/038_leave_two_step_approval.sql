-- Two-step leave approval columns on employee_leaves.
-- Overall status becomes 'approved' only after 2nd step — monthly attendance uses that for 0% deduction.

SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leaves' AND COLUMN_NAME = 'step1_status'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE employee_leaves ADD COLUMN step1_status VARCHAR(20) NOT NULL DEFAULT ''pending'' AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leaves' AND COLUMN_NAME = 'step2_status'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE employee_leaves ADD COLUMN step2_status VARCHAR(20) NOT NULL DEFAULT ''pending'' AFTER step1_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leaves' AND COLUMN_NAME = 'step1_by'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE employee_leaves ADD COLUMN step1_by VARCHAR(128) NULL AFTER step2_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leaves' AND COLUMN_NAME = 'step1_at'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE employee_leaves ADD COLUMN step1_at DATETIME NULL AFTER step1_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leaves' AND COLUMN_NAME = 'step2_by'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE employee_leaves ADD COLUMN step2_by VARCHAR(128) NULL AFTER step1_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_leaves' AND COLUMN_NAME = 'step2_at'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE employee_leaves ADD COLUMN step2_at DATETIME NULL AFTER step2_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill existing rows so historical approved leaves stay final.
UPDATE employee_leaves
SET step1_status = 'approved', step2_status = 'approved'
WHERE LOWER(COALESCE(status, '')) = 'approved'
  AND (step1_status IS NULL OR step1_status = 'pending' OR step1_status = '');

UPDATE employee_leaves
SET step1_status = 'rejected', step2_status = 'rejected'
WHERE LOWER(COALESCE(status, '')) = 'rejected';

UPDATE employee_leaves
SET step1_status = COALESCE(NULLIF(step1_status, ''), 'pending'),
    step2_status = COALESCE(NULLIF(step2_status, ''), 'pending')
WHERE LOWER(COALESCE(status, '')) = 'pending';
