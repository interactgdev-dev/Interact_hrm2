-- ZKBio punch log: remove duplicates, then unique guards.
-- LARGE TABLE: Without indexes below, DELETE can take hours. Run steps in order.
-- If a query is stuck: SHOW PROCESSLIST; → KILL <Id>;
-- Backup first.

-- 0) Non-unique indexes — speed up JOINs (skip any line that says "Duplicate key name")
-- log_id is typically varchar(64): do not use prefix longer than column (e.g. 191 fails).
ALTER TABLE zkbio_punch_log ADD INDEX idx_zkbio_dedupe_log_id (log_id);
ALTER TABLE zkbio_punch_log ADD INDEX idx_zkbio_dedupe_pin_evt (pin, event_time);

-- 1) Normalize
UPDATE zkbio_punch_log SET pin = TRIM(COALESCE(pin, '')) WHERE pin IS NULL OR pin <> TRIM(pin);
UPDATE zkbio_punch_log SET log_id = TRIM(log_id) WHERE log_id IS NOT NULL AND log_id <> TRIM(log_id);

-- 2) Same log_id → keep smallest id
DELETE t1 FROM zkbio_punch_log t1
INNER JOIN zkbio_punch_log t2
  ON t1.log_id = t2.log_id
  AND t1.log_id IS NOT NULL
  AND t1.log_id <> ''
  AND t1.id > t2.id;

-- 3) Same pin + same punch time → keep smallest id
DELETE t1 FROM zkbio_punch_log t1
INNER JOIN zkbio_punch_log t2
  ON t1.pin = t2.pin
  AND t1.event_time = t2.event_time
  AND t1.event_time IS NOT NULL
  AND t2.event_time IS NOT NULL
  AND t1.id > t2.id;

-- 4) Replace helper indexes with UNIQUE (Python INSERT IGNORE)
-- Drop helpers first so UNIQUE can use clean names (skip DROP if index name missing)
ALTER TABLE zkbio_punch_log DROP INDEX idx_zkbio_dedupe_log_id;
ALTER TABLE zkbio_punch_log DROP INDEX idx_zkbio_dedupe_pin_evt;

CREATE UNIQUE INDEX uq_zkbio_log_id ON zkbio_punch_log (log_id);
CREATE UNIQUE INDEX uq_zkbio_pin_event ON zkbio_punch_log (pin, event_time);

-- Optional: March 2026 se pehle ka data
-- DELETE FROM zkbio_punch_log
-- WHERE (event_time IS NOT NULL AND event_time < '2026-03-01 00:00:00')
--    OR (event_time IS NULL AND imported_at < '2026-03-01 00:00:00');
