-- IAM Intelligence marketing site - lead capture schema.
-- Import this once via Hostinger's phpMyAdmin (or `mysql -u ... -p dbname < schema.sql`)
-- after creating the database. Safe to re-run - both tables use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS leads (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  company VARCHAR(160) NOT NULL,
  company_size VARCHAR(40) NULL,
  phone VARCHAR(40) NULL,
  message VARCHAR(500) NULL,
  ip_address VARCHAR(45) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fixed-window per-IP rate limit for the lead form, mirroring the same
-- fixed-window approach the collector's own HTTP API already uses
-- (see collector/src/server.js). Rows older than the window are deleted by
-- submit-lead.php on every request, so this table never grows unbounded.
CREATE TABLE IF NOT EXISTS lead_rate_limit (
  ip_address VARCHAR(45) NOT NULL PRIMARY KEY,
  submit_count INT UNSIGNED NOT NULL DEFAULT 0,
  window_start DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
