-- D1 Migration: v2.1.0 timer heartbeat, deleted coffee tracking, and keep-awake setting
ALTER TABLE active_timers ADD COLUMN last_heartbeat_ms INTEGER;

CREATE TABLE IF NOT EXISTS deleted_coffee_cups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cup_id TEXT NOT NULL,
  deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, cup_id)
);
CREATE INDEX IF NOT EXISTS idx_deleted_coffee_cups_user ON deleted_coffee_cups(user_id);

ALTER TABLE user_settings ADD COLUMN keep_awake INTEGER DEFAULT 0;
