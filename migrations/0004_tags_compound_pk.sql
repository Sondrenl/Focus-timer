-- D1 Migration: v2.1.2 Ensure tags table has compound PRIMARY KEY (user_id, id) and unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_id ON tags(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_presence ON user_device_presence(user_id, device_id);
