import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildLocalTimeContext,
  buildSettingsSnapshot,
  computeCoffeeContextAt,
  computePriorAttemptContext,
} from '../src/utils/telemetryContext';
import { TelemetryRepository } from '../src/services/repository/TelemetryRepository';
import { TelemetryTracker } from '../src/services/telemetry/TelemetryTracker';
import { IStorageService } from '../src/services/storage/IStorageService';
import { DEFAULT_SETTINGS, UserSettings } from '../src/types/settings';
import { CoffeeCup } from '../src/types/coffee';
import { telemetryTracker } from '../src/context/services';
import { useBackupAndMigration } from '../src/hooks/data/useBackupAndMigration';
import { BackupData } from '../src/types/user';

class InMemoryStorage implements IStorageService {
  private store = new Map<string, unknown>();

  getItem<T>(key: string, defaultValue: T): T {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }

  setItem<T>(key: string, value: T): void {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('ML Telemetry Context, Repository, and Tracker', () => {
  let storage: InMemoryStorage;
  let repo: TelemetryRepository;
  let tracker: TelemetryTracker;

  beforeEach(() => {
    storage = new InMemoryStorage();
    repo = new TelemetryRepository(storage);
    tracker = new TelemetryTracker(repo);
  });

  describe('telemetryContext pure helpers', () => {
    it('builds consistent local time fields from epoch ms', () => {
      const date = new Date(2026, 10, 18, 14, 35, 10); // Nov 18 2026 14:35:10 local time
      const ctx = buildLocalTimeContext(date);
      expect(ctx.localDate).toBe('2026-11-18');
      expect(ctx.localHour).toBe(14);
      expect(ctx.localMinuteOfDay).toBe(14 * 60 + 35);
      expect(ctx.localDayOfWeek).toBe(date.getDay());
      expect(ctx.timestampMs).toBe(date.getTime());
    });

    it('computes coffee count today and minutes since most recent prior cup', () => {
      const now = new Date(2026, 10, 18, 14, 0, 0).getTime();
      const cups: CoffeeCup[] = [
        {
          id: 'c1',
          date: '2026-11-17',
          tagId: null,
          createdAt: new Date(2026, 10, 17, 9, 0, 0).toISOString(),
        },
        {
          id: 'c2',
          date: '2026-11-18',
          tagId: 'tag-1',
          createdAt: new Date(2026, 10, 18, 9, 30, 0).toISOString(),
        },
        {
          id: 'c3',
          date: '2026-11-18',
          tagId: 'tag-1',
          createdAt: new Date(2026, 10, 18, 13, 15, 0).toISOString(),
        },
        {
          id: 'c-future',
          date: '2026-11-18',
          tagId: null,
          createdAt: new Date(2026, 10, 18, 16, 0, 0).toISOString(),
        },
      ];

      const ctx = computeCoffeeContextAt(cups, '2026-11-18', now);
      expect(ctx.coffeeCupsToday).toBe(2);
      expect(ctx.minutesSinceLastCoffee).toBe(45);
    });

    it('computes prior attempt stats for today and excludes in_progress attempts', () => {
      const baseMs = new Date(2026, 10, 18, 10, 0, 0).getTime();
      const priorCtx = computePriorAttemptContext(
        [
          {
            attemptId: 'a1',
            sessionType: 'WORK',
            status: 'completed',
            wasStarted: true,
            plannedDurationSeconds: 1500,
            actualActiveSeconds: 1500,
            remainingSecondsAtEnd: 0,
            completionRatio: 1,
            startedAt: new Date(baseMs - 3000_000).toISOString(),
            endedAt: new Date(baseMs - 1500_000).toISOString(),
            utcOffsetMinutes: 0,
            localDate: '2026-11-18',
            localHour: 9,
            localMinuteOfDay: 540,
            localDayOfWeek: 3,
            cycleIndex: 1,
            longBreakInterval: 4,
            autoStarted: false,
            initialTagId: null,
            tagId: null,
            tagChangedMidRun: false,
            pauseCount: 0,
            totalPausedSeconds: 0,
            pauseIntervals: [],
            timeSincePreviousAttemptSeconds: null,
            previousAttemptType: null,
            previousAttemptOutcome: null,
            workSessionsCompletedToday: 0,
            workActiveSecondsToday: 0,
            skipsToday: 0,
            coffeeCupsTodayAtStart: 0,
            minutesSinceLastCoffeeAtStart: null,
            coffeeLoggedDuringRun: 0,
            dailyGoalMinutes: 120,
            settingsSnapshot: buildSettingsSnapshot(DEFAULT_SETTINGS),
            deviceClass: 'desktop',
            tabBackgroundedCount: 0,
            completionLatencySeconds: 0,
            source: 'client',
            updatedAtMs: baseMs - 1500_000,
          },
          {
            attemptId: 'a2',
            sessionType: 'SHORT_BREAK',
            status: 'skipped',
            wasStarted: false,
            plannedDurationSeconds: 300,
            actualActiveSeconds: 0,
            remainingSecondsAtEnd: 300,
            completionRatio: 0,
            startedAt: null,
            endedAt: new Date(baseMs - 300_000).toISOString(),
            utcOffsetMinutes: 0,
            localDate: '2026-11-18',
            localHour: 9,
            localMinuteOfDay: 595,
            localDayOfWeek: 3,
            cycleIndex: 1,
            longBreakInterval: 4,
            autoStarted: false,
            initialTagId: null,
            tagId: null,
            tagChangedMidRun: false,
            pauseCount: 0,
            totalPausedSeconds: 0,
            pauseIntervals: [],
            timeSincePreviousAttemptSeconds: 1200,
            previousAttemptType: 'WORK',
            previousAttemptOutcome: 'completed',
            workSessionsCompletedToday: 1,
            workActiveSecondsToday: 1500,
            skipsToday: 0,
            coffeeCupsTodayAtStart: 0,
            minutesSinceLastCoffeeAtStart: null,
            coffeeLoggedDuringRun: 0,
            dailyGoalMinutes: 120,
            settingsSnapshot: buildSettingsSnapshot(DEFAULT_SETTINGS),
            deviceClass: 'desktop',
            tabBackgroundedCount: 0,
            completionLatencySeconds: null,
            source: 'client',
            updatedAtMs: baseMs - 300_000,
          },
        ],
        '2026-11-18',
        baseMs
      );

      expect(priorCtx.workSessionsCompletedToday).toBe(1);
      expect(priorCtx.workActiveSecondsToday).toBe(1500);
      expect(priorCtx.skipsToday).toBe(1);
      expect(priorCtx.previousAttemptType).toBe('SHORT_BREAK');
      expect(priorCtx.previousAttemptOutcome).toBe('skipped');
      expect(priorCtx.timeSincePreviousAttemptSeconds).toBe(300);
    });
  });

  describe('TelemetryTracker lifecycle & behavioral events', () => {
    it('tracks full start -> pause -> tag change -> tab hidden -> coffee logged -> resume -> complete lifecycle', async () => {
      const startMs = new Date(2026, 10, 18, 9, 0, 0).getTime();
      const cupBefore: CoffeeCup = {
        id: 'cup-morning',
        date: '2026-11-18',
        tagId: 'tag-code',
        createdAt: new Date(startMs - 30 * 60_000).toISOString(),
      };

      const syncedAttempts: string[] = [];
      const syncedEventTypes: string[] = [];
      tracker.setCloudSink({
        upsertAttempt: async (a) => {
          syncedAttempts.push(`${a.attemptId}:${a.status}`);
        },
        recordEvents: async (evts) => {
          syncedEventTypes.push(...evts.map((e) => e.eventType));
        },
      });

      await tracker.onSessionStarted({
        attemptId: 'run-lifecycle-1',
        sessionType: 'WORK',
        plannedDurationSeconds: 1500,
        cycleIndex: 1,
        tagId: 'tag-code',
        autoStarted: false,
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [cupBefore],
        targetEndTimeMs: startMs + 1500_000,
        nowMs: startMs,
      });

      // Background tab twice while running
      await tracker.onTabVisibilityChanged(true);
      await tracker.onTabVisibilityChanged(false);
      await tracker.onTabVisibilityChanged(true);

      // Pause after 5 minutes (300s)
      const pauseMs = startMs + 300_000;
      await tracker.onSessionPaused({
        remainingSeconds: 1200,
        tagId: 'tag-code',
        nowMs: pauseMs,
      });

      // Change tag while paused
      await tracker.onTagChanged({
        previousTagId: 'tag-code',
        nextTagId: 'tag-design',
        timerStatus: 'PAUSED',
        sessionType: 'WORK',
        attemptId: 'run-lifecycle-1',
      });

      // Log a coffee cup during the run
      const cupDuring: CoffeeCup = {
        id: 'cup-midrun',
        date: '2026-11-18',
        tagId: 'tag-design',
        createdAt: new Date(pauseMs + 60_000).toISOString(),
      };
      await tracker.onCoffeeLogged({
        cup: cupDuring,
        allCupsAfterAdd: [cupBefore, cupDuring],
        timerStatus: 'PAUSED',
        activeSessionType: 'WORK',
      });

      // Resume after 120s pause
      const resumeMs = pauseMs + 120_000;
      await tracker.onSessionResumed({
        targetEndTimeMs: resumeMs + 1200_000,
        nowMs: resumeMs,
      });

      // Complete 1200s later (+2s completion latency)
      const completeTargetMs = resumeMs + 1200_000;
      await tracker.onSessionFinalized({
        attemptId: 'run-lifecycle-1',
        outcome: 'completed',
        sessionType: 'WORK',
        plannedDurationSeconds: 1500,
        remainingSecondsAtEnd: 0,
        cycleIndex: 1,
        tagId: 'tag-design',
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [cupBefore, cupDuring],
        wasStarted: true,
        targetEndTimeMs: completeTargetMs,
        nowMs: completeTargetMs + 2000,
      });

      const exported = tracker.getExportDataSync();
      expect(exported.sessionAttempts).toHaveLength(1);
      const attempt = exported.sessionAttempts[0];
      expect(attempt.status).toBe('completed');
      expect(attempt.actualActiveSeconds).toBe(1500);
      expect(attempt.completionRatio).toBe(1);
      expect(attempt.pauseCount).toBe(1);
      expect(attempt.totalPausedSeconds).toBe(120);
      expect(attempt.pauseIntervals).toHaveLength(1);
      expect(attempt.pauseIntervals[0].durationSeconds).toBe(120);
      expect(attempt.initialTagId).toBe('tag-code');
      expect(attempt.tagId).toBe('tag-design');
      expect(attempt.tagChangedMidRun).toBe(true);
      expect(attempt.coffeeCupsTodayAtStart).toBe(1);
      expect(attempt.minutesSinceLastCoffeeAtStart).toBe(30);
      expect(attempt.coffeeLoggedDuringRun).toBe(1);
      expect(attempt.tabBackgroundedCount).toBe(2);
      expect(attempt.completionLatencySeconds).toBe(2);

      const types = exported.events.map((e) => e.eventType);
      expect(types).toContain('session_started');
      expect(types).toContain('session_paused');
      expect(types).toContain('tag_changed');
      expect(types).toContain('coffee_logged');
      expect(types).toContain('session_resumed');
      expect(types).toContain('session_completed');

      const coffeeEvt = exported.events.find((e) => e.eventType === 'coffee_logged');
      expect(coffeeEvt?.cupIndexToday).toBe(2);
      expect(coffeeEvt?.minutesSincePreviousCup).toBe(36);
      expect(coffeeEvt?.attemptId).toBe('run-lifecycle-1');
      expect(syncedAttempts[0]).toBe('run-lifecycle-1:in_progress');
      expect(syncedAttempts[syncedAttempts.length - 1]).toBe('run-lifecycle-1:completed');
      expect(syncedEventTypes).toContain('session_completed');
    });

    it('records idle skips, mid-run skips, resets, switches, and orphaned draft abandonment', async () => {
      const baseMs = new Date(2026, 10, 18, 12, 0, 0).getTime();

      // 1. Idle skip (SHORT_BREAK -> WORK without ever starting)
      await tracker.onSessionFinalized({
        attemptId: null,
        outcome: 'skipped',
        sessionType: 'SHORT_BREAK',
        plannedDurationSeconds: 300,
        remainingSecondsAtEnd: 300,
        cycleIndex: 1,
        tagId: null,
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [],
        wasStarted: false,
        toSessionType: 'WORK',
        nowMs: baseMs,
      });

      // 2. Start & reset
      await tracker.onSessionStarted({
        attemptId: 'run-reset-1',
        sessionType: 'WORK',
        plannedDurationSeconds: 1500,
        cycleIndex: 2,
        tagId: 'tag-1',
        autoStarted: false,
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [],
        targetEndTimeMs: baseMs + 1510_000,
        nowMs: baseMs + 10_000,
      });
      await tracker.onSessionFinalized({
        attemptId: 'run-reset-1',
        outcome: 'reset',
        sessionType: 'WORK',
        plannedDurationSeconds: 1500,
        remainingSecondsAtEnd: 1400,
        cycleIndex: 2,
        tagId: 'tag-1',
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [],
        wasStarted: true,
        nowMs: baseMs + 110_000,
      });

      // 3. Start & switch without bogus pause
      await tracker.onSessionStarted({
        attemptId: 'run-switch-1',
        sessionType: 'WORK',
        plannedDurationSeconds: 1500,
        cycleIndex: 2,
        tagId: 'tag-1',
        autoStarted: false,
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [],
        targetEndTimeMs: baseMs + 1700_000,
        nowMs: baseMs + 200_000,
      });
      await tracker.onSessionFinalized({
        attemptId: 'run-switch-1',
        outcome: 'switched',
        sessionType: 'WORK',
        plannedDurationSeconds: 1500,
        remainingSecondsAtEnd: 1450,
        cycleIndex: 2,
        tagId: 'tag-1',
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [],
        wasStarted: true,
        toSessionType: 'LONG_BREAK',
        nowMs: baseMs + 250_000,
      });

      // 4. Orphaned draft recovery when app reloads after >15m expiration
      await tracker.onSessionStarted({
        attemptId: 'run-orphan-1',
        sessionType: 'WORK',
        plannedDurationSeconds: 1500,
        cycleIndex: 3,
        tagId: 'tag-1',
        autoStarted: false,
        settings: DEFAULT_SETTINGS,
        dailyGoalMinutes: 120,
        coffeeCups: [],
        targetEndTimeMs: Date.now() - 100_000,
        nowMs: Date.now() - 1600_000,
      });
      await tracker.finalizeOrphanedDraftIfStale();

      const data = await tracker.getExportData();
      expect(data.sessionAttempts).toHaveLength(4);
      expect(data.sessionAttempts[0].wasStarted).toBe(false);
      expect(data.sessionAttempts[0].status).toBe('skipped');
      expect(data.sessionAttempts[1].status).toBe('reset');
      expect(data.sessionAttempts[2].status).toBe('switched');
      expect(data.sessionAttempts[2].pauseCount).toBe(0);
      expect(data.sessionAttempts[3].status).toBe('abandoned_stale');
      expect(data.events.some((e) => e.eventType === 'session_abandoned_stale')).toBe(true);
    });

    it('records settings_changed, daily_goal_changed, coffee_removed, tag cleanup, import/export, and clearAll without cookies', async () => {
      const updatedSettings: UserSettings = {
        ...DEFAULT_SETTINGS,
        workDurationMinutes: 45,
        longBreakInterval: 3,
      };
      await tracker.onSettingsChanged({
        previousSettings: DEFAULT_SETTINGS,
        newSettings: updatedSettings,
      });
      // Non-ML fields like soundVolume must not emit settings_changed
      await tracker.onSettingsChanged({
        previousSettings: updatedSettings,
        newSettings: { ...updatedSettings, soundVolume: 0.2 },
      });

      await tracker.onDailyGoalChanged({
        previousGoalMinutes: 120,
        newGoalMinutes: 180,
      });

      await tracker.onCoffeeRemoved({
        id: 'cup-del',
        date: '2026-11-18',
        tagId: 'tag-remove-me',
        createdAt: '2026-11-18T11:00:00.000Z',
      });

      await tracker.onSessionStarted({
        attemptId: 'run-tag-clean',
        sessionType: 'WORK',
        plannedDurationSeconds: 2700,
        cycleIndex: 1,
        tagId: 'tag-remove-me',
        autoStarted: false,
        settings: updatedSettings,
        dailyGoalMinutes: 180,
        coffeeCups: [],
        targetEndTimeMs: Date.now() + 2700_000,
      });
      await tracker.clearTagReferences('tag-remove-me');

      const draftAfterTagClean = await repo.getActiveDraft();
      expect(draftAfterTagClean?.attempt.tagId).toBeNull();
      expect(draftAfterTagClean?.attempt.initialTagId).toBeNull();

      const exported = await tracker.getExportData();
      const settingsEvts = exported.events.filter((e) => e.eventType === 'settings_changed');
      expect(settingsEvts).toHaveLength(1);
      expect(settingsEvts[0].changedFields).toEqual(['workDurationMinutes', 'longBreakInterval']);
      expect(exported.events.some((e) => e.eventType === 'daily_goal_changed')).toBe(true);
      expect(exported.events.some((e) => e.eventType === 'coffee_removed')).toBe(true);

      // Clear & restore via importTelemetry
      await tracker.clearAll();
      expect((await tracker.getExportData()).sessionAttempts).toHaveLength(0);
      expect((await tracker.getExportData()).events).toHaveLength(0);

      await tracker.importTelemetry(exported, 'replace');
      expect((await tracker.getExportData()).sessionAttempts).toHaveLength(1);
      expect((await tracker.getExportData()).events.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('useBackupAndMigration mlTelemetry export, import, and reset', () => {
    it('exports, imports (merge/replace with sample filtering), and clears mlTelemetry', async () => {
      await telemetryTracker.clearAll();
      await telemetryTracker.onSettingsChanged({
        previousSettings: DEFAULT_SETTINGS,
        newSettings: { ...DEFAULT_SETTINGS, workDurationMinutes: 35 },
      });

      let exportFn!: () => BackupData;
      let importFn!: (
        data: BackupData,
        mode: 'merge' | 'replace'
      ) => Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded: number }>;
      let resetFn!: (scope: 'sessions-only' | 'factory-reset') => Promise<void>;

      function Harness() {
        const { exportBackup, importBackup, resetAllData } = useBackupAndMigration({
          isEffectiveAuthenticated: false,
          profile: {
            id: 'local',
            displayName: 'Local User',
            avatarEmoji: '⏱️',
            dailyGoalMinutes: 120,
            createdAt: '2026-11-18T00:00:00.000Z',
          },
          settings: DEFAULT_SETTINGS,
          updateProfile: vi.fn(),
          updateSettings: vi.fn(),
          resetProfileToDefaults: vi.fn(),
          resetSettingsToDefaults: vi.fn(),
          convexSync: {
            isConvexConfigured: false,
            convexUser: null,
            convexCoffee: [],
            convexSessions: [],
            mutations: {
              importBackup: vi.fn(),
              clearSessions: vi.fn().mockResolvedValue(undefined),
              clearCoffee: vi.fn().mockResolvedValue(undefined),
              clearTelemetry: vi.fn().mockResolvedValue(undefined),
              resetTags: vi.fn().mockResolvedValue(undefined),
            } as any,
          },
          tags: [
            {
              id: 'tag-work',
              name: 'Work',
              color: '#3B82F6',
              isArchived: false,
              createdAt: '2026-11-18T00:00:00.000Z',
              updatedAt: '2026-11-18T00:00:00.000Z',
            },
          ],
          setTags: vi.fn(),
          activeTagId: 'tag-work',
          setActiveTagId: vi.fn(),
          sessions: [],
          setSessions: vi.fn(),
          coffeeCups: [],
          setCoffeeCups: vi.fn(),
        });

        exportFn = exportBackup;
        importFn = importBackup;
        resetFn = resetAllData;
        return null;
      }

      renderToStaticMarkup(React.createElement(Harness));

      const exported = exportFn();
      expect(exported.mlTelemetry).toBeDefined();
      expect(exported.mlTelemetry?.schemaVersion).toBe(1);
      expect(exported.mlTelemetry?.events.some((e) => e.eventType === 'settings_changed')).toBe(
        true
      );

      // Reset clears telemetry
      await resetFn('sessions-only');
      expect((await telemetryTracker.getExportData()).events).toHaveLength(0);

      // Re-import exported backup in replace mode restores mlTelemetry
      await importFn(exported, 'replace');
      const afterImport = await telemetryTracker.getExportData();
      expect(afterImport.events.some((e) => e.eventType === 'settings_changed')).toBe(true);

      await telemetryTracker.clearAll();
    });
  });
});
