-- D1 Migration: Coffee Cups Table for Coffee Tracker

CREATE TABLE IF NOT EXISTS coffee_cups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id TEXT,
  date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coffee_cups_user_date ON coffee_cups(user_id, date);
