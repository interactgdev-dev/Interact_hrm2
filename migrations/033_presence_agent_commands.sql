-- Remote admin commands for desktop presence agents (restart / exit).

SET @pending_cmd_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'presence_agents'
    AND COLUMN_NAME = 'pending_command'
);

SET @sql := IF(
  @pending_cmd_exists = 0,
  'ALTER TABLE `presence_agents` ADD COLUMN `pending_command` varchar(32) DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cmd_issued_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'presence_agents'
    AND COLUMN_NAME = 'command_issued_at'
);

SET @sql := IF(
  @cmd_issued_exists = 0,
  'ALTER TABLE `presence_agents` ADD COLUMN `command_issued_at` datetime DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
