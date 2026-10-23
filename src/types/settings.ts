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
  workDurationMinutes: 25,
  shortBreakDurationMinutes: 5,
  longBreakDurationMinutes: 25,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartPomodoros: false,
  soundVolume: 0.8,
  soundEnabled: true,
  notificationsEnabled: false,
};
