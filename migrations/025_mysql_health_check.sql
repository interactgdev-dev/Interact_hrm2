-- 025 — dummy MySQL health table for staging (10.6) employee-dashboard check page.
-- Isolated from attendance / payroll. Safe on every environment (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `hrm_mysql_health` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` varchar(64) DEFAULT NULL,
  `employee_name` varchar(255) DEFAULT NULL,
  `note` varchar(500) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_hmh_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
