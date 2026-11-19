-- master_shifts on some staging dumps has `id` NOT NULL without AUTO_INCREMENT.
-- Shift Scheduler INSERT omits id → MySQL: Field 'id' doesn't have a default value.

SET @has_pk := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'master_shifts' AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);
SET @sql := IF(@has_pk = 0,
  'ALTER TABLE master_shifts ADD PRIMARY KEY (id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ai := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'master_shifts' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%'
);
SET @sql := IF(@ai = 0,
  'ALTER TABLE master_shifts MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @max_id := (SELECT COALESCE(MAX(id), 0) FROM master_shifts);
SET @sql := CONCAT('ALTER TABLE master_shifts AUTO_INCREMENT = ', @max_id + 1);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
