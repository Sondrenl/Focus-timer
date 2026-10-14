import { Tag } from './tag';
import { CompletedSession } from './session';
import { UserSettings } from './settings';

/**
 * User Profile data model for local focus tracking and goals
 */
export interface UserProfile {
  /** User display name */
  displayName: string;
  /** Avatar emoji icon, or empty string for default icon */
  avatarEmoji: string;
  /** Target focus duration per day in minutes (default 120 min / 2h) */
  dailyGoalMinutes: number;
  /** ISO timestamp string when profile was created */
  createdAt: string;
}

export const DEFAULT_PROFILE: UserProfile = {
  displayName: 'Focus Practitioner',
  avatarEmoji: '', // Default standard icon until user sets one
  dailyGoalMinutes: 120,
  createdAt: new Date().toISOString(),
};

/** Available avatar emojis for quick selection */
export const AVATAR_EMOJI_OPTIONS = [
  '🎯', '🍅', '⚡', '🚀', '🧠', '☕', '🦉', '🌿', '🔥', '💻', '📚', '🌟'
];

/**
 * Schema for exported JSON backup
 */
export interface BackupData {
  version: string;
  exportedAt: string;
  profile?: Partial<UserProfile>;
  settings?: Partial<UserSettings>;
  tags: Tag[];
  sessions: CompletedSession[];
}
