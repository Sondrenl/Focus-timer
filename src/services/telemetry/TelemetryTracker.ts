import {
  AttemptOutcome,
  MlEvent,
  MlTelemetryExport,
  PauseInterval,
  SessionAttempt,
  SettingsSnapshot,
} from '../../types/telemetry';
import { SessionType, TimerStatus } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';
import {
  ActiveAttemptDraft,
  TelemetryRepository,
} from '../repository/TelemetryRepository';
import {
  buildLocalTimeContext,
  buildSettingsSnapshot,
  computeCoffeeContextAt,
  computePriorAttemptContext,
  getDeviceClass,
  getMinimumAbortTelemetrySeconds,
} from '../../utils/telemetryContext';

export interface TelemetryCloudSink {
  upsertAttempt: (attempt: SessionAttempt) => Promise<unknown>;
  recordEvents: (events: MlEvent[]) => Promise<unknown>;
  discardAttempt?: (attemptId: string) => Promise<unknown>;
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toNullableId(id?: string | null): string | null {
  return id && id.trim().length > 0 ? id : null;
}

const MAX_PAUSE_INTERVALS = 50;

/**
 * Passive, cookie-free ML telemetry orchestrator.
 * Captures timer attempt lifecycles, pause dynamics, setting adjustments, and coffee context
 * in localStorage (via TelemetryRepository) and optional authenticated Convex sync.
 */
export class TelemetryTracker {
  private repo: TelemetryRepository;
  private cloudSink: TelemetryCloudSink | null = null;
  private draftLoaded = false;
  private activeDraft: ActiveAttemptDraft | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(repo: TelemetryRepository) {
    this.repo = repo;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  setCloudSink(sink: TelemetryCloudSink | null): void {
    this.cloudSink = sink;
  }

  private async ensureDraftLoaded(): Promise<ActiveAttemptDraft | null> {
    if (!this.draftLoaded) {
      this.activeDraft = await this.repo.getActiveDraft();
      this.draftLoaded = true;
    }
    return this.activeDraft;
  }

  private pushAttemptToCloud(attempt: SessionAttempt): void {
    if (!this.cloudSink) return;
    this.cloudSink.upsertAttempt(attempt).catch((err) => {
      console.warn('[Telemetry] Failed to sync attempt to cloud:', err);
    });
  }

  private pushEventsToCloud(events: MlEvent[]): void {
    if (!this.cloudSink || events.length === 0) return;
    this.cloudSink.recordEvents(events).catch((err) => {
      console.warn('[Telemetry] Failed to sync events to cloud:', err);
    });
  }

  private buildBaseEvent(
    eventType: MlEvent['eventType'],
    dateOrMs: Date | number = new Date(),
    eventId?: string
  ): MlEvent {
    const t = buildLocalTimeContext(dateOrMs);
    return {
      eventId: eventId ?? generateId('evt'),
      eventType,
      timestamp: t.timestamp,
      timestampMs: t.timestampMs,
      utcOffsetMinutes: t.utcOffsetMinutes,
      ianaTimezone: t.ianaTimezone,
      localDate: t.localDate,
      localHour: t.localHour,
      localMinuteOfDay: t.localMinuteOfDay,
      localDayOfWeek: t.localDayOfWeek,
      deviceClass: getDeviceClass(),
    };
  }

  async onSessionStarted(params: {
    attemptId: string;
    sessionType: SessionType;
    plannedDurationSeconds: number;
    cycleIndex: number;
    tagId: string | null;
    autoStarted: boolean;
    settings: UserSettings;
    dailyGoalMinutes: number;
    coffeeCups: CoffeeCup[];
    targetEndTimeMs: number | null;
    nowMs?: number;
  }): Promise<void> {
    return this.enqueue(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const timeCtx = buildLocalTimeContext(nowMs);
      const existingDraft = await this.ensureDraftLoaded();

      // If resuming an existing paused draft with the same attemptId, delegate to resume logic
      if (
        existingDraft &&
        existingDraft.attempt.attemptId === params.attemptId &&
        existingDraft.attempt.status === 'in_progress'
      ) {
        await this.performResume(existingDraft, nowMs, params.targetEndTimeMs);
        return;
      }

      const [priorAttempts] = await Promise.all([this.repo.getAttempts()]);
      const coffeeMetrics = computeCoffeeContextAt(
        params.coffeeCups,
        timeCtx.localDate,
        nowMs
      );
      const priorMetrics = computePriorAttemptContext(
        priorAttempts,
        timeCtx.localDate,
        nowMs
      );

      const cleanTagId = toNullableId(params.tagId);
      const settingsSnap = buildSettingsSnapshot(params.settings);
      const plannedSec = Math.max(1, Math.round(params.plannedDurationSeconds));

      const attempt: SessionAttempt = {
        attemptId: params.attemptId,
        sessionType: params.sessionType,
        status: 'in_progress',
        wasStarted: true,
        plannedDurationSeconds: plannedSec,
        actualActiveSeconds: 0,
        remainingSecondsAtEnd: plannedSec,
        completionRatio: 0,
        startedAt: timeCtx.timestamp,
        endedAt: null,
        utcOffsetMinutes: timeCtx.utcOffsetMinutes,
        ianaTimezone: timeCtx.ianaTimezone,
        localDate: timeCtx.localDate,
        localHour: timeCtx.localHour,
        localMinuteOfDay: timeCtx.localMinuteOfDay,
        localDayOfWeek: timeCtx.localDayOfWeek,
        cycleIndex: params.cycleIndex,
        longBreakInterval: params.settings.longBreakInterval,
        autoStarted: params.autoStarted,
        initialTagId: cleanTagId,
        tagId: cleanTagId,
        tagChangedMidRun: false,
        pauseCount: 0,
        totalPausedSeconds: 0,
        pauseIntervals: [],
        timeSincePreviousAttemptSeconds: priorMetrics.timeSincePreviousAttemptSeconds,
        previousAttemptType: priorMetrics.previousAttemptType,
        previousAttemptOutcome: priorMetrics.previousAttemptOutcome,
        workSessionsCompletedToday: priorMetrics.workSessionsCompletedToday,
        workActiveSecondsToday: priorMetrics.workActiveSecondsToday,
        skipsToday: priorMetrics.skipsToday,
        coffeeCupsTodayAtStart: coffeeMetrics.coffeeCupsToday,
        minutesSinceLastCoffeeAtStart: coffeeMetrics.minutesSinceLastCoffee,
        coffeeLoggedDuringRun: 0,
        dailyGoalMinutes: params.dailyGoalMinutes || 120,
        settingsSnapshot: settingsSnap,
        deviceClass: getDeviceClass(),
        tabBackgroundedCount: 0,
        completionLatencySeconds: null,
        source: 'client',
        updatedAtMs: nowMs,
      };

      const draft: ActiveAttemptDraft = {
        attempt,
        activeSegmentStartMs: nowMs,
        accumulatedActiveMs: 0,
        currentPauseStartMs: null,
        targetEndTimeMs: params.targetEndTimeMs,
      };

      this.activeDraft = draft;
      this.draftLoaded = true;
      await this.repo.saveActiveDraft(draft);
      await this.repo.upsertAttempt(attempt);
      this.pushAttemptToCloud(attempt);
    });
  }

  private async performResume(
    draft: ActiveAttemptDraft,
    nowMs: number,
    targetEndTimeMs: number | null
  ): Promise<void> {
    if (draft.activeSegmentStartMs !== null && draft.currentPauseStartMs === null) {
      return; // Already running
    }

    const timeCtx = buildLocalTimeContext(nowMs);
    let pauseDurationSeconds = 0;
    const updatedPauses = [...draft.attempt.pauseIntervals];

    if (draft.currentPauseStartMs !== null) {
      pauseDurationSeconds = Math.max(
        0,
        Math.round((nowMs - draft.currentPauseStartMs) / 1000)
      );
      if (updatedPauses.length > 0) {
        const lastIdx = updatedPauses.length - 1;
        updatedPauses[lastIdx] = {
          ...updatedPauses[lastIdx],
          resumedAt: timeCtx.timestamp,
          durationSeconds: pauseDurationSeconds,
        };
      }
    }

    const updatedAttempt: SessionAttempt = {
      ...draft.attempt,
      totalPausedSeconds: draft.attempt.totalPausedSeconds + pauseDurationSeconds,
      pauseIntervals: updatedPauses,
      updatedAtMs: nowMs,
    };

    const nextDraft: ActiveAttemptDraft = {
      attempt: updatedAttempt,
      activeSegmentStartMs: nowMs,
      accumulatedActiveMs: draft.accumulatedActiveMs,
      currentPauseStartMs: null,
      targetEndTimeMs,
    };

    this.activeDraft = nextDraft;
    await this.repo.saveActiveDraft(nextDraft);
    await this.repo.upsertAttempt(updatedAttempt);
    this.pushAttemptToCloud(updatedAttempt);
  }

  async onSessionPaused(params: {
    remainingSeconds: number;
    tagId?: string | null;
    nowMs?: number;
  }): Promise<void> {
    return this.enqueue(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const draft = await this.ensureDraftLoaded();
      if (!draft || draft.attempt.status !== 'in_progress') return;
      if (draft.currentPauseStartMs !== null) return; // Already paused

      const timeCtx = buildLocalTimeContext(nowMs);
      const segmentMs =
        draft.activeSegmentStartMs !== null ? Math.max(0, nowMs - draft.activeSegmentStartMs) : 0;
      const accumulatedActiveMs = draft.accumulatedActiveMs + segmentMs;
      const elapsedActiveSeconds = Math.max(0, Math.round(accumulatedActiveMs / 1000));

      const nextTagId =
        params.tagId !== undefined ? toNullableId(params.tagId) : draft.attempt.tagId;
      const tagChangedMidRun =
        draft.attempt.tagChangedMidRun || nextTagId !== draft.attempt.initialTagId;

      const pauseEntry: PauseInterval = {
        pausedAt: timeCtx.timestamp,
        elapsedActiveSecondsAtPause: elapsedActiveSeconds,
        remainingSecondsAtPause: Math.max(0, Math.round(params.remainingSeconds)),
      };

      const nextPauses =
        draft.attempt.pauseIntervals.length < MAX_PAUSE_INTERVALS
          ? [...draft.attempt.pauseIntervals, pauseEntry]
          : draft.attempt.pauseIntervals;

      const updatedAttempt: SessionAttempt = {
        ...draft.attempt,
        tagId: nextTagId,
        tagChangedMidRun,
        actualActiveSeconds: elapsedActiveSeconds,
        pauseCount: draft.attempt.pauseCount + 1,
        pauseIntervals: nextPauses,
        updatedAtMs: nowMs,
      };

      const nextDraft: ActiveAttemptDraft = {
        attempt: updatedAttempt,
        activeSegmentStartMs: null,
        accumulatedActiveMs,
        currentPauseStartMs: nowMs,
        targetEndTimeMs: null,
      };

      this.activeDraft = nextDraft;
      await this.repo.saveActiveDraft(nextDraft);
      await this.repo.upsertAttempt(updatedAttempt);
      this.pushAttemptToCloud(updatedAttempt);
    });
  }

  async onSessionResumed(params: {
    targetEndTimeMs: number | null;
    nowMs?: number;
  }): Promise<void> {
    return this.enqueue(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const draft = await this.ensureDraftLoaded();
      if (!draft || draft.attempt.status !== 'in_progress') return;
      await this.performResume(draft, nowMs, params.targetEndTimeMs);
    });
  }

  async onSessionFinalized(params: {
    attemptId?: string | null;
    outcome: AttemptOutcome;
    sessionType: SessionType;
    plannedDurationSeconds: number;
    remainingSecondsAtEnd: number;
    cycleIndex: number;
    tagId: string | null;
    settings: UserSettings;
    dailyGoalMinutes: number;
    coffeeCups: CoffeeCup[];
    wasStarted: boolean;
    targetEndTimeMs?: number | null;
    toSessionType?: SessionType | null;
    nowMs?: number;
  }): Promise<void> {
    if (!params.wasStarted) return;
    return this.enqueue(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const timeCtx = buildLocalTimeContext(nowMs);
      const draft = await this.ensureDraftLoaded();

      const resolvedAttemptId =
        params.attemptId ||
        draft?.attempt.attemptId ||
        generateId(params.wasStarted ? 'att' : 'idle');

      const cleanTagId = toNullableId(params.tagId);
      const plannedSec = Math.max(1, Math.round(params.plannedDurationSeconds));
      const remainingSec = Math.max(0, Math.round(params.remainingSecondsAtEnd));

      let finalizedAttempt: SessionAttempt;

      if (draft && draft.attempt.status === 'in_progress' && params.wasStarted) {
        let accumulatedActiveMs = draft.accumulatedActiveMs;
        if (draft.activeSegmentStartMs !== null) {
          // Cap active segment end to targetEndTimeMs if completed after sleeping slightly
          const effectiveEndMs =
            params.outcome === 'completed' &&
            (params.targetEndTimeMs ?? draft.targetEndTimeMs) !== null &&
            (params.targetEndTimeMs ?? draft.targetEndTimeMs)! < nowMs
              ? (params.targetEndTimeMs ?? draft.targetEndTimeMs)!
              : nowMs;
          accumulatedActiveMs += Math.max(0, effectiveEndMs - draft.activeSegmentStartMs);
        }

        let totalPausedSeconds = draft.attempt.totalPausedSeconds;
        const updatedPauses = [...draft.attempt.pauseIntervals];
        if (draft.currentPauseStartMs !== null) {
          const extraPauseSec = Math.max(
            0,
            Math.round((nowMs - draft.currentPauseStartMs) / 1000)
          );
          totalPausedSeconds += extraPauseSec;
          if (updatedPauses.length > 0) {
            const lastIdx = updatedPauses.length - 1;
            updatedPauses[lastIdx] = {
              ...updatedPauses[lastIdx],
              resumedAt: timeCtx.timestamp,
              durationSeconds: extraPauseSec,
            };
          }
        }

        const wallActiveSec = Math.round(accumulatedActiveMs / 1000);
        const nominalElapsedSec = Math.max(0, plannedSec - remainingSec);
        const actualActiveSeconds =
          params.outcome === 'completed'
            ? Math.max(1, wallActiveSec > 0 ? Math.min(wallActiveSec, plannedSec) : plannedSec)
            : Math.max(0, wallActiveSec > 0 ? wallActiveSec : nominalElapsedSec);

        const effectiveTargetEnd = params.targetEndTimeMs ?? draft.targetEndTimeMs;
        const completionLatencySeconds =
          params.outcome === 'completed' && effectiveTargetEnd !== null
            ? Math.max(0, Math.round((nowMs - effectiveTargetEnd) / 1000))
            : null;

        const endedMs =
          params.outcome === 'completed' &&
          effectiveTargetEnd !== null &&
          effectiveTargetEnd < nowMs
            ? effectiveTargetEnd
            : nowMs;

        finalizedAttempt = {
          ...draft.attempt,
          status: params.outcome,
          endedAt: new Date(endedMs).toISOString(),
          tagId: cleanTagId,
          tagChangedMidRun:
            draft.attempt.tagChangedMidRun || cleanTagId !== draft.attempt.initialTagId,
          actualActiveSeconds,
          remainingSecondsAtEnd: params.outcome === 'completed' ? 0 : remainingSec,
          completionRatio: Number(
            Math.min(2, actualActiveSeconds / plannedSec).toFixed(4)
          ),
          totalPausedSeconds,
          pauseIntervals: updatedPauses,
          completionLatencySeconds,
          source: 'client',
          updatedAtMs: nowMs,
        };
      } else {
        // Synthesize attempt for idle skips or runs originated on another tab/device
        const priorAttempts = await this.repo.getAttempts();
        const coffeeMetrics = computeCoffeeContextAt(
          params.coffeeCups,
          timeCtx.localDate,
          nowMs
        );
        const priorMetrics = computePriorAttemptContext(
          priorAttempts,
          timeCtx.localDate,
          nowMs
        );
        const actualActiveSeconds = !params.wasStarted
          ? 0
          : params.outcome === 'completed'
          ? plannedSec
          : Math.max(0, plannedSec - remainingSec);

        finalizedAttempt = {
          attemptId: resolvedAttemptId,
          sessionType: params.sessionType,
          status: params.outcome,
          wasStarted: params.wasStarted,
          plannedDurationSeconds: plannedSec,
          actualActiveSeconds,
          remainingSecondsAtEnd: params.outcome === 'completed' ? 0 : remainingSec,
          completionRatio: Number(
            Math.min(2, actualActiveSeconds / plannedSec).toFixed(4)
          ),
          startedAt: params.wasStarted
            ? new Date(nowMs - actualActiveSeconds * 1000).toISOString()
            : null,
          endedAt: timeCtx.timestamp,
          utcOffsetMinutes: timeCtx.utcOffsetMinutes,
          ianaTimezone: timeCtx.ianaTimezone,
          localDate: timeCtx.localDate,
          localHour: timeCtx.localHour,
          localMinuteOfDay: timeCtx.localMinuteOfDay,
          localDayOfWeek: timeCtx.localDayOfWeek,
          cycleIndex: params.cycleIndex,
          longBreakInterval: params.settings.longBreakInterval,
          autoStarted: false,
          initialTagId: cleanTagId,
          tagId: cleanTagId,
          tagChangedMidRun: false,
          pauseCount: 0,
          totalPausedSeconds: 0,
          pauseIntervals: [],
          timeSincePreviousAttemptSeconds: priorMetrics.timeSincePreviousAttemptSeconds,
          previousAttemptType: priorMetrics.previousAttemptType,
          previousAttemptOutcome: priorMetrics.previousAttemptOutcome,
          workSessionsCompletedToday: priorMetrics.workSessionsCompletedToday,
          workActiveSecondsToday: priorMetrics.workActiveSecondsToday,
          skipsToday: priorMetrics.skipsToday,
          coffeeCupsTodayAtStart: coffeeMetrics.coffeeCupsToday,
          minutesSinceLastCoffeeAtStart: coffeeMetrics.minutesSinceLastCoffee,
          coffeeLoggedDuringRun: 0,
          dailyGoalMinutes: params.dailyGoalMinutes || 120,
          settingsSnapshot: buildSettingsSnapshot(params.settings),
          deviceClass: getDeviceClass(),
          tabBackgroundedCount: 0,
          completionLatencySeconds:
            params.outcome === 'completed' && params.targetEndTimeMs
              ? Math.max(0, Math.round((nowMs - params.targetEndTimeMs) / 1000))
              : null,
          source: 'client',
          updatedAtMs: nowMs,
        };
      }

      const isAbortOutcome =
        params.outcome === 'skipped' ||
        params.outcome === 'reset' ||
        params.outcome === 'switched';
      const minAbortSeconds = getMinimumAbortTelemetrySeconds(plannedSec);

      if (isAbortOutcome && finalizedAttempt.actualActiveSeconds < minAbortSeconds) {
        this.activeDraft = null;
        this.draftLoaded = true;
        await this.repo.saveActiveDraft(null);
        await this.repo.discardAttempt(resolvedAttemptId);
        if (this.cloudSink?.discardAttempt) {
          this.cloudSink.discardAttempt(resolvedAttemptId).catch((err) => {
            console.warn('[Telemetry] Failed to discard short attempt from cloud:', err);
          });
        }
        return;
      }

      this.activeDraft = null;
      this.draftLoaded = true;
      await this.repo.saveActiveDraft(null);
      await this.repo.upsertAttempt(finalizedAttempt);
      this.pushAttemptToCloud(finalizedAttempt);
    });
  }

  async onTabVisibilityChanged(isHidden: boolean): Promise<void> {
    if (!isHidden) return;
    return this.enqueue(async () => {
      const draft = await this.ensureDraftLoaded();
      if (!draft || draft.attempt.status !== 'in_progress') return;
      if (draft.activeSegmentStartMs === null) return; // Not actively running

      const nextDraft: ActiveAttemptDraft = {
        ...draft,
        attempt: {
          ...draft.attempt,
          tabBackgroundedCount: draft.attempt.tabBackgroundedCount + 1,
          updatedAtMs: Date.now(),
        },
      };
      this.activeDraft = nextDraft;
      await this.repo.saveActiveDraft(nextDraft);
    });
  }

  async onTagChanged(params: {
    previousTagId: string | null;
    nextTagId: string | null;
    timerStatus: TimerStatus;
    sessionType: SessionType;
    attemptId?: string | null;
  }): Promise<void> {
    const prevClean = toNullableId(params.previousTagId);
    const nextClean = toNullableId(params.nextTagId);
    if (prevClean === nextClean) return;

    return this.enqueue(async () => {
      const nowMs = Date.now();
      const draft = await this.ensureDraftLoaded();
      let resolvedAttemptId = params.attemptId ?? null;

      if (draft && draft.attempt.status === 'in_progress') {
        resolvedAttemptId = draft.attempt.attemptId;
        const nextDraft: ActiveAttemptDraft = {
          ...draft,
          attempt: {
            ...draft.attempt,
            tagId: nextClean,
            tagChangedMidRun:
              draft.attempt.tagChangedMidRun || nextClean !== draft.attempt.initialTagId,
            updatedAtMs: nowMs,
          },
        };
        this.activeDraft = nextDraft;
        await this.repo.saveActiveDraft(nextDraft);
        await this.repo.upsertAttempt(nextDraft.attempt);
        this.pushAttemptToCloud(nextDraft.attempt);
      }

      const evt: MlEvent = {
        ...this.buildBaseEvent('tag_changed', nowMs),
        attemptId: resolvedAttemptId,
        sessionType: params.sessionType,
        activeTimerStatus: params.timerStatus,
        fromTagId: prevClean,
        toTagId: nextClean,
        tagId: nextClean,
        source: 'client',
      };
      await this.repo.recordEvent(evt);
      this.pushEventsToCloud([evt]);
    });
  }

  async onCoffeeLogged(params: {
    cup: CoffeeCup;
    allCupsAfterAdd: CoffeeCup[];
    timerStatus: TimerStatus | null;
    activeSessionType: SessionType | null;
  }): Promise<void> {
    return this.enqueue(async () => {
      const cupMs = Date.parse(params.cup.createdAt);
      const nowMs = Number.isNaN(cupMs) ? Date.now() : cupMs;

      const draft = await this.ensureDraftLoaded();
      let activeAttemptId: string | null = null;
      if (draft && draft.attempt.status === 'in_progress') {
        activeAttemptId = draft.attempt.attemptId;
        const nextDraft: ActiveAttemptDraft = {
          ...draft,
          attempt: {
            ...draft.attempt,
            coffeeLoggedDuringRun: draft.attempt.coffeeLoggedDuringRun + 1,
            updatedAtMs: Date.now(),
          },
        };
        this.activeDraft = nextDraft;
        await this.repo.saveActiveDraft(nextDraft);
      }

      const cupsOnDate = params.allCupsAfterAdd.filter((c) => c.date === params.cup.date);
      const cupIndexToday = cupsOnDate.length;

      let prevCupMs: number | null = null;
      for (const c of params.allCupsAfterAdd) {
        if (c.id === params.cup.id) continue;
        const ms = Date.parse(c.createdAt);
        if (!Number.isNaN(ms) && ms <= nowMs) {
          if (prevCupMs === null || ms > prevCupMs) {
            prevCupMs = ms;
          }
        }
      }
      const minutesSincePreviousCup =
        prevCupMs !== null ? Math.max(0, Math.round((nowMs - prevCupMs) / 60000)) : null;

      const attempts = await this.repo.getAttempts();
      let lastWorkEndMs: number | null = null;
      for (const att of attempts) {
        if (att.sessionType === 'WORK' && att.status !== 'in_progress' && att.endedAt) {
          const ms = Date.parse(att.endedAt);
          if (!Number.isNaN(ms) && ms <= nowMs) {
            if (lastWorkEndMs === null || ms > lastWorkEndMs) {
              lastWorkEndMs = ms;
            }
          }
        }
      }
      const minutesSinceLastWorkEnd =
        lastWorkEndMs !== null
          ? Math.max(0, Math.round((nowMs - lastWorkEndMs) / 60000))
          : null;

      const evt: MlEvent = {
        ...this.buildBaseEvent('coffee_logged', nowMs),
        attemptId: activeAttemptId,
        sessionType: params.activeSessionType,
        activeTimerStatus: params.timerStatus,
        tagId: toNullableId(params.cup.tagId),
        cupId: params.cup.id,
        cupDate: params.cup.date,
        cupIndexToday,
        minutesSincePreviousCup,
        minutesSinceLastWorkEnd,
        source: 'client',
      };
      await this.repo.recordEvent(evt);
      this.pushEventsToCloud([evt]);
    });
  }

  async onCoffeeRemoved(cup: CoffeeCup): Promise<void> {
    return this.enqueue(async () => {
      const nowMs = Date.now();
      const evt: MlEvent = {
        ...this.buildBaseEvent('coffee_removed', nowMs),
        tagId: toNullableId(cup.tagId),
        cupId: cup.id,
        cupDate: cup.date,
        source: 'client',
      };
      await this.repo.recordEvent(evt);
      this.pushEventsToCloud([evt]);
    });
  }

  async onSettingsChanged(params: {
    previousSettings: UserSettings;
    newSettings: UserSettings;
  }): Promise<void> {
    const trackedKeys: (keyof SettingsSnapshot)[] = [
      'workDurationMinutes',
      'shortBreakDurationMinutes',
      'longBreakDurationMinutes',
      'longBreakInterval',
      'autoStartBreaks',
      'autoStartPomodoros',
    ];
    const prevSnap = buildSettingsSnapshot(params.previousSettings);
    const nextSnap = buildSettingsSnapshot(params.newSettings);
    const changedFields = trackedKeys.filter((k) => prevSnap[k] !== nextSnap[k]);
    if (changedFields.length === 0) return;

    return this.enqueue(async () => {
      const nowMs = Date.now();
      const evt: MlEvent = {
        ...this.buildBaseEvent('settings_changed', nowMs),
        changedFields,
        previousSettings: prevSnap,
        newSettings: nextSnap,
        source: 'client',
      };
      await this.repo.recordEvent(evt);
      this.pushEventsToCloud([evt]);
    });
  }

  async onDailyGoalChanged(params: {
    previousGoalMinutes: number;
    newGoalMinutes: number;
  }): Promise<void> {
    if (params.previousGoalMinutes === params.newGoalMinutes) return;
    return this.enqueue(async () => {
      const nowMs = Date.now();
      const evt: MlEvent = {
        ...this.buildBaseEvent('daily_goal_changed', nowMs),
        previousDailyGoalMinutes: params.previousGoalMinutes,
        newDailyGoalMinutes: params.newGoalMinutes,
        source: 'client',
      };
      await this.repo.recordEvent(evt);
      this.pushEventsToCloud([evt]);
    });
  }

  async clearTagReferences(tagId: string): Promise<void> {
    return this.enqueue(async () => {
      await this.repo.clearTagReferences(tagId);
      if (this.activeDraft) {
        this.activeDraft = await this.repo.getActiveDraft();
      }
    });
  }

  async finalizeOrphanedDraftIfStale(): Promise<void> {
    return this.enqueue(async () => {
      const draft = await this.ensureDraftLoaded();
      if (!draft || draft.attempt.status !== 'in_progress') return;

      const nowMs = Date.now();
      const timeCtx = buildLocalTimeContext(nowMs);
      let accumulatedActiveMs = draft.accumulatedActiveMs;
      if (draft.activeSegmentStartMs !== null) {
        const capMs =
          draft.targetEndTimeMs !== null && draft.targetEndTimeMs < nowMs
            ? draft.targetEndTimeMs
            : nowMs;
        accumulatedActiveMs += Math.max(0, capMs - draft.activeSegmentStartMs);
      }

      const plannedSec = Math.max(1, draft.attempt.plannedDurationSeconds);
      const wallActiveSec = Math.max(0, Math.min(plannedSec, Math.round(accumulatedActiveMs / 1000)));
      const remainingSecondsAtEnd = Math.max(0, plannedSec - wallActiveSec);

      const finalizedAttempt: SessionAttempt = {
        ...draft.attempt,
        status: 'abandoned_stale',
        endedAt: draft.targetEndTimeMs
          ? new Date(Math.min(nowMs, draft.targetEndTimeMs)).toISOString()
          : timeCtx.timestamp,
        actualActiveSeconds: wallActiveSec,
        remainingSecondsAtEnd,
        completionRatio: Number(Math.min(2, wallActiveSec / plannedSec).toFixed(4)),
        source: 'client',
        updatedAtMs: nowMs,
      };

      this.activeDraft = null;
      this.draftLoaded = true;
      await this.repo.saveActiveDraft(null);
      await this.repo.upsertAttempt(finalizedAttempt);
      this.pushAttemptToCloud(finalizedAttempt);
    });
  }

  getExportDataSync(): MlTelemetryExport {
    return {
      schemaVersion: 1,
      sessionAttempts: this.repo.getAttemptsSync(),
      events: this.repo.getEventsSync(),
    };
  }

  async getExportData(): Promise<MlTelemetryExport> {
    return this.enqueue(async () => {
      const [sessionAttempts, events] = await Promise.all([
        this.repo.getAttempts(),
        this.repo.getEvents(),
      ]);
      return {
        schemaVersion: 1,
        sessionAttempts,
        events,
      };
    });
  }

  async importTelemetry(
    incoming: MlTelemetryExport,
    mode: 'merge' | 'replace'
  ): Promise<void> {
    return this.enqueue(async () => {
      if (mode === 'replace') {
        this.activeDraft = null;
        this.draftLoaded = true;
        await this.repo.saveActiveDraft(null);
        await this.repo.saveAttempts(incoming.sessionAttempts);
        await this.repo.saveEvents(incoming.events);
        return;
      }

      for (const att of incoming.sessionAttempts) {
        await this.repo.upsertAttempt(att);
      }
      if (incoming.events.length > 0) {
        await this.repo.recordEvents(incoming.events);
      }
    });
  }

  async clearAll(): Promise<void> {
    return this.enqueue(async () => {
      this.activeDraft = null;
      this.draftLoaded = true;
      await this.repo.clear();
    });
  }
}
