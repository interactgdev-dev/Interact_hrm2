-- MIGRATION: Change employee_id in breaks and prayer_breaks to INT and update FKs

-- 1. Drop existing FKs (if any)
ALTER TABLE breaks DROP FOREIGN KEY IF EXISTS breaks_ibfk_1;
ALTER TABLE prayer_breaks DROP FOREIGN KEY IF EXISTS prayer_breaks_ibfk_1;

-- 2. Change employee_id columns to INT
ALTER TABLE breaks MODIFY employee_id INT;
ALTER TABLE prayer_breaks MODIFY employee_id INT;

-- 3. Add new FKs to employees(id)
ALTER TABLE breaks ADD CONSTRAINT fk_breaks_employee_id FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE prayer_breaks ADD CONSTRAINT fk_prayer_breaks_employee_id FOREIGN KEY (employee_id) REFERENCES employees(id);

-- 4. (Optional) If you want to migrate old data, you must map string employee_id to employees.id and update breaks/prayer_breaks accordingly.
--    Otherwise, you may lose old break/prayer_breaks data or need a custom migration script.

-- 5. (Optional) Remove employee_id VARCHAR(20) from employees if not needed.

-- NOTE: Run this migration after making a backup of your data.
