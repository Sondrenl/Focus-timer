import { SessionType, TimerStatus } from '../../types/timer';
import { isMobileDevice } from '../../utils/environment';
import { TAB_ID } from '../../services/timer/TimerBroadcast';
import {
  shouldResetForNewDay,
  getLogicalDayKey,
  getLastResetDayKey,
  setLastResetDayKey,
  getLastSessionCompletedAtFromStorage,
} from '../../utils/newDayCheck';

export const TIMER_STORAGE_KEY = 'timer_state_v1';
export const DEVICE_ID_KEY = 'focus_timer_device_id_v1';
export const SESSION_ALIVE_KEY = 'focus_timer_session_alive_v1';

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
export const DEVICE_SESSION_ID = `${DEVICE_ID}_${TAB_ID}`;

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
  tabId: string;
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
    updatedAtMs: Date.now(),
    activeTagId: null,
    deviceId: DEVICE_ID,
    tabId: TAB_ID,
    lastActiveAtMs: Date.now(),
    wasHidden: false,
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const stored = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!stored) {
      const currentDayKey = getLogicalDayKey(new Date());
      if (!getLastResetDayKey()) {
        setLastResetDayKey(currentDayKey);
      }
      return fallback;
    }
    const parsed = JSON.parse(stored) as SavedTimerState;

    // Handle running timers across tab restarts or browser crashes
    if (parsed.status === 'RUNNING' && parsed.targetEndTime) {
      const now = Date.now();
      const diffMs = parsed.targetEndTime - now;
      const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

      if (diffSec <= 0) {
        // If session expired more than 15 minutes ago while closed, reset to IDLE without recording stale session
        if (diffMs < -900000) {
          parsed.status = 'IDLE';
          parsed.targetEndTime = null;
          parsed.timerRunId = null;
          parsed.remainingSeconds = parsed.totalSeconds;
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

    if (
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
        updatedAtMs: Date.now(),
      };
      saveTimerState(resetState);
      return resetState;
    }

    return parsed;
  } catch {
    return fallback;
  }
};

export const saveTimerState = (stateToSave: SavedTimerState, markSessionAlive = false): void => {
  try {
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
    if (markSessionAlive) {
      sessionStorage.setItem(SESSION_ALIVE_KEY, '1');
    }
  } catch {
    // Storage errors ignored
  }
};
