CREATE TABLE IF NOT EXISTS `refreshment_breaks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) DEFAULT NULL,
  `employee_name` varchar(150) DEFAULT NULL,
  `shift_assignment_id` int(11) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `refreshment_break_start` datetime DEFAULT NULL,
  `refreshment_break_end` datetime DEFAULT NULL,
  `refreshment_break_duration` int(11) DEFAULT 0,
  `exceed_minutes` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `fk_refreshment_breaks_employee_id` (`employee_id`),
  KEY `idx_refreshment_shift_assignment_id` (`shift_assignment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `meeting_breaks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) DEFAULT NULL,
  `employee_name` varchar(150) DEFAULT NULL,
  `shift_assignment_id` int(11) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `meeting_break_start` datetime DEFAULT NULL,
  `meeting_break_end` datetime DEFAULT NULL,
  `meeting_break_duration` int(11) DEFAULT 0,
  `exceed_minutes` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `fk_meeting_breaks_employee_id` (`employee_id`),
  KEY `idx_meeting_shift_assignment_id` (`shift_assignment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
