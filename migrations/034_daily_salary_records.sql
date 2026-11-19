-- Daily Salary Calculator: per-employee month summary + editable day rows.

CREATE TABLE IF NOT EXISTS `daily_salary_summaries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` varchar(64) NOT NULL,
  `month` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `basic_salary` decimal(12,2) NOT NULL DEFAULT 0.00,
  `working_days` int(11) NOT NULL DEFAULT 0,
  `daily_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_earned` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_deducted` decimal(12,2) NOT NULL DEFAULT 0.00,
  `unpaid_days` decimal(8,2) NOT NULL DEFAULT 0.00,
  `generated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_month_unique` (`employee_id`,`month`),
  KEY `idx_month` (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `daily_salary_days` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` varchar(64) NOT NULL,
  `month` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `work_date` date NOT NULL,
  `is_working_day` tinyint(1) NOT NULL DEFAULT 1,
  `status_label` varchar(64) NOT NULL DEFAULT '',
  `tardy_count` int(11) DEFAULT NULL,
  `deduction_percent` decimal(5,2) NOT NULL DEFAULT 0.00,
  `daily_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `deducted_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `earned_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `clock_in` varchar(64) DEFAULT NULL,
  `clock_out` varchar(64) DEFAULT NULL,
  `is_manual` tinyint(1) NOT NULL DEFAULT 0,
  `notes` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_date_unique` (`employee_id`,`work_date`),
  KEY `idx_month_emp` (`month`,`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
