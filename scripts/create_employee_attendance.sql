-- Create new attendance table used by /api/attendance
CREATE TABLE IF NOT EXISTS employee_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  employee_name VARCHAR(150) NULL,
  date DATE NOT NULL,
  clock_in DATETIME NULL,
  clock_out DATETIME NULL,
  total_hours DECIMAL(5,2) NULL,
  INDEX (employee_id),
  INDEX (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
