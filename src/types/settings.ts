import { DEFAULT_SETTINGS as BASE_DEFAULT_SETTINGS } from '../../convex/defaultData';

/**
 * User configuration preferences for timer cycles and feedback
 */
export interface UserSettings {
  /** Work session duration in minutes (default 25) */
  workDurationMinutes: number;
  /** Short break duration in minutes (default 5) */
  shortBreakDurationMinutes: number;
  /** Long break duration in minutes (default 25) */
  longBreakDurationMinutes: number;
  /** Number of work sessions before triggering a long break (default 4) */
  longBreakInterval: number;
  /** Whether to automatically start break intervals */
  autoStartBreaks: boolean;
  /** Whether to automatically start work intervals after break */
  autoStartPomodoros: boolean;
  /** Sound volume between 0 and 1 */
  soundVolume: number;
  /** Sound enabled flag */
  soundEnabled: boolean;
  /** Browser notification permission preference */
  notificationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  workDurationMinutes: BASE_DEFAULT_SETTINGS.workDurationMinutes,
  shortBreakDurationMinutes: BASE_DEFAULT_SETTINGS.shortBreakDurationMinutes,
  longBreakDurationMinutes: BASE_DEFAULT_SETTINGS.longBreakDurationMinutes,
  longBreakInterval: BASE_DEFAULT_SETTINGS.longBreakInterval,
  autoStartBreaks: BASE_DEFAULT_SETTINGS.autoStartBreaks,
  autoStartPomodoros: BASE_DEFAULT_SETTINGS.autoStartPomodoros,
  soundVolume: BASE_DEFAULT_SETTINGS.soundVolume,
  soundEnabled: BASE_DEFAULT_SETTINGS.soundEnabled,
  notificationsEnabled: BASE_DEFAULT_SETTINGS.notificationsEnabled,
};
