-- Desktop InteractPresence agent registry (heartbeat + admin employee assignment).

CREATE TABLE IF NOT EXISTS `presence_agents` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `machine_id` varchar(128) NOT NULL COMMENT 'Stable GUID on each PC',
  `hostname` varchar(255) DEFAULT NULL,
  `windows_user` varchar(255) DEFAULT NULL,
  `hrm_base_url` varchar(512) DEFAULT NULL,
  `local_employee_id` varchar(64) DEFAULT NULL COMMENT 'Employee ID set locally on the PC',
  `assigned_employee_id` varchar(64) DEFAULT NULL COMMENT 'Admin-assigned; agent pulls on sync',
  `agent_version` varchar(32) DEFAULT NULL,
  `last_ip` varchar(45) DEFAULT NULL,
  `first_seen_at` datetime DEFAULT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_presence_agents_machine` (`machine_id`),
  KEY `idx_presence_agents_last_seen` (`last_seen_at`),
  KEY `idx_presence_agents_assigned` (`assigned_employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
