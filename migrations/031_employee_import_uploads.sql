-- Archive every Employee List / Add Employee XLS import for audit / proof.

CREATE TABLE IF NOT EXISTS `employee_import_uploads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `original_filename` varchar(255) NOT NULL,
  `stored_filename` varchar(255) NOT NULL,
  `relative_path` varchar(500) NOT NULL,
  `source` varchar(64) NOT NULL DEFAULT 'unknown',
  `uploaded_by` varchar(150) DEFAULT NULL,
  `file_size` bigint(20) NOT NULL DEFAULT 0,
  `mime_type` varchar(120) DEFAULT NULL,
  `inserted_count` int(11) NOT NULL DEFAULT 0,
  `updated_count` int(11) NOT NULL DEFAULT 0,
  `skipped_count` int(11) NOT NULL DEFAULT 0,
  `failed_count` int(11) NOT NULL DEFAULT 0,
  `summary_json` mediumtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_employee_import_uploads_created` (`created_at`),
  KEY `idx_employee_import_uploads_source` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
