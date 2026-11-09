-- Snapshot of Monthly Payroll Final Salary per employee / month (for Salary Disbursement).

CREATE TABLE IF NOT EXISTS `monthly_payroll_final_salaries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `month` varchar(7) NOT NULL,
  `final_salary` decimal(14,2) NOT NULL DEFAULT 0.00,
  `source` varchar(40) DEFAULT 'computed',
  `updated_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mpfs_emp_month` (`employee_id`, `month`),
  KEY `idx_mpfs_month` (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
