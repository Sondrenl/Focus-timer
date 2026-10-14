-- D1 Migration: Initial Schema for Focus Timer

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  avatar_emoji TEXT DEFAULT '',
  daily_goal_minutes INTEGER DEFAULT 120,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id TEXT,
  session_type TEXT NOT NULL CHECK(session_type IN ('WORK', 'SHORT_BREAK', 'LONG_BREAK')),
  duration_seconds INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, completed_at);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  work_duration_minutes INTEGER DEFAULT 25,
  short_break_duration_minutes INTEGER DEFAULT 5,
  long_break_duration_minutes INTEGER DEFAULT 25,
  long_break_interval INTEGER DEFAULT 4,
  auto_start_breaks INTEGER DEFAULT 0,
  auto_start_pomodoros INTEGER DEFAULT 0,
  sound_enabled INTEGER DEFAULT 1,
  sound_volume REAL DEFAULT 0.8,
  notifications_enabled INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
