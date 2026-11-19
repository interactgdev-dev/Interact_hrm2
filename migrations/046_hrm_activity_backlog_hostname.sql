-- Backlog Tracker: PC / machine name on each event.
ALTER TABLE hrm_activity_backlog
  ADD COLUMN hostname VARCHAR(255) NULL AFTER employee_code;

ALTER TABLE hrm_activity_backlog
  ADD KEY idx_hab_hostname (hostname);
