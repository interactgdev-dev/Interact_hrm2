-- Employee Financial History: advance ledger + loan master + installment schedule.
-- Old advance_salary / loan_installments stay until cutover; this backfills once.

CREATE TABLE IF NOT EXISTS `employee_advances` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `payroll_month` varchar(7) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `notes` varchar(255) DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_adv_employee_month` (`employee_id`, `payroll_month`),
  KEY `idx_adv_month` (`payroll_month`),
  KEY `idx_adv_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `employee_loans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `principal` decimal(12,2) NOT NULL,
  `installment_count` int(11) NOT NULL,
  `start_month` varchar(7) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `notes` varchar(255) DEFAULT NULL,
  `issued_at` datetime DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_loan_employee_start` (`employee_id`, `start_month`),
  KEY `idx_loan_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `employee_loan_installments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `loan_id` int(11) NOT NULL,
  `installment_no` int(11) NOT NULL,
  `due_month` varchar(7) NOT NULL,
  `original_amount` decimal(12,2) NOT NULL,
  `payable_amount` decimal(12,2) NOT NULL,
  `paid_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `paid_at` datetime DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_loan_installment_no` (`loan_id`, `installment_no`),
  UNIQUE KEY `uq_loan_due_month` (`loan_id`, `due_month`),
  KEY `idx_inst_due_month` (`due_month`),
  KEY `idx_inst_status` (`status`),
  CONSTRAINT `fk_eli_loan` FOREIGN KEY (`loan_id`) REFERENCES `employee_loans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- One-time advance backfill (only when new ledger is empty)
INSERT INTO `employee_advances` (
  `employee_id`, `payroll_month`, `amount`, `status`, `notes`, `created_at`, `updated_at`
)
SELECT
  a.`employee_id`,
  DATE_FORMAT(a.`created_at`, '%Y-%m') AS payroll_month,
  a.`advance_amount`,
  'active',
  'Backfilled from advance_salary',
  a.`created_at`,
  COALESCE(a.`updated_at`, a.`created_at`)
FROM `advance_salary` a
WHERE (SELECT COUNT(*) FROM `employee_advances`) = 0
  AND a.`employee_id` IS NOT NULL
  AND a.`advance_amount` IS NOT NULL;

-- One-time loan master backfill (one synthetic loan per employee from old rows)
INSERT INTO `employee_loans` (
  `employee_id`, `principal`, `installment_count`, `start_month`, `status`, `notes`, `issued_at`, `created_at`, `updated_at`
)
SELECT
  i.`employee_id`,
  SUM(i.`original_amount`) AS principal,
  COUNT(*) AS installment_count,
  MIN(i.`month`) AS start_month,
  CASE
    WHEN SUM(CASE WHEN LOWER(COALESCE(i.`status`, 'pending')) = 'pending' THEN 1 ELSE 0 END) > 0
      THEN 'active'
    ELSE 'closed'
  END AS status,
  'Backfilled from loan_installments',
  MIN(i.`created_at`) AS issued_at,
  MIN(i.`created_at`) AS created_at,
  MAX(COALESCE(i.`updated_at`, i.`created_at`)) AS updated_at
FROM `loan_installments` i
WHERE (SELECT COUNT(*) FROM `employee_loans`) = 0
  AND i.`employee_id` IS NOT NULL
  AND i.`month` IS NOT NULL
GROUP BY i.`employee_id`;

-- Installment schedule backfill linked to the synthetic masters
INSERT INTO `employee_loan_installments` (
  `loan_id`, `installment_no`, `due_month`, `original_amount`, `payable_amount`, `paid_amount`, `status`, `paid_at`, `notes`, `created_at`, `updated_at`
)
SELECT
  l.`id` AS loan_id,
  CAST(ROW_NUMBER() OVER (PARTITION BY i.`employee_id` ORDER BY i.`month`, i.`created_at`) AS UNSIGNED) AS installment_no,
  i.`month` AS due_month,
  i.`original_amount`,
  COALESCE(i.`payable_this_month`, i.`original_amount`) AS payable_amount,
  COALESCE(i.`paid_amount`, 0) AS paid_amount,
  COALESCE(i.`status`, 'pending') AS status,
  CASE
    WHEN LOWER(COALESCE(i.`status`, '')) = 'paid' THEN COALESCE(i.`updated_at`, i.`created_at`)
    ELSE NULL
  END AS paid_at,
  'Backfilled from loan_installments' AS notes,
  COALESCE(i.`created_at`, NOW()) AS created_at,
  COALESCE(i.`updated_at`, i.`created_at`, NOW()) AS updated_at
FROM `loan_installments` i
INNER JOIN `employee_loans` l
  ON l.`employee_id` = i.`employee_id`
 AND l.`notes` = 'Backfilled from loan_installments'
WHERE (SELECT COUNT(*) FROM `employee_loan_installments`) = 0;
