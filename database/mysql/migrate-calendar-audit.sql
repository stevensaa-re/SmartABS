USE smartabs;

CREATE TABLE IF NOT EXISTS calendar_events (
  id          VARCHAR(40)  NOT NULL,
  title       VARCHAR(120) NOT NULL,
  type        VARCHAR(30)  NOT NULL DEFAULT 'Akademik',
  start_date  DATE         NOT NULL,
  end_date    DATE         NOT NULL,
  description TEXT         NOT NULL,
  is_holiday  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_calendar_dates (start_date, end_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    VARCHAR(20)  NOT NULL,
  actor_name  VARCHAR(100) NOT NULL,
  actor_role  ENUM('admin','guru') NOT NULL,
  action      VARCHAR(30)  NOT NULL,
  entity      VARCHAR(60)  NOT NULL,
  entity_id   VARCHAR(100) NOT NULL DEFAULT '',
  summary     VARCHAR(500) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_actor (actor_id, created_at)
) ENGINE=InnoDB;
