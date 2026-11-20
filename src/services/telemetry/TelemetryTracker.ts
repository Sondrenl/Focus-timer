import {
  AttemptOutcome,
  MlEvent,
  MlTelemetryExport,
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
  buildSettingsSnapshot,
  getMinimumAbortTelemetrySeconds,
} from '../../utils/telemetryContext';
import {
  buildBaseTelemetryEvent,
  computeCoffeeLoggingMetrics,
  createInitialAttemptDraft,
  finalizeAttemptFromDraft,
  finalizeStaleAttemptDraft,
  generateTelemetryId,
  pauseAttemptDraft,
  resumeAttemptDraft,
  synthesizeRemoteAttempt,
  toNullableTelemetryId,
} from './telemetryBuilders';

export interface TelemetryCloudSink {
  upsertAttempt: (attempt: SessionAttempt) => Promise<unknown>;
  recordEvents: (events: MlEvent[]) => Promise<unknown>;
  discardAttempt?: (attemptId: string) => Promise<unknown>;
}

/**
 * Passive, cookie-free ML telemetry orchestrator.
 * Coordinates attempt lifecycles, pause dynamics, setting adjustments, and coffee context
 * across localStorage (via TelemetryRepository) and optional authenticated Convex sync.
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

  /**
   * Resets the cached active draft so the next queued operation reloads from storage
   * (used when another tab broadcasts a data reset).
   */
  invalidateDraftCache(): void {
    this.draftLoaded = false;
    this.activeDraft = null;
  }

  /**
   * Discards an in-progress attempt locally and in the cloud (used when multi-device
   * arbitration rejects a phantom auto-started run).
   */
  async discardInProgressAttempt(attemptId: string): Promise<void> {
    if (!attemptId) return;
    return this.enqueue(async () => {
      const draft = await this.ensureDraftLoaded();
      if (draft && draft.attempt.attemptId === attemptId && draft.attempt.status === 'in_progress') {
        this.activeDraft = null;
        this.draftLoaded = true;
        await this.repo.saveActiveDraft(null);
      }
      await this.repo.discardAttempt(attemptId);
      if (this.cloudSink?.discardAttempt) {
        this.cloudSink.discardAttempt(attemptId).catch((err) => {
          console.warn('[Telemetry] Failed to discard attempt from cloud:', err);
        });
      }
    });
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
      const existingDraft = await this.ensureDraftLoaded();

      if (
        existingDraft &&
        existingDraft.attempt.attemptId === params.attemptId &&
        existingDraft.attempt.status === 'in_progress'
      ) {
        await this.performResume(existingDraft, nowMs, params.targetEndTimeMs);
        return;
      }

      if (
        existingDraft &&
        existingDraft.attempt.status === 'in_progress' &&
        existingDraft.attempt.attemptId !== params.attemptId
      ) {
        await this.finalizeDraftStaleInternal(existingDraft, nowMs);
      }

      const priorAttempts = await this.repo.getAttempts();
      const draft = createInitialAttemptDraft({
        ...params,
        priorAttempts,
        nowMs,
      });

      this.activeDraft = draft;
      this.draftLoaded = true;
      await this.repo.saveActiveDraft(draft);
      await this.repo.upsertAttempt(draft.attempt);
      this.pushAttemptToCloud(draft.attempt);
    });
  }

  private async performResume(
    draft: ActiveAttemptDraft,
    nowMs: number,
    targetEndTimeMs: number | null
  ): Promise<void> {
    if (draft.activeSegmentStartMs !== null && draft.currentPauseStartMs === null) {
      return;
    }

    const nextDraft = resumeAttemptDraft(draft, nowMs, targetEndTimeMs);
    this.activeDraft = nextDraft;
    await this.repo.saveActiveDraft(nextDraft);
    await this.repo.upsertAttempt(nextDraft.attempt);
    this.pushAttemptToCloud(nextDraft.attempt);
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
      if (draft.currentPauseStartMs !== null) return;

      const nextDraft = pauseAttemptDraft(draft, {
        remainingSeconds: params.remainingSeconds,
        tagId: params.tagId,
        nowMs,
      });

      this.activeDraft = nextDraft;
      await this.repo.saveActiveDraft(nextDraft);
      await this.repo.upsertAttempt(nextDraft.attempt);
      this.pushAttemptToCloud(nextDraft.attempt);
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
    nowMs?: number;
  }): Promise<void> {
    if (!params.wasStarted) return;
    return this.enqueue(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const draft = await this.ensureDraftLoaded();

      const draftMatchesAttempt =
        Boolean(draft) &&
        draft!.attempt.status === 'in_progress' &&
        (!params.attemptId || draft!.attempt.attemptId === params.attemptId);

      if (
        draft &&
        draft.attempt.status === 'in_progress' &&
        params.attemptId &&
        draft.attempt.attemptId !== params.attemptId
      ) {
        await this.finalizeDraftStaleInternal(draft, nowMs);
      }

      const resolvedAttemptId =
        params.attemptId ||
        (draftMatchesAttempt ? draft!.attempt.attemptId : null) ||
        generateTelemetryId('att');

      const cleanTagId = toNullableTelemetryId(params.tagId);
      const plannedSec = Math.max(1, Math.round(params.plannedDurationSeconds));
      const remainingSec = Math.max(0, Math.round(params.remainingSecondsAtEnd));

      const finalizedAttempt =
        draftMatchesAttempt && draft
          ? finalizeAttemptFromDraft(draft, {
              outcome: params.outcome,
              plannedSec,
              remainingSec,
              cleanTagId,
              targetEndTimeMs: params.targetEndTimeMs,
              nowMs,
            })
          : synthesizeRemoteAttempt({
              resolvedAttemptId,
              outcome: params.outcome,
              sessionType: params.sessionType,
              plannedSec,
              remainingSec,
              cycleIndex: params.cycleIndex,
              cleanTagId,
              settings: params.settings,
              dailyGoalMinutes: params.dailyGoalMinutes,
              coffeeCups: params.coffeeCups,
              priorAttempts: await this.repo.getAttempts(),
              targetEndTimeMs: params.targetEndTimeMs,
              nowMs,
            });

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
      if (draft.activeSegmentStartMs === null) return;

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
      await this.repo.upsertAttempt(nextDraft.attempt);
      this.pushAttemptToCloud(nextDraft.attempt);
    });
  }

  async onTagChanged(params: {
    previousTagId: string | null;
    nextTagId: string | null;
    timerStatus: TimerStatus;
    sessionType: SessionType;
    attemptId?: string | null;
  }): Promise<void> {
    const prevClean = toNullableTelemetryId(params.previousTagId);
    const nextClean = toNullableTelemetryId(params.nextTagId);
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
        ...buildBaseTelemetryEvent('tag_changed', nowMs),
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
      const isDraftFresh =
        draft !== null &&
        draft.attempt.status === 'in_progress' &&
        (draft.currentPauseStartMs !== null ||
          draft.targetEndTimeMs === null ||
          nowMs <= draft.targetEndTimeMs + 60_000);

      if (draft && isDraftFresh) {
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
        await this.repo.upsertAttempt(nextDraft.attempt);
        this.pushAttemptToCloud(nextDraft.attempt);
      }

      const attempts = await this.repo.getAttempts();
      const { cupIndexToday, minutesSincePreviousCup, minutesSinceLastWorkEnd } =
        computeCoffeeLoggingMetrics({
          cup: params.cup,
          allCupsAfterAdd: params.allCupsAfterAdd,
          attempts,
          nowMs,
        });

      const evt: MlEvent = {
        ...buildBaseTelemetryEvent('coffee_logged', nowMs),
        attemptId: activeAttemptId,
        sessionType: params.activeSessionType,
        activeTimerStatus: params.timerStatus,
        tagId: toNullableTelemetryId(params.cup.tagId),
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

  async reconcileCoffeeCupId(localCupId: string, serverCupId: string): Promise<void> {
    if (!localCupId || !serverCupId || localCupId === serverCupId) return;
    return this.enqueue(async () => {
      const events = await this.repo.getEvents();
      let changed = false;
      const updated = events.map((evt) => {
        if (evt.eventType === 'coffee_logged' && evt.cupId === localCupId) {
          changed = true;
          return { ...evt, cupId: serverCupId };
        }
        return evt;
      });
      if (changed) {
        await this.repo.saveEvents(updated);
      }
    });
  }

  async onCoffeeRemoved(cup: CoffeeCup): Promise<void> {
    return this.enqueue(async () => {
      const nowMs = Date.now();
      const draft = await this.ensureDraftLoaded();
      if (
        draft &&
        draft.attempt.status === 'in_progress' &&
        draft.attempt.coffeeLoggedDuringRun > 0
      ) {
        const cupMs = Date.parse(cup.createdAt);
        const startMs = draft.attempt.startedAt ? Date.parse(draft.attempt.startedAt) : NaN;
        const events = await this.repo.getEvents();
        const loggedDuringThisAttempt = events.some(
          (e) =>
            e.eventType === 'coffee_logged' &&
            e.cupId === cup.id &&
            e.attemptId === draft.attempt.attemptId
        );
        const createdDuringDraft =
          !Number.isNaN(cupMs) &&
          !Number.isNaN(startMs) &&
          cupMs >= startMs &&
          (draft.currentPauseStartMs !== null ||
            draft.targetEndTimeMs === null ||
            cupMs <= draft.targetEndTimeMs + 60_000);

        if (loggedDuringThisAttempt || createdDuringDraft) {
          const nextDraft: ActiveAttemptDraft = {
            ...draft,
            attempt: {
              ...draft.attempt,
              coffeeLoggedDuringRun: Math.max(0, draft.attempt.coffeeLoggedDuringRun - 1),
              updatedAtMs: nowMs,
            },
          };
          this.activeDraft = nextDraft;
          await this.repo.saveActiveDraft(nextDraft);
          await this.repo.upsertAttempt(nextDraft.attempt);
          this.pushAttemptToCloud(nextDraft.attempt);
        }
      }

      const evt: MlEvent = {
        ...buildBaseTelemetryEvent('coffee_removed', nowMs),
        tagId: toNullableTelemetryId(cup.tagId),
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
        ...buildBaseTelemetryEvent('settings_changed', nowMs),
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
        ...buildBaseTelemetryEvent('daily_goal_changed', nowMs),
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

  private async finalizeDraftStaleInternal(
    draft: ActiveAttemptDraft,
    nowMs: number
  ): Promise<void> {
    const finalizedAttempt = finalizeStaleAttemptDraft(draft, nowMs);
    this.activeDraft = null;
    this.draftLoaded = true;
    await this.repo.saveActiveDraft(null);
    await this.repo.upsertAttempt(finalizedAttempt);
    this.pushAttemptToCloud(finalizedAttempt);
  }

  async finalizeOrphanedDraftIfStale(): Promise<void> {
    return this.enqueue(async () => {
      const draft = await this.ensureDraftLoaded();
      if (!draft || draft.attempt.status !== 'in_progress') return;
      await this.finalizeDraftStaleInternal(draft, Date.now());
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
