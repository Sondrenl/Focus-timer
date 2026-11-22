import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WakeLockService } from '../src/services/screen/WakeLockService';
import { shouldResetForNewDay } from '../src/utils/newDayCheck';
import {
  computeActivityBars,
  computeProductiveMetric,
  filterPeriodSessions,
  getEffectiveSessionDate,
} from '../src/utils/stats/focusStats';
import { computeCoffeeStats } from '../src/utils/stats/coffeeStats';
import { buildInsightContext } from '../src/utils/insights/mathHelpers';
import { toDateKey } from '../src/utils/dates';
import { StatSession, StatCoffeeCup } from '../src/utils/stats/types';

function localIso(
  year: number,
  month1Based: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
  ms = 0
): string {
  return new Date(year, month1Based - 1, day, hour, minute, second, ms).toISOString();
}

describe('Topic 2 — WakeLockService concurrency & cleanup', () => {
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  });

  it('deduplicates concurrent acquire() calls and immediately releases sentinel if release() is called mid-flight', async () => {
    let resolveRequest!: (sentinel: { release: () => Promise<void>; addEventListener: () => void }) => void;
    const releaseSpy = vi.fn().mockResolvedValue(undefined);
    const requestSpy = vi.fn(
      () =>
        new Promise<{ release: () => Promise<void>; addEventListener: () => void }>((resolve) => {
          resolveRequest = resolve;
        })
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: { wakeLock: { request: requestSpy } },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: {
        visibilityState: 'visible',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    const service = new WakeLockService();

    // Two concurrent acquire() calls should only issue ONE navigator.wakeLock.request()
    const p1 = service.acquire();
    const p2 = service.acquire();
    expect(requestSpy).toHaveBeenCalledTimes(1);

    // User pauses/stops before the promise resolves
    await service.release();

    // Resolve the in-flight request -> sentinel must be immediately released!
    resolveRequest({ release: releaseSpy, addEventListener: vi.fn() });
    await Promise.all([p1, p2]);

    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Topic 2 — Multi-day stale reset before 04:00 AM & timerPersistence reload guards', () => {
  it('allows resetting a multi-day stale timer even between 00:00 and 03:59 AM while preserving same-logical-day late-night work', () => {
    // 1. User returns at 01:30 AM on Nov 7 (logical day Nov 6), but last worked Nov 4 (multi-day stale)
    expect(
      shouldResetForNewDay({
        now: new Date(2026, 10, 7, 1, 30, 0),
        lastSessionTimeMs: new Date(2026, 10, 4, 17, 0, 0).getTime(),
        lastResetDayKey: '2026-11-04',
        isTimerRunning: false,
      })
    ).toBe(true);

    // 2. User returns at 01:30 AM on Nov 7 (logical day Nov 6), worked earlier on Nov 6 (same logical day)
    expect(
      shouldResetForNewDay({
        now: new Date(2026, 10, 7, 1, 30, 0),
        lastSessionTimeMs: new Date(2026, 10, 6, 22, 0, 0).getTime(),
        lastResetDayKey: '2026-11-06',
        isTimerRunning: false,
      })
    ).toBe(false);
  });

  describe('loadInitialTimerState clamping & previous-day stale RUNNING reset', () => {
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

    it('clamps reloaded remainingSeconds to totalSeconds when system clock jumped backward', async () => {
      const now = new Date(2026, 10, 7, 10, 0, 0).getTime();
      vi.setSystemTime(now);
      store.set('focus_timer_last_day_reset_v1', '2026-11-07');
      store.set(
        'timer_state_v1',
        JSON.stringify({
          sessionType: 'WORK',
          status: 'RUNNING',
          currentCycle: 1,
          remainingSeconds: 1500,
          totalSeconds: 1500,
          targetEndTime: now + 3 * 60 * 60 * 1000, // 3 hours in future due to clock jump
          timerRunId: 'clock-jump-run',
          updatedAtMs: now - 1000,
          activeTagId: null,
          deviceId: 'dev-1',
          tabId: 'tab-1',
          lastActiveAtMs: now,
        })
      );

      const { loadInitialTimerState } = await import('../src/context/timer/timerPersistence');
      const loaded = loadInitialTimerState(25);
      expect(loaded.remainingSeconds).toBe(1500);
    });

    it('resets a previous-day stale (>15m expired) RUNNING timer to WORK Cycle 1', async () => {
      const morning = new Date(2026, 10, 7, 9, 0, 0).getTime();
      const yesterdayEvening = new Date(2026, 10, 6, 22, 0, 0).getTime();
      vi.setSystemTime(morning);
      // Even if lastResetDayKey was somehow already today, previous-day stale RUNNING resets cleanly
      store.set('focus_timer_last_day_reset_v1', '2026-11-07');
      store.set(
        'timer_state_v1',
        JSON.stringify({
          sessionType: 'SHORT_BREAK',
          status: 'RUNNING',
          currentCycle: 3,
          remainingSeconds: 120,
          totalSeconds: 300,
          targetEndTime: yesterdayEvening,
          timerRunId: 'yesterday-stale-run',
          updatedAtMs: yesterdayEvening - 300_000,
          activeTagId: null,
          deviceId: 'dev-1',
          tabId: 'tab-1',
          lastActiveAtMs: yesterdayEvening,
        })
      );

      const { loadInitialTimerState } = await import('../src/context/timer/timerPersistence');
      const loaded = loadInitialTimerState(25);
      expect(loaded.status).toBe('IDLE');
      expect(loaded.sessionType).toBe('WORK');
      expect(loaded.currentCycle).toBe(1);
      expect(loaded.remainingSeconds).toBe(25 * 60);
    });
  });
});

describe('Topic 2 — Cross-Midnight & Exact-Midnight Stats Consistency (Decision 3A)', () => {
  it('attributes pre-midnight minutes of a cross-midnight session to the preceding day 23:00 bar and post-midnight minutes to 00:00 bar', () => {
    // Session ran from 2026-11-14 23:45 to 2026-11-15 00:10 (25m total: 15m on Nov 14, 10m on Nov 15)
    const allWorkSessions: StatSession[] = [
      {
        id: 'cross-midnight-1',
        tagId: 'tag-dev',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: localIso(2026, 11, 15, 0, 10, 0),
      },
    ];

    // Viewing Nov 14 (preceding day): 0 sessions completed on Nov 14, but 15m overlap in 23:00!
    const nov14Start = new Date(2026, 10, 14, 0, 0, 0, 0);
    const nov14End = new Date(2026, 10, 14, 23, 59, 59, 999);
    const nov14Ref = new Date(2026, 10, 14, 12, 0, 0);
    const nov14Filtered = filterPeriodSessions(allWorkSessions, nov14Start, nov14End, true);
    expect(nov14Filtered.filteredSessions).toHaveLength(0);

    const nov14Bars = computeActivityBars(
      nov14Filtered.filteredSessions,
      'day',
      nov14Ref,
      nov14Start,
      { start: '2026-11-14', end: '2026-11-14' },
      allWorkSessions
    );
    expect(nov14Bars.find((b) => b.key === 'hour-23')?.totalSeconds).toBe(900);
    expect(nov14Bars.find((b) => b.key === 'hour-0')?.totalSeconds).toBe(0);

    const nov14Peak = computeProductiveMetric(
      nov14Filtered.filteredSessions,
      nov14Bars,
      'day',
      nov14Ref,
      false
    );
    expect(nov14Peak.hasData).toBe(true);
    expect(nov14Peak.value).toBe('23:00 – 00:00');
    expect(nov14Peak.subtext).toBe('15m focused');

    // Viewing Nov 15 (completion day): 10m overlap in 00:00, 0s in 23:00, total attributed to Nov 15 is 25m
    const nov15Start = new Date(2026, 10, 15, 0, 0, 0, 0);
    const nov15End = new Date(2026, 10, 15, 23, 59, 59, 999);
    const nov15Ref = new Date(2026, 10, 15, 12, 0, 0);
    const nov15Filtered = filterPeriodSessions(allWorkSessions, nov15Start, nov15End, true);
    expect(nov15Filtered.filteredSessions).toHaveLength(1);

    const nov15Bars = computeActivityBars(
      nov15Filtered.filteredSessions,
      'day',
      nov15Ref,
      nov15Start,
      { start: '2026-11-15', end: '2026-11-15' },
      allWorkSessions
    );
    expect(nov15Bars.find((b) => b.key === 'hour-0')?.totalSeconds).toBe(600);
    expect(nov15Bars.find((b) => b.key === 'hour-23')?.totalSeconds).toBe(0);
  });

  it('attributes exact-midnight (00:00:00.000) sessions identically across Stats, Insights, and Profile helpers', () => {
    const exactMidnightSession = {
      id: 'exact-midnight',
      tagId: null,
      sessionType: 'WORK' as const,
      durationSeconds: 1500,
      completedAt: localIso(2026, 11, 15, 0, 0, 0, 0),
    };

    // 1. Profile / shared helper
    const effective = getEffectiveSessionDate(
      exactMidnightSession.completedAt,
      exactMidnightSession.durationSeconds
    );
    expect(effective && toDateKey(effective)).toBe('2026-11-14');

    // 2. Insights mathHelpers
    const insightCtx = buildInsightContext({
      sessions: [exactMidnightSession],
      coffeeCups: [],
      tags: [],
      periodType: 'week',
      totalFocusSeconds: 1500,
      allSessions: [exactMidnightSession],
    });
    expect(insightCtx.activeFocusDates).toEqual(['2026-11-14']);
    expect(insightCtx.dateFocusMap.get('2026-11-14')?.seconds).toBe(1500);
    expect(insightCtx.dateFocusMap.has('2026-11-15')).toBe(false);
  });

  it('computes all-time coffee peak weekday reliably using noon-anchored dates across DST dates', () => {
    const cups: StatCoffeeCup[] = [
      { id: 'c1', date: '2026-03-08', tagId: null }, // US spring-forward Sunday
      { id: 'c2', date: '2026-03-08', tagId: null },
      { id: 'c3', date: '2026-03-09', tagId: null },
    ];
    const result = computeCoffeeStats({
      coffeeCups: cups,
      periodType: 'all',
      referenceDate: new Date(2026, 2, 10, 12, 0, 0),
      startDate: new Date(2026, 0, 1, 0, 0, 0),
      endDate: new Date(2026, 2, 10, 23, 59, 59),
      sanitizedCustomRange: { start: '2026-03-08', end: '2026-03-10' },
      todayKey: '2026-03-10',
      tags: [],
      shouldExcludeSample: true,
    });
    expect(result.coffeePeakMetric.value).toBe('Sundays');
    expect(result.totalCoffeeCups).toBe(3);
  });
});
