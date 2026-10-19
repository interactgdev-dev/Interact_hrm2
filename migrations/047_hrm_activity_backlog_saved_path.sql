-- Backlog Tracker: path to saved upload/download copy for later review.
ALTER TABLE hrm_activity_backlog
  ADD COLUMN saved_path VARCHAR(512) NULL AFTER file_bytes;
