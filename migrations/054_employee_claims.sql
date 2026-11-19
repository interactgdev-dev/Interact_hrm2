-- Employee claims ledger (HR adds claims; balance from medical package yearly entitlement).

CREATE TABLE IF NOT EXISTS `employee_claims` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `claim_year` varchar(4) NOT NULL,
  `claim_type` varchar(40) NOT NULL DEFAULT 'medical',
  `title` varchar(255) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `claim_date` date NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'approved',
  `notes` varchar(500) DEFAULT NULL,
  `receipt_path` varchar(512) DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `created_by_employee_id` int(11) DEFAULT NULL,
  `approved_by_employee_id` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `payroll_month` varchar(7) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_claims_employee_year` (`employee_id`, `claim_year`),
  KEY `idx_claims_status` (`status`),
  KEY `idx_claims_date` (`claim_date`),
  KEY `idx_claims_type` (`claim_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Optional per-employee yearly entitlement override (NULL = derive from medical package).
CREATE TABLE IF NOT EXISTS `employee_claim_entitlements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `claim_year` varchar(4) NOT NULL,
  `claim_type` varchar(40) NOT NULL DEFAULT 'medical',
  `entitlement_amount` decimal(12,2) NOT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `updated_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_entitlement_emp_year_type` (`employee_id`, `claim_year`, `claim_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
