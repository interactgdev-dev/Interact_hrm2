-- Keyboard activity metrics are stored in MongoDB collection:
--   guard_keyboard_activity
-- Indexes are created automatically by lib/guard-keyboard-activity.ts
-- (uq_gka_batch_app, idx_gka_emp_period, etc.).
--
-- This SQL migration is intentionally a no-op so deploy runners that still
-- execute *.sql files do not fail on Mongo-backed environments.
SELECT 1;
