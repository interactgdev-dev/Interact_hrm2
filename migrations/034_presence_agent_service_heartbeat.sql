-- Windows service heartbeat for Admin remote Start when tray agent is dead.

ALTER TABLE `presence_agents`
  ADD COLUMN `service_last_seen_at` datetime DEFAULT NULL,
  ADD COLUMN `service_version` varchar(32) DEFAULT NULL;
