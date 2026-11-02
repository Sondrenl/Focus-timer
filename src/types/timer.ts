/**
 * Timer session types following Pomodoro technique conventions
 */
export type SessionType = 'WORK' | 'SHORT_BREAK' | 'LONG_BREAK';

/**
 * Timer execution status
 */
export type TimerStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED';

/**
 * Snapshot of timer engine state
 */
export interface TimerState {
  /** Current active session type */
  sessionType: SessionType;
  /** Current execution status */
  status: TimerStatus;
  /** Remaining time in seconds */
  remainingSeconds: number;
  /** Total target duration for the current interval in seconds */
  totalSeconds: number;
  /** Current work cycle index (e.g. 1, 2, 3, 4) */
  currentCycle: number;
  /** Maximum work cycles before a long break */
  maxCycles: number;
  /** ID of the currently assigned tag, or null if untagged */
  activeTagId: string | null;
}

/**
 * State of remote active timer synced via Convex or BroadcastChannel
 */
export interface RemoteTimerState {
  sessionType: SessionType;
  status: TimerStatus;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  currentCycle: number;
  activeTagId: string | null;
  timerRunId: string | null;
  updatedAtMs: number;
}

/**
 * Presence indicator across peer devices (desktop and mobile)
 */
export interface PeerPresence {
  desktopActive: boolean;
  desktopVisible: boolean;
  mobileActive: boolean;
  mobileVisible: boolean;
}
