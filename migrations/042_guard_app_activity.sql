-- Guard Screenshots: foreground app + window title activity (no keystrokes).
CREATE TABLE IF NOT EXISTS guard_app_activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id VARCHAR(64) NOT NULL,
  employee_name VARCHAR(255) NULL,
  pseudonym VARCHAR(255) NULL,
  machine_id VARCHAR(128) NULL,
  hostname VARCHAR(255) NULL,
  windows_user VARCHAR(255) NULL,
  app_name VARCHAR(255) NOT NULL,
  app_path VARCHAR(512) NULL,
  caption VARCHAR(512) NULL,
  started_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_gaa_emp_started (employee_id, started_at),
  KEY idx_gaa_last_seen (last_seen_at),
  KEY idx_gaa_app (app_name(100)),
  KEY idx_gaa_machine (machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
