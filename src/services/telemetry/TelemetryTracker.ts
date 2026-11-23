import {
  AttemptOutcome,
  MlTelemetryExport,
  SessionAttempt,
} from '../../types/telemetry';
import { SessionType } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { TelemetryRepository } from '../storage/guestRepositories';
import { getMinimumAbortTelemetrySeconds } from '../../utils/telemetryContext';
import {
  ActiveAttemptDraft,
  createInitialAttemptDraft,
  finalizeAttemptFromDraft,
  generateTelemetryId,
  pauseAttemptDraft,
  resumeAttemptDraft,
  synthesizeRemoteAttempt,
  toNullableTelemetryId,
} from './telemetryBuilders';

export interface TelemetryCloudSink {
  upsertAttempt: (attempt: SessionAttempt) => Promise<unknown>;
}

/**
 * Lean write-only-on-finalize ML telemetry tracker.
 * Tracks active run metadata strictly in memory and writes one finalized row
 * to local storage / Convex when a session completes or aborts.
 */
export class TelemetryTracker {
  private repo: TelemetryRepository;
  private cloudSink: TelemetryCloudSink | null = null;
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

  private pushAttemptToCloud(attempt: SessionAttempt): void {
    if (!this.cloudSink) return;
    this.cloudSink.upsertAttempt(attempt).catch((err) => {
      console.warn('[Telemetry] Failed to sync attempt to cloud:', err);
    });
  }

  invalidateDraftCache(): void {
    this.activeDraft = null;
  }

  async discardInProgressAttempt(attemptId: string): Promise<void> {
    if (this.activeDraft?.attempt.attemptId === attemptId) {
      this.activeDraft = null;
    }
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
    targetEndTimeMs: number | null;
    nowMs?: number;
  }): Promise<void> {
    const nowMs = params.nowMs ?? Date.now();
    if (this.activeDraft?.attempt.attemptId === params.attemptId) {
      if (this.activeDraft.currentPauseStartMs !== null) {
        this.activeDraft = resumeAttemptDraft(this.activeDraft, nowMs, params.targetEndTimeMs);
      }
      return;
    }
    this.activeDraft = createInitialAttemptDraft({ ...params, nowMs });
  }

  async onSessionPaused(params: {
    remainingSeconds: number;
    tagId?: string | null;
    nowMs?: number;
  }): Promise<void> {
    if (!this.activeDraft || this.activeDraft.currentPauseStartMs !== null) return;
    this.activeDraft = pauseAttemptDraft(this.activeDraft, {
      remainingSeconds: params.remainingSeconds,
      tagId: params.tagId,
      nowMs: params.nowMs ?? Date.now(),
    });
  }

  async onSessionResumed(params: {
    targetEndTimeMs: number | null;
    nowMs?: number;
  }): Promise<void> {
    if (!this.activeDraft || this.activeDraft.currentPauseStartMs === null) return;
    this.activeDraft = resumeAttemptDraft(
      this.activeDraft,
      params.nowMs ?? Date.now(),
      params.targetEndTimeMs
    );
  }

  async onTabVisibilityChanged(isHidden: boolean): Promise<void> {
    if (!isHidden || !this.activeDraft || this.activeDraft.activeSegmentStartMs === null) return;
    this.activeDraft = {
      ...this.activeDraft,
      attempt: {
        ...this.activeDraft.attempt,
        tabBackgroundedCount: this.activeDraft.attempt.tabBackgroundedCount + 1,
        updatedAtMs: Date.now(),
      },
    };
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
    wasStarted: boolean;
    targetEndTimeMs?: number | null;
    nowMs?: number;
  }): Promise<void> {
    if (!params.wasStarted) return;
    return this.enqueue(async () => {
      const nowMs = params.nowMs ?? Date.now();
      const draft = this.activeDraft;
      const draftMatches =
        Boolean(draft) && (!params.attemptId || draft!.attempt.attemptId === params.attemptId);
      this.activeDraft = null;

      const resolvedAttemptId =
        params.attemptId ||
        (draftMatches ? draft!.attempt.attemptId : null) ||
        generateTelemetryId('att');

      const cleanTagId = toNullableTelemetryId(params.tagId);
      const plannedSec = Math.max(1, Math.round(params.plannedDurationSeconds));
      const remainingSec = Math.max(0, Math.round(params.remainingSecondsAtEnd));

      const finalizedAttempt =
        draftMatches && draft
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
              targetEndTimeMs: params.targetEndTimeMs,
              nowMs,
            });

      const isAbortOutcome =
        params.outcome === 'skipped' ||
        params.outcome === 'reset' ||
        params.outcome === 'switched';
      if (isAbortOutcome && finalizedAttempt.actualActiveSeconds < getMinimumAbortTelemetrySeconds(plannedSec)) {
        return;
      }

      await this.repo.upsertAttempt(finalizedAttempt);
      this.pushAttemptToCloud(finalizedAttempt);
    });
  }

  getExportDataSync(): MlTelemetryExport {
    return {
      schemaVersion: 1,
      sessionAttempts: this.repo.getAttemptsSync(),
    };
  }

  async getExportData(): Promise<MlTelemetryExport> {
    return this.enqueue(async () => ({
      schemaVersion: 1,
      sessionAttempts: await this.repo.getAttempts(),
    }));
  }

  async clearAll(): Promise<void> {
    return this.enqueue(async () => {
      this.activeDraft = null;
      await this.repo.clear();
    });
  }
}
