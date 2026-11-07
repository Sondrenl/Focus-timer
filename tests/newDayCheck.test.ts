import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getLogicalDayKey,
  getLastSessionCompletedAt,
  shouldResetForNewDay,
  NEW_DAY_HOUR_CUTOFF,
  INACTIVITY_THRESHOLD_MS,
  LAST_DAY_RESET_STORAGE_KEY,
  getLastResetDayKey,
  setLastResetDayKey,
} from '../src/utils/newDayCheck';

describe('New Day Check Utilities', () => {
  describe('getLogicalDayKey', () => {
    it('returns today for times at or after 04:00', () => {
      const d1 = new Date(2026, 10, 7, 4, 0, 0); // 2026-11-07 04:00:00
      expect(getLogicalDayKey(d1)).toBe('2026-11-07');

      const d2 = new Date(2026, 10, 7, 12, 30, 0); // 2026-11-07 12:30:00
      expect(getLogicalDayKey(d2)).toBe('2026-11-07');

      const d3 = new Date(2026, 10, 7, 23, 59, 59); // 2026-11-07 23:59:59
      expect(getLogicalDayKey(d3)).toBe('2026-11-07');
    });

    it('returns yesterday for times before 04:00', () => {
      const d1 = new Date(2026, 10, 7, 3, 59, 59); // 2026-11-07 03:59:59
      expect(getLogicalDayKey(d1)).toBe('2026-11-06');

      const d2 = new Date(2026, 10, 7, 0, 0, 0); // 2026-11-07 00:00:00
      expect(getLogicalDayKey(d2)).toBe('2026-11-06');

      const d3 = new Date(2026, 10, 7, 2, 15, 0); // 2026-11-07 02:15:00
      expect(getLogicalDayKey(d3)).toBe('2026-11-06');
    });

    it('correctly handles month rollover before 04:00 on the first day of a month', () => {
      const nov1At3am = new Date(2026, 10, 1, 3, 0, 0); // 2026-11-01 03:00
      expect(getLogicalDayKey(nov1At3am)).toBe('2026-10-31');
    });

    it('correctly handles year rollover before 04:00 on January 1', () => {
      const jan1At2am = new Date(2027, 0, 1, 2, 30, 0); // 2027-01-01 02:30
      expect(getLogicalDayKey(jan1At2am)).toBe('2026-12-31');
    });
  });

  describe('getLastSessionCompletedAt', () => {
    it('returns null for empty or undefined sessions', () => {
      expect(getLastSessionCompletedAt([])).toBeNull();
      expect(getLastSessionCompletedAt(null)).toBeNull();
      expect(getLastSessionCompletedAt(undefined)).toBeNull();
    });

    it('ignores sample and seed sessions', () => {
      const sessions = [
        { id: 'sample-session-1', completedAt: '2026-11-07T12:00:00.000Z' },
        { id: 'seed-session-1', completedAt: '2026-11-07T12:30:00.000Z' },
      ];
      expect(getLastSessionCompletedAt(sessions)).toBeNull();
    });

    it('returns the latest timestamp among real completed sessions', () => {
      const time1 = new Date(2026, 10, 7, 10, 0, 0).toISOString();
      const time2 = new Date(2026, 10, 7, 11, 0, 0).toISOString();
      const sessions = [
        { id: 'real-1', completedAt: time1 },
        { id: 'sample-session-1', completedAt: new Date(2026, 10, 7, 13, 0, 0).toISOString() },
        { id: 'real-2', completedAt: time2 },
      ];
      expect(getLastSessionCompletedAt(sessions)).toBe(new Date(time2).getTime());
    });
  });

  describe('shouldResetForNewDay', () => {
    it('does not reset if timer is actively running', () => {
      const now = new Date(2026, 10, 7, 9, 0, 0);
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: new Date(2026, 10, 6, 18, 0, 0).getTime(),
        lastResetDayKey: '2026-11-06',
        isTimerRunning: true,
      });
      expect(shouldReset).toBe(false);
    });

    it('does not reset if time is before 04:00 (e.g. 02:30 AM)', () => {
      const now = new Date(2026, 10, 7, 2, 30, 0);
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: new Date(2026, 10, 6, 23, 0, 0).getTime(),
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(false);
    });

    it('does not reset if time is 03:59:59 (just before 04:00)', () => {
      const now = new Date(2026, 10, 7, 3, 59, 59);
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: new Date(2026, 10, 6, 20, 0, 0).getTime(),
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(false);
    });

    it('does not reset if user had a session within the last hour (all-nighter protection at 04:15)', () => {
      // User worked until 03:45 AM, now it is 04:15 AM (30 mins ago)
      const now = new Date(2026, 10, 7, 4, 15, 0);
      const lastSession = new Date(2026, 10, 7, 3, 45, 0).getTime();
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: lastSession,
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(false);
    });

    it('does not reset if all-nighter is still in progress past 05:00 with recent session', () => {
      // User completed session at 04:55 AM, now it is 05:20 AM (25 mins ago)
      const now = new Date(2026, 10, 7, 5, 20, 0);
      const lastSession = new Date(2026, 10, 7, 4, 55, 0).getTime();
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: lastSession,
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(false);
    });

    it('resets when it is after 04:00 and more than 1 hour has passed since last session (standard morning wake up)', () => {
      // Normal morning: 08:30 AM, last session was yesterday at 17:00
      const now = new Date(2026, 10, 7, 8, 30, 0);
      const lastSession = new Date(2026, 10, 6, 17, 0, 0).getTime();
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: lastSession,
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(true);
    });

    it('resets after all-nighter ends and user sleeps for > 1 hour', () => {
      // All-nighter finished session at 05:00 AM, user wakes up at 12:00 PM (7 hours later)
      const now = new Date(2026, 10, 7, 12, 0, 0);
      const lastSession = new Date(2026, 10, 7, 5, 0, 0).getTime();
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: lastSession,
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(true);
    });

    it('does NOT reset again once the check has been performed for the current day', () => {
      // User reset at 08:30 AM (lastResetDayKey is '2026-11-07').
      // At 14:00 PM, user took a 2-hour break (no session in last hour).
      const now = new Date(2026, 10, 7, 14, 0, 0);
      const lastSession = new Date(2026, 10, 7, 11, 30, 0).getTime();
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: lastSession,
        lastResetDayKey: '2026-11-07', // already stamped for today
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(false);
    });

    it('resets for brand new user with no sessions after 04:00', () => {
      const now = new Date(2026, 10, 7, 9, 0, 0);
      const shouldReset = shouldResetForNewDay({
        now,
        lastSessionTimeMs: null,
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      });
      expect(shouldReset).toBe(true);
    });
  });

  describe('localStorage reset key helper', () => {
    const store = new Map<string, string>();

    beforeEach(() => {
      store.clear();
      const mockStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => store.set(key, val),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      };
      Object.defineProperty(globalThis, 'localStorage', {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'window', {
        value: { localStorage: mockStorage },
        configurable: true,
        writable: true,
      });
    });

    it('saves and retrieves lastResetDayKey correctly', () => {
      expect(getLastResetDayKey()).toBeNull();
      setLastResetDayKey('2026-11-07');
      expect(getLastResetDayKey()).toBe('2026-11-07');
    });
  });

  describe('loadInitialTimerState new-day integration', () => {
    const store = new Map<string, string>();

    beforeEach(() => {
      store.clear();
      const mockStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => store.set(key, val),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      };
      Object.defineProperty(globalThis, 'localStorage', {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'window', {
        value: { localStorage: mockStorage, sessionStorage: mockStorage },
        configurable: true,
        writable: true,
      });
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resets stored state from yesterday on fresh morning reload (08:30 AM)', async () => {
      // Mock system time to 2026-11-07 08:30:00
      vi.setSystemTime(new Date(2026, 10, 7, 8, 30, 0));

      // Saved state from yesterday: was on cycle 3, SHORT_BREAK
      const yesterdayTimerState = {
        sessionType: 'SHORT_BREAK',
        status: 'IDLE',
        currentCycle: 3,
        remainingSeconds: 300,
        totalSeconds: 300,
        targetEndTime: null,
        timerRunId: null,
        updatedAtMs: new Date(2026, 10, 6, 17, 30, 0).getTime(),
        activeTagId: 'tag-1',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        lastActiveAtMs: new Date(2026, 10, 6, 17, 30, 0).getTime(),
      };
      store.set('timer_state_v1', JSON.stringify(yesterdayTimerState));
      store.set('focus_timer_last_day_reset_v1', '2026-11-06');

      // Sessions from yesterday
      const sessions = [
        {
          id: 'real-session-1',
          sessionType: 'WORK',
          durationSeconds: 1500,
          completedAt: new Date(2026, 10, 6, 17, 0, 0).toISOString(),
        },
      ];
      store.set('sessions_v1', JSON.stringify(sessions));

      const { loadInitialTimerState } = await import('../src/context/timer/timerPersistence');
      const loaded = loadInitialTimerState(25);

      // Verify timer is reset to fresh cycle 1
      expect(loaded.currentCycle).toBe(1);
      expect(loaded.sessionType).toBe('WORK');
      expect(loaded.status).toBe('IDLE');
      expect(loaded.remainingSeconds).toBe(25 * 60);
      expect(loaded.totalSeconds).toBe(25 * 60);

      // Verify lastResetDayKey was stamped to today
      expect(store.get('focus_timer_last_day_reset_v1')).toBe('2026-11-07');
    });

    it('preserves cycle when all-nighter is active (session within last hour)', async () => {
      // Mock system time to 2026-11-07 04:20:00 (after 04:00)
      vi.setSystemTime(new Date(2026, 10, 7, 4, 20, 0));

      // User just finished session at 03:55 AM (25 mins ago)
      const sessions = [
        {
          id: 'all-nighter-session',
          sessionType: 'WORK',
          durationSeconds: 1500,
          completedAt: new Date(2026, 10, 7, 3, 55, 0).toISOString(),
        },
      ];
      store.set('sessions_v1', JSON.stringify(sessions));
      store.set('focus_timer_last_day_reset_v1', '2026-11-06');

      const allNighterState = {
        sessionType: 'SHORT_BREAK',
        status: 'IDLE',
        currentCycle: 3,
        remainingSeconds: 300,
        totalSeconds: 300,
        targetEndTime: null,
        timerRunId: null,
        updatedAtMs: new Date(2026, 10, 7, 3, 55, 0).getTime(),
        activeTagId: null,
        deviceId: 'dev-1',
        tabId: 'tab-1',
        lastActiveAtMs: new Date(2026, 10, 7, 3, 55, 0).getTime(),
      };
      store.set('timer_state_v1', JSON.stringify(allNighterState));

      const { loadInitialTimerState } = await import('../src/context/timer/timerPersistence');
      const loaded = loadInitialTimerState(25);

      // Must NOT reset because of active all-nighter
      expect(loaded.currentCycle).toBe(3);
      expect(loaded.sessionType).toBe('SHORT_BREAK');
      expect(store.get('focus_timer_last_day_reset_v1')).toBe('2026-11-06');
    });

    it('preserves running timer even after 04:00', async () => {
      // Mock system time to 2026-11-07 08:00:00
      const now = new Date(2026, 10, 7, 8, 0, 0).getTime();
      vi.setSystemTime(now);

      const runningState = {
        sessionType: 'WORK',
        status: 'RUNNING',
        currentCycle: 2,
        remainingSeconds: 600,
        totalSeconds: 1500,
        targetEndTime: now + 600 * 1000,
        timerRunId: 'run-1',
        updatedAtMs: now - 1000,
        activeTagId: null,
        deviceId: 'dev-1',
        tabId: 'tab-1',
        lastActiveAtMs: now,
      };
      store.set('timer_state_v1', JSON.stringify(runningState));

      const { loadInitialTimerState } = await import('../src/context/timer/timerPersistence');
      const loaded = loadInitialTimerState(25);

      expect(loaded.status).toBe('RUNNING');
      expect(loaded.currentCycle).toBe(2);
      expect(loaded.remainingSeconds).toBe(600);
    });
  });
});
