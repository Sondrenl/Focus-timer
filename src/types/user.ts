import { Tag } from './tag';
import { CompletedSession } from './session';
import { UserSettings } from './settings';

/**
 * User Profile data model for focus tracking, goals, and optional cloud sync
 */
export interface UserProfile {
  /** Cloud user ID (if authenticated) */
  id?: string;
  /** Google account email (if authenticated) */
  email?: string;
  /** Google avatar profile picture URL (if authenticated) */
  avatarUrl?: string;
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
 * Cloud authentication and sync state
 */
export interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  token: string | null;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
}

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
