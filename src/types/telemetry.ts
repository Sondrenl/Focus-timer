import { SessionType } from './timer';

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
  dailyGoalMinutes: number;
  settingsSnapshot: SettingsSnapshot;
  deviceClass: DeviceClass;
  tabBackgroundedCount: number;
  completionLatencySeconds: number | null;
  source: TelemetrySource;
  updatedAtMs: number;
}

export interface MlTelemetryExport {
  schemaVersion: number;
  sessionAttempts: SessionAttempt[];
  events?: unknown[];
}
