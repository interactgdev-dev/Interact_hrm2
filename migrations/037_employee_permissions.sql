-- Per-employee permission overrides (same role, different rights).
CREATE TABLE IF NOT EXISTS hrm_employee_permissions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id VARCHAR(64) NOT NULL,
  feature_key VARCHAR(128) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_emp_perm (employee_id, feature_key),
  KEY idx_emp_perm_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
