/**
 * Timer session types following Pomodoro technique conventions
 */
export type SessionType = 'WORK' | 'SHORT_BREAK' | 'LONG_BREAK';

/**
 * Timer execution status
 */
export type TimerStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED';

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
