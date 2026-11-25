import { SessionType, TimerStatus } from '../../types/timer';
import { isMobileDevice } from '../../utils/environment';
import {
  shouldResetForNewDay,
  getLogicalDayKey,
  getLastResetDayKey,
  setLastResetDayKey,
  getLastSessionCompletedAtFromStorage,
  INACTIVITY_THRESHOLD_MS,
} from '../../utils/newDayCheck';

export const TIMER_STORAGE_KEY = 'timer_state_v1';
export const DEVICE_ID_KEY = 'focus_timer_device_id_v1';

const getOrCreateDeviceId = (): string => {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
};

export const DEVICE_ID = getOrCreateDeviceId();
export const IS_MOBILE = isMobileDevice();

export interface SavedTimerState {
  sessionType: SessionType;
  status: TimerStatus;
  currentCycle: number;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  timerRunId: string | null;
  updatedAtMs: number;
  activeTagId: string | null;
  deviceId: string;
  lastActiveAtMs: number;
  wasHidden?: boolean;
}

export const loadInitialTimerState = (workDurationMinutes: number): SavedTimerState => {
  const defaultSec = Math.round(workDurationMinutes * 60);
  const fallback: SavedTimerState = {
    sessionType: 'WORK',
    status: 'IDLE',
    currentCycle: 1,
    remainingSeconds: defaultSec,
    totalSeconds: defaultSec,
    targetEndTime: null,
    timerRunId: null,
    updatedAtMs: 0,
    activeTagId: null,
    deviceId: DEVICE_ID,
    lastActiveAtMs: Date.now(),
    wasHidden: false,
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const stored = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!stored) {
      return fallback;
    }
    const parsed = JSON.parse(stored) as SavedTimerState;

    // Handle running timers across tab restarts or browser crashes
    if (parsed.status === 'RUNNING' && parsed.targetEndTime) {
      const now = Date.now();
      const diffMs = parsed.targetEndTime - now;
      const rawDiffSec = Math.max(0, Math.ceil(diffMs / 1000));
      const diffSec =
        parsed.totalSeconds > 0 ? Math.min(parsed.totalSeconds, rawDiffSec) : rawDiffSec;

      if (diffSec <= 0) {
        // If session expired more than 15 minutes ago while closed, reset to IDLE without recording stale session
        if (diffMs < -900000) {
          const isFromPreviousDay =
            getLogicalDayKey(new Date(parsed.targetEndTime)) !== getLogicalDayKey(new Date(now)) &&
            now - parsed.targetEndTime >= INACTIVITY_THRESHOLD_MS;
          if (isFromPreviousDay) {
            parsed.sessionType = 'WORK';
            parsed.currentCycle = 1;
            parsed.totalSeconds = defaultSec;
            parsed.remainingSeconds = defaultSec;
            setLastResetDayKey(getLogicalDayKey(new Date(now)));
          } else {
            parsed.remainingSeconds = parsed.totalSeconds;
          }
          parsed.status = 'IDLE';
          parsed.targetEndTime = null;
          parsed.timerRunId = null;
          parsed.updatedAtMs = 0;
          saveTimerState(parsed);
        } else {
          // Expired while closed, preserve state so mount effect can record and alert
          return {
            ...parsed,
            remainingSeconds: 0,
          };
        }
      } else {
        return {
          ...parsed,
          remainingSeconds: diffSec,
        };
      }
    }

    // Check if we should reset for a new day
    const lastSessionTimeMs = getLastSessionCompletedAtFromStorage();
    const lastResetDayKey = getLastResetDayKey();
    const now = new Date();

    const isFreshlyPaused =
      parsed.status === 'PAUSED' &&
      typeof parsed.updatedAtMs === 'number' &&
      parsed.updatedAtMs > 0 &&
      now.getTime() - parsed.updatedAtMs < INACTIVITY_THRESHOLD_MS;

    if (
      !isFreshlyPaused &&
      shouldResetForNewDay({
        now,
        lastSessionTimeMs,
        lastResetDayKey,
        isTimerRunning: parsed.status === 'RUNNING',
      })
    ) {
      const currentDayKey = getLogicalDayKey(now);
      setLastResetDayKey(currentDayKey);
      const resetState: SavedTimerState = {
        ...parsed,
        sessionType: 'WORK',
        status: 'IDLE',
        currentCycle: 1,
        remainingSeconds: defaultSec,
        totalSeconds: defaultSec,
        targetEndTime: null,
        timerRunId: null,
        updatedAtMs: 0,
      };
      saveTimerState(resetState);
      return resetState;
    }

    return parsed;
  } catch {
    return fallback;
  }
};

export const saveTimerState = (stateToSave: SavedTimerState): void => {
  try {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
  } catch {
    // Storage errors ignored
  }
};
