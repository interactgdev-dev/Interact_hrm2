-- Multi-role System Control assigns (one employee → many role cards).
-- Keeps access_role_slug as primary; access_role_slugs holds the full list (JSON array).

SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'hrm_employees' AND COLUMN_NAME = 'access_role_slugs'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE hrm_employees ADD COLUMN access_role_slugs JSON NULL AFTER access_role_slug',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill from existing single assign
UPDATE hrm_employees
SET access_role_slugs = JSON_ARRAY(access_role_slug)
WHERE access_role_slug IS NOT NULL
  AND TRIM(access_role_slug) <> ''
  AND (access_role_slugs IS NULL OR JSON_LENGTH(access_role_slugs) = 0);
