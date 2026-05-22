-- Your SHOW CREATE had: `id` int NOT NULL — no AUTO_INCREMENT, no PRIMARY KEY.
-- POST /api/reminders omits `id`, so MySQL errors with ER_NO_DEFAULT_FOR_FIELD.
--
-- If you already have rows, ensure `id` values are unique and non-null before running.
-- If the table is empty, this is safe as-is.

ALTER TABLE reminders
  MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT,
  ADD PRIMARY KEY (id);
