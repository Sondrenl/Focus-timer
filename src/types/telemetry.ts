import { SessionType, TimerStatus } from './timer';

export type DeviceClass = 'desktop' | 'mobile';

export type AttemptOutcome =
  | 'completed'
  | 'skipped'
  | 'reset'
  | 'switched'
  | 'abandoned_stale';

export type AttemptStatus = 'in_progress' | AttemptOutcome;

export type TelemetrySource = 'client' | 'server_scheduled';

export interface PauseInterval {
  pausedAt: string;
  resumedAt?: string;
  durationSeconds?: number;
  elapsedActiveSecondsAtPause: number;
  remainingSecondsAtPause: number;
}

export interface SettingsSnapshot {
  workDurationMinutes: number;
  shortBreakDurationMinutes: number;
  longBreakDurationMinutes: number;
  longBreakInterval: number;
  autoStartBreaks: boolean;
  autoStartPomodoros: boolean;
}

/**
 * Run-level ML training record covering every timer attempt (completed, skipped, reset, switched, or abandoned).
 * Stored separately from CompletedSession so existing Stats & Insights remain unaffected.
 */
export interface SessionAttempt {
  attemptId: string;
  sessionType: SessionType;
  status: AttemptStatus;
  wasStarted: boolean;
  plannedDurationSeconds: number;
  actualActiveSeconds: number;
  remainingSecondsAtEnd: number;
  completionRatio: number;
  startedAt: string | null;
  endedAt: string | null;
  utcOffsetMinutes: number;
  ianaTimezone?: string;
  localDate: string; // YYYY-MM-DD in local clock
  localHour: number; // 0..23
  localMinuteOfDay: number; // 0..1439
  localDayOfWeek: number; // 0..6 (Sunday = 0)
  cycleIndex: number;
  longBreakInterval: number;
  autoStarted: boolean;
  initialTagId: string | null;
  tagId: string | null;
  tagChangedMidRun: boolean;
  pauseCount: number;
  totalPausedSeconds: number;
  pauseIntervals: PauseInterval[];
  timeSincePreviousAttemptSeconds: number | null;
  previousAttemptType: SessionType | null;
  previousAttemptOutcome: AttemptOutcome | null;
  workSessionsCompletedToday: number;
  workActiveSecondsToday: number;
  skipsToday: number;
  coffeeCupsTodayAtStart: number;
  minutesSinceLastCoffeeAtStart: number | null;
  coffeeLoggedDuringRun: number;
  dailyGoalMinutes: number;
  settingsSnapshot: SettingsSnapshot;
  deviceClass: DeviceClass;
  tabBackgroundedCount: number;
  completionLatencySeconds: number | null;
  source: TelemetrySource;
  updatedAtMs: number;
}

export type MlEventType =
  | 'session_started'
  | 'session_paused'
  | 'session_resumed'
  | 'session_completed'
  | 'session_skipped'
  | 'session_reset'
  | 'session_switched'
  | 'session_abandoned_stale'
  | 'tag_changed'
  | 'settings_changed'
  | 'daily_goal_changed'
  | 'coffee_logged'
  | 'coffee_removed';

/**
 * Granular timestamped behavioral event for sequential ML modeling (timer intervals & coffee timing).
 */
export interface MlEvent {
  eventId: string;
  eventType: MlEventType;
  timestamp: string;
  timestampMs: number;
  utcOffsetMinutes: number;
  ianaTimezone?: string;
  localDate: string; // YYYY-MM-DD
  localHour: number; // 0..23
  localMinuteOfDay: number; // 0..1439
  localDayOfWeek: number; // 0..6
  deviceClass: DeviceClass;
  attemptId?: string | null;
  sessionType?: SessionType | null;
  tagId?: string | null;
  plannedDurationSeconds?: number | null;
  elapsedActiveSeconds?: number | null;
  remainingSeconds?: number | null;
  pauseDurationSeconds?: number | null;
  fromTagId?: string | null;
  toTagId?: string | null;
  toSessionType?: SessionType | null;
  autoStarted?: boolean | null;
  cupId?: string | null;
  cupDate?: string | null;
  cupIndexToday?: number | null;
  minutesSincePreviousCup?: number | null;
  minutesSinceLastWorkEnd?: number | null;
  activeTimerStatus?: TimerStatus | null;
  changedFields?: string[] | null;
  previousSettings?: Partial<SettingsSnapshot> | null;
  newSettings?: Partial<SettingsSnapshot> | null;
  previousDailyGoalMinutes?: number | null;
  newDailyGoalMinutes?: number | null;
  source?: TelemetrySource | null;
}

export interface MlTelemetryExport {
  schemaVersion: number;
  sessionAttempts: SessionAttempt[];
  events: MlEvent[];
}
