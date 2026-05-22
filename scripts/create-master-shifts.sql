-- Create master_shifts table for predefined shift schedules
CREATE TABLE IF NOT EXISTS master_shifts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shift_name VARCHAR(100) NOT NULL,
  clock_in_time TIME NOT NULL,
  clock_out_time TIME NOT NULL,
  total_hours DECIMAL(4,1) DEFAULT 0,
  overtime TINYINT(1) DEFAULT 0,
  work_days VARCHAR(50) DEFAULT 'Mon-Fri',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert sample shifts
INSERT INTO master_shifts (shift_name, clock_in_time, clock_out_time, total_hours, overtime, work_days) VALUES
('Shift A - General (HIT/DM/Tech)', '09:00:00', '18:00:00', 9.0, 1, 'Mon-Fri'),
('Shift B - Cost. E', '08:00:00', '17:00:00', 9.0, 0, 'Mon-Fri'),
('Shift C - IT', '10:00:00', '19:00:00', 9.0, 1, 'Mon-Fri'),
('Shift D - Admin', '09:00:00', '17:00:00', 8.0, 0, 'Mon-Fri'),
('Shift E - HR', '09:30:00', '18:30:00', 9.0, 0, 'Mon-Fri'),
('Shift F - Other', '08:00:00', '16:00:00', 8.0, 0, 'Mon-Sat');
