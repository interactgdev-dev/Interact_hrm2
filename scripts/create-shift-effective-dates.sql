-- Create table for pending shift assignments with effective dates
CREATE TABLE IF NOT EXISTS shift_effective_dates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    shift_name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    allow_overtime TINYINT(1) DEFAULT 0,
    effective_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Remove effective_date column from shift_assignments table
ALTER TABLE shift_assignments DROP COLUMN effective_date;

-- Add any additional columns as needed
-- (e.g., department_id, assignment_source, etc.)
-- Uncomment and modify below if required
-- ALTER TABLE shift_effective_dates ADD COLUMN department_id INT DEFAULT NULL;
-- ALTER TABLE shift_effective_dates ADD COLUMN assignment_source VARCHAR(50) DEFAULT NULL;
