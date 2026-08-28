-- Remote admin commands for desktop presence agents (restart / exit).

ALTER TABLE `presence_agents`
  ADD COLUMN `pending_command` varchar(32) DEFAULT NULL,
  ADD COLUMN `command_issued_at` datetime DEFAULT NULL;
