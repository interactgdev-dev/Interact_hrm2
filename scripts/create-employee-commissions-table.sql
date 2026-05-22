-- Table for storing employee commissions and incentives (month-wise)
CREATE TABLE IF NOT EXISTS `employee_commissions` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `employee_id` INT(11) NOT NULL,
  `month` VARCHAR(7) NOT NULL COMMENT 'Format: YYYY-MM (e.g., 2026-03)',
  `year` INT(4) NOT NULL,
  `month_number` INT(2) NOT NULL COMMENT '1-12',
  `train_6h_amt` DECIMAL(10,2) DEFAULT 0.00,
  `arrears` DECIMAL(10,2) DEFAULT 0.00,
  `kpi_add` DECIMAL(10,2) DEFAULT 0.00,
  `commission` DECIMAL(10,2) DEFAULT 0.00,
  `existing_client_incentive` DECIMAL(10,2) DEFAULT 0.00,
  `trainer_incentive` DECIMAL(10,2) DEFAULT 0.00,
  `floor_incentive` DECIMAL(10,2) DEFAULT 0.00,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_month_unique` (`employee_id`, `month`),
  KEY `idx_month` (`month`),
  KEY `idx_year_month` (`year`, `month_number`),
  CONSTRAINT `fk_employee_commissions_employee` 
    FOREIGN KEY (`employee_id`) 
    REFERENCES `hrm_employees` (`id`) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add index for faster queries
CREATE INDEX `idx_employee_year` ON `employee_commissions` (`employee_id`, `year`, `month_number`);
