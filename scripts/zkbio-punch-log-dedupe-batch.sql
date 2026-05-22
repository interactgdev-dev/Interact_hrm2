-- Batch duplicate delete (run ONE statement at a time; repeat until "0 rows affected").
-- Use AFTER: idx_zkbio_dedupe_log_id + idx_zkbio_dedupe_pin_evt exist (see zkbio-punch-log-dedupe.sql step 0).
-- log_id column is varchar(64): index on (log_id) without invalid prefix length.
-- Or run ALTER TABLE ... ADD INDEX lines from dedupe.sql first, then use this file.

-- Repeat 10–500 times until 0 rows deleted (phpMyAdmin: same query bar bar Go)
-- A) Duplicates by log_id (10k per batch)
DELETE FROM zkbio_punch_log
WHERE id IN (
  SELECT id FROM (
    SELECT t1.id
    FROM zkbio_punch_log t1
    INNER JOIN zkbio_punch_log t2
      ON t1.log_id = t2.log_id
      AND t1.log_id IS NOT NULL
      AND t1.log_id <> ''
      AND t1.id > t2.id
    LIMIT 10000
  ) AS tmp
);

-- B) Duplicates by pin + event_time (after A is done / 0 rows)
DELETE FROM zkbio_punch_log
WHERE id IN (
  SELECT id FROM (
    SELECT t1.id
    FROM zkbio_punch_log t1
    INNER JOIN zkbio_punch_log t2
      ON t1.pin = t2.pin
      AND t1.event_time = t2.event_time
      AND t1.event_time IS NOT NULL
      AND t1.id > t2.id
    LIMIT 10000
  ) AS tmp
);

-- Then run UNIQUE indexes from zkbio-punch-log-dedupe.sql step 4 (drop helpers + CREATE UNIQUE).
