// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isProduction } from '../src/utils/environment';
import {
  loadInitialTimerState,
  saveTimerState,
  SavedTimerState,
  TIMER_STORAGE_KEY,
} from '../src/context/timer/timerPersistence';
import {
  ProfileRepository,
  sanitizeProfile,
  MAX_AVATAR_EMOJI_LENGTH,
} from '../src/services/repository/ProfileRepository';
import { LocalStorageService } from '../src/services/storage/LocalStorageService';
import { LAST_DAY_RESET_STORAGE_KEY } from '../src/utils/newDayCheck';
import { DEFAULT_PROFILE } from '../src/types/user';

describe('Cloud Sync, Auth & Timer State-Machine Regression Fixes', () => {
  const store = new Map<string, string>();

  const installMockWindow = (hostname = 'localhost') => {
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, String(val));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      get length() {
        return store.size;
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: mockStorage,
        location: { hostname },
      },
      configurable: true,
      writable: true,
    });
  };

  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    installMockWindow('localhost');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('environment.ts subdomain vs .dev TLD classification', () => {
    beforeEach(() => {
      vi.stubEnv('PROD', true);
      vi.stubEnv('VITE_APP_ENV', '');
    });

    it('returns false for dev-focus-timer.sondrelassen.workers.dev', () => {
      installMockWindow('dev-focus-timer.sondrelassen.workers.dev');
      expect(isProduction()).toBe(false);
    });

    it('returns true for focus-timer.sondrelassen.workers.dev', () => {
      installMockWindow('focus-timer.sondrelassen.workers.dev');
      expect(isProduction()).toBe(true);
    });

    it('returns true for a custom .dev production domain (pomodor.dev)', () => {
      installMockWindow('pomodor.dev');
      expect(isProduction()).toBe(true);
    });

    it('returns false for a dev subdomain on a .dev domain (dev.pomodor.dev)', () => {
      installMockWindow('dev.pomodor.dev');
      expect(isProduction()).toBe(false);
    });

    it('returns false for dev/preview/staging subdomains and localhost', () => {
      for (const host of [
        'localhost',
        '127.0.0.1',
        'dev.example.com',
        'dev-app.pomodor.dev',
        'preview.pomodor.dev',
        'staging.pomodor.dev',
        'stage.pomodor.dev',
      ]) {
        installMockWindow(host);
        expect(isProduction(), `expected ${host} to be non-production`).toBe(false);
      }
    });
  });

  describe('timerPersistence.ts paused all-nighter protection across 04:00 AM', () => {
    it('preserves a freshly-paused all-nighter timer (<1h) across the 04:00 AM cutoff', () => {
      vi.useFakeTimers();
      // User paused at 03:50 AM (logical day 2026-11-06), reloads at 04:15 AM (logical day 2026-11-07)
      const pausedAtMs = new Date(2026, 10, 7, 3, 50, 0).getTime();
      const reloadTime = new Date(2026, 10, 7, 4, 15, 0);
      vi.setSystemTime(reloadTime);

      localStorage.setItem(LAST_DAY_RESET_STORAGE_KEY, '2026-11-06');
      const saved: SavedTimerState = {
        sessionType: 'WORK',
        status: 'PAUSED',
        currentCycle: 3,
        remainingSeconds: 842,
        totalSeconds: 1500,
        targetEndTime: null,
        timerRunId: 'run-allnighter-1',
        updatedAtMs: pausedAtMs,
        activeTagId: 'tag-study',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        lastActiveAtMs: pausedAtMs,
      };
      saveTimerState(saved);

      const loaded = loadInitialTimerState(25);
      expect(loaded.status).toBe('PAUSED');
      expect(loaded.currentCycle).toBe(3);
      expect(loaded.remainingSeconds).toBe(842);
      expect(loaded.timerRunId).toBe('run-allnighter-1');
    });

    it('resets an overnight (>1h) paused timer after 04:00 AM', () => {
      vi.useFakeTimers();
      // User paused at 22:00 PM previous evening, reloads at 08:30 AM next morning
      const pausedAtMs = new Date(2026, 10, 6, 22, 0, 0).getTime();
      const morningTime = new Date(2026, 10, 7, 8, 30, 0);
      vi.setSystemTime(morningTime);

      localStorage.setItem(LAST_DAY_RESET_STORAGE_KEY, '2026-11-06');
      const saved: SavedTimerState = {
        sessionType: 'SHORT_BREAK',
        status: 'PAUSED',
        currentCycle: 3,
        remainingSeconds: 180,
        totalSeconds: 300,
        targetEndTime: null,
        timerRunId: 'run-overnight-1',
        updatedAtMs: pausedAtMs,
        activeTagId: 'tag-work',
        deviceId: 'dev-1',
        tabId: 'tab-1',
        lastActiveAtMs: pausedAtMs,
      };
      saveTimerState(saved);

      const loaded = loadInitialTimerState(25);
      expect(loaded.status).toBe('IDLE');
      expect(loaded.sessionType).toBe('WORK');
      expect(loaded.currentCycle).toBe(1);
      expect(loaded.remainingSeconds).toBe(1500);
      expect(loaded.timerRunId).toBeNull();
      expect(localStorage.getItem(LAST_DAY_RESET_STORAGE_KEY)).toBe('2026-11-07');
      expect(JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY)!).status).toBe('IDLE');
    });
  });

  describe('ProfileRepository.ts 32-char ZWJ avatarEmoji support', () => {
    it('preserves multi-codepoint ZWJ avatarEmoji longer than 10 UTF-16 code units up to 32 chars', async () => {
      // Family / technologist ZWJ sequence exceeding 10 UTF-16 code units (11+ code units)
      const zwjEmoji = '👨‍👩‍👧‍👦'; // length 11 in UTF-16 code units
      const longerZwj = '👩‍❤️‍💋‍👨👨‍💻'; // 16 UTF-16 code units
      expect(zwjEmoji.length).toBeGreaterThan(10);
      expect(longerZwj.length).toBeGreaterThan(10);
      expect(longerZwj.length).toBeLessThanOrEqual(MAX_AVATAR_EMOJI_LENGTH);
      expect(MAX_AVATAR_EMOJI_LENGTH).toBe(32);

      const storageService = new LocalStorageService();
      const repo = new ProfileRepository(storageService);

      await repo.save({
        ...DEFAULT_PROFILE,
        displayName: '   ',
        avatarEmoji: `  ${longerZwj}  `,
      });

      const loaded = await repo.get();
      expect(loaded.avatarEmoji).toBe(longerZwj);
      expect(loaded.displayName).toBe(DEFAULT_PROFILE.displayName);

      // Still enforces the 32-char ceiling matching convex/users.ts
      const oversized = sanitizeProfile({ avatarEmoji: 'a'.repeat(50) });
      expect(oversized.avatarEmoji).toHaveLength(32);
    });
  });
});
