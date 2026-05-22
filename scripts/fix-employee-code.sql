-- Fix duplicate empty employee_code by setting them to NULL
USE interact_hrm;

-- Update all empty employee_code values to NULL
UPDATE hrm_employees 
SET employee_code = NULL 
WHERE employee_code = '';

-- Show updated records
SELECT id, first_name, last_name, employee_code 
FROM hrm_employees 
WHERE employee_code IS NULL;
