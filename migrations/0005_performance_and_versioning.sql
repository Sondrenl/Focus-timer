-- D1 Migration: v2.2.1 Performance indexes and active_timers sync versioning
ALTER TABLE active_timers ADD COLUMN tags_version INTEGER DEFAULT 1;
ALTER TABLE active_timers ADD COLUMN coffee_version INTEGER DEFAULT 1;
ALTER TABLE active_timers ADD COLUMN last_session_completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_tag ON sessions(user_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_created ON coffee_cups(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_tag ON coffee_cups(user_id, tag_id);

-- Drop redundant duplicate indexes (covered by primary keys and compound index prefixes)
DROP INDEX IF EXISTS uq_tags_user_id;
DROP INDEX IF EXISTS idx_tags_user;
DROP INDEX IF EXISTS idx_deleted_tags_user;
DROP INDEX IF EXISTS idx_deleted_coffee_cups_user;
DROP INDEX IF EXISTS uq_device_presence;
DROP INDEX IF EXISTS idx_device_presence_user;
