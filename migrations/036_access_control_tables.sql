-- Access control collections for System Control (Permissions + Features).
-- Safe on MySQL; Mongo staging seeds via lib/access-control/store.ts on first API hit.

CREATE TABLE IF NOT EXISTS hrm_roles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  portal_type VARCHAR(64) NOT NULL DEFAULT 'employee-dashboard',
  data_scope VARCHAR(32) NOT NULL DEFAULT 'SELF',
  hierarchy_level INT NOT NULL DEFAULT 50,
  parent_slug VARCHAR(64) NULL,
  tier VARCHAR(32) NULL,
  accent VARCHAR(32) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hrm_roles_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hrm_role_permissions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_slug VARCHAR(64) NOT NULL,
  feature_key VARCHAR(128) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_perm (role_slug, feature_key),
  KEY idx_role_slug (role_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hrm_global_features (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  feature_key VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_global_feature (feature_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
