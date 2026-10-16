-- Manual monthly attendance status overrides (admin can change auto status).
CREATE TABLE IF NOT EXISTS monthly_attendance_status_overrides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  attendance_date DATE NOT NULL,
  status_label VARCHAR(64) NOT NULL,
  updated_by VARCHAR(128) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_monthly_att_status_emp_date (employee_id, attendance_date),
  KEY idx_monthly_att_status_date (attendance_date)
);
