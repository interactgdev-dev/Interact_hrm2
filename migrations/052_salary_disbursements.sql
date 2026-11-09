-- Salary Disbursement (Finance): month-wise Paid / Unpaid bank transfer status.

CREATE TABLE IF NOT EXISTS `salary_disbursements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `month` varchar(7) NOT NULL,
  `amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `bank_name` varchar(120) DEFAULT NULL,
  `account_number` varchar(64) DEFAULT NULL,
  `bank_group` varchar(20) NOT NULL DEFAULT 'other',
  `status` varchar(20) NOT NULL DEFAULT 'unpaid',
  `marked_by` int(11) DEFAULT NULL,
  `marked_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_salary_disbursement_emp_month` (`employee_id`, `month`),
  KEY `idx_sd_month_group` (`month`, `bank_group`),
  KEY `idx_sd_month_status` (`month`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
