-- Allow medical category on form templates (MySQL ENUM). Safe if already present.
-- Mongo adapters typically store category as a plain string and ignore this ALTER.

SET @db := DATABASE();

SET @has_medical := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'hrm_form_templates'
    AND COLUMN_NAME = 'category'
    AND COLUMN_TYPE LIKE '%medical%'
);

SET @sql := IF(
  @has_medical = 0,
  "ALTER TABLE hrm_form_templates MODIFY COLUMN category ENUM('warning','appraisal','onboarding','exit','asset','leave','disciplinary','general','custom','medical') NOT NULL DEFAULT 'general'",
  "SELECT 1"
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
