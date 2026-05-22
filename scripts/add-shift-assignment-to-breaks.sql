-- Migration: Add shift_assignment_id to breaks tables
-- Purpose: Link breaks to specific shifts to prevent merging breaks from different shifts on same date
-- Date: 2026-03-05

-- Add shift_assignment_id to breaks table
ALTER TABLE breaks 
ADD COLUMN shift_assignment_id INT DEFAULT NULL AFTER employee_name;

-- Add index for performance
ALTER TABLE breaks 
ADD INDEX idx_shift_assignment_id (shift_assignment_id);

-- Add shift_assignment_id to prayer_breaks table
ALTER TABLE prayer_breaks 
ADD COLUMN shift_assignment_id INT DEFAULT NULL AFTER employee_name;

-- Add index for performance
ALTER TABLE prayer_breaks 
ADD INDEX idx_shift_assignment_id (shift_assignment_id);

-- Add foreign key constraints (optional - ensures data integrity)
-- Uncomment if you want strict referential integrity
-- ALTER TABLE breaks 
-- ADD CONSTRAINT fk_breaks_shift_assignment 
-- FOREIGN KEY (shift_assignment_id) REFERENCES shift_assignments(id) ON DELETE SET NULL;

-- ALTER TABLE prayer_breaks 
-- ADD CONSTRAINT fk_prayer_breaks_shift_assignment 
-- FOREIGN KEY (shift_assignment_id) REFERENCES shift_assignments(id) ON DELETE SET NULL;
