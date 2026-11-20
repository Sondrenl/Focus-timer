import {
  AttemptOutcome,
  MlEvent,
  PauseInterval,
  SessionAttempt,
} from '../../types/telemetry';
import { IStorageService } from '../storage/IStorageService';

const ATTEMPTS_STORAGE_KEY = 'ml_attempts_v1';
const EVENTS_STORAGE_KEY = 'ml_events_v1';
const ACTIVE_DRAFT_STORAGE_KEY = 'ml_active_draft_v1';

const MAX_LOCAL_ATTEMPTS = 5000;
const MAX_LOCAL_EVENTS = 10000;
const MAX_PAUSE_INTERVALS = 50;

export interface ActiveAttemptDraft {
  attempt: SessionAttempt;
  /** Wall-clock ms when the current uninterrupted running segment started (null when paused) */
  activeSegmentStartMs: number | null;
  /** Accumulated active milliseconds from prior completed running segments before current pause/segment */
  accumulatedActiveMs: number;
  /** Wall-clock ms when the current pause started (null when running) */
  currentPauseStartMs: number | null;
  /** Target end timestamp in ms when running (for completionLatencySeconds) */
  targetEndTimeMs: number | null;
}

export interface ITelemetryRepository {
  getAttempts(): Promise<SessionAttempt[]>;
  getEvents(): Promise<MlEvent[]>;
  upsertAttempt(attempt: SessionAttempt): Promise<SessionAttempt>;
  saveAttempts(attempts: SessionAttempt[]): Promise<void>;
  recordEvent(event: MlEvent): Promise<MlEvent>;
  recordEvents(events: MlEvent[]): Promise<MlEvent[]>;
  saveEvents(events: MlEvent[]): Promise<void>;
  getActiveDraft(): Promise<ActiveAttemptDraft | null>;
  saveActiveDraft(draft: ActiveAttemptDraft | null): Promise<void>;
  discardAttempt(attemptId: string): Promise<void>;
  clearTagReferences(tagId: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Cookie-free local repository for ML telemetry (session attempts & behavioral events).
 * Backed by IStorageService (localStorage with in-memory fallback).
 */
export class TelemetryRepository implements ITelemetryRepository {
  private storage: IStorageService;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(storage: IStorageService) {
    this.storage = storage;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  private safeSetArray<T>(key: string, items: T[], maxItems: number): void {
    const trimmed = items.length > maxItems ? items.slice(items.length - maxItems) : items;
    try {
      this.storage.setItem(key, trimmed, { throwOnQuotaError: true });
    } catch {
      // Fallback: trim oldest 25% if storage quota is tight
      try {
        const reduced = trimmed.slice(Math.floor(trimmed.length * 0.25));
        this.storage.setItem(key, reduced, { throwOnQuotaError: true });
      } catch {
        // Ignore storage errors silently so UI is never disrupted
      }
    }
  }

  getAttemptsSync(): SessionAttempt[] {
    const raw = this.storage.getItem<SessionAttempt[]>(ATTEMPTS_STORAGE_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw;
  }

  getEventsSync(): MlEvent[] {
    const raw = this.storage.getItem<MlEvent[]>(EVENTS_STORAGE_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw;
  }

  async getAttempts(): Promise<SessionAttempt[]> {
    return this.getAttemptsSync();
  }

  async getEvents(): Promise<MlEvent[]> {
    return this.getEventsSync();
  }

  async upsertAttempt(attempt: SessionAttempt): Promise<SessionAttempt> {
    return this.enqueue(async () => {
      const all = await this.getAttempts();
      const sanitizedAttempt: SessionAttempt = {
        ...attempt,
        pauseIntervals: attempt.pauseIntervals.slice(0, MAX_PAUSE_INTERVALS),
      };
      const idx = all.findIndex((a) => a.attemptId === sanitizedAttempt.attemptId);
      if (idx >= 0) {
        const existing = all[idx];
        const existingFinalized = existing.status !== 'in_progress';
        const incomingInProgress = sanitizedAttempt.status === 'in_progress';
        const completedProtected =
          existing.status === 'completed' && sanitizedAttempt.status !== 'completed';
        const staleCannotOverwriteFinalized =
          existingFinalized && sanitizedAttempt.status === 'abandoned_stale';
        const upgradesStaleToExplicit =
          existing.status === 'abandoned_stale' &&
          sanitizedAttempt.status !== 'in_progress' &&
          sanitizedAttempt.status !== 'abandoned_stale';

        if (
          (existingFinalized && incomingInProgress) ||
          completedProtected ||
          staleCannotOverwriteFinalized ||
          (existingFinalized &&
            !upgradesStaleToExplicit &&
            sanitizedAttempt.updatedAtMs < existing.updatedAtMs) ||
          (!existingFinalized &&
            incomingInProgress &&
            sanitizedAttempt.updatedAtMs < existing.updatedAtMs)
        ) {
          return existing;
        }

        const isSynthesizedSecondaryFinalization =
          !incomingInProgress &&
          ((existing.pauseCount > 0 && sanitizedAttempt.pauseCount === 0) ||
            (Boolean(existing.startedAt) &&
              existing.startedAt !== sanitizedAttempt.startedAt));

        let mergedAttempt = sanitizedAttempt;
        if (isSynthesizedSecondaryFinalization) {
          const resolvedInitialTagId = existing.initialTagId ?? sanitizedAttempt.initialTagId;
          const resolvedTagId = sanitizedAttempt.tagId ?? existing.tagId;
          mergedAttempt = {
            ...sanitizedAttempt,
            startedAt: existing.startedAt ?? sanitizedAttempt.startedAt,
            utcOffsetMinutes: existing.utcOffsetMinutes,
            ianaTimezone: existing.ianaTimezone ?? sanitizedAttempt.ianaTimezone,
            localDate: existing.localDate,
            localHour: existing.localHour,
            localMinuteOfDay: existing.localMinuteOfDay,
            localDayOfWeek: existing.localDayOfWeek,
            cycleIndex: existing.cycleIndex,
            longBreakInterval: existing.longBreakInterval,
            autoStarted: existing.autoStarted || sanitizedAttempt.autoStarted,
            initialTagId: resolvedInitialTagId,
            tagId: resolvedTagId,
            tagChangedMidRun:
              existing.tagChangedMidRun ||
              sanitizedAttempt.tagChangedMidRun ||
              (resolvedInitialTagId ?? null) !== (resolvedTagId ?? null),
            pauseCount: Math.max(existing.pauseCount, sanitizedAttempt.pauseCount),
            totalPausedSeconds: Math.max(
              existing.totalPausedSeconds,
              sanitizedAttempt.totalPausedSeconds
            ),
            pauseIntervals:
              sanitizedAttempt.pauseIntervals.length >= existing.pauseIntervals.length
                ? sanitizedAttempt.pauseIntervals
                : existing.pauseIntervals,
            timeSincePreviousAttemptSeconds:
              existing.timeSincePreviousAttemptSeconds ??
              sanitizedAttempt.timeSincePreviousAttemptSeconds,
            previousAttemptType:
              existing.previousAttemptType ?? sanitizedAttempt.previousAttemptType,
            previousAttemptOutcome:
              existing.previousAttemptOutcome ?? sanitizedAttempt.previousAttemptOutcome,
            workSessionsCompletedToday: existing.workSessionsCompletedToday,
            workActiveSecondsToday: existing.workActiveSecondsToday,
            skipsToday: existing.skipsToday,
            coffeeCupsTodayAtStart: existing.coffeeCupsTodayAtStart,
            minutesSinceLastCoffeeAtStart:
              existing.minutesSinceLastCoffeeAtStart ??
              sanitizedAttempt.minutesSinceLastCoffeeAtStart,
            coffeeLoggedDuringRun: Math.max(
              existing.coffeeLoggedDuringRun,
              sanitizedAttempt.coffeeLoggedDuringRun
            ),
            dailyGoalMinutes: existing.dailyGoalMinutes,
            settingsSnapshot: existing.settingsSnapshot,
            deviceClass: existing.deviceClass,
            tabBackgroundedCount: Math.max(
              existing.tabBackgroundedCount,
              sanitizedAttempt.tabBackgroundedCount
            ),
          };
        }

        all[idx] = mergedAttempt;
        this.safeSetArray(ATTEMPTS_STORAGE_KEY, all, MAX_LOCAL_ATTEMPTS);
        return mergedAttempt;
      }

      all.push(sanitizedAttempt);
      this.safeSetArray(ATTEMPTS_STORAGE_KEY, all, MAX_LOCAL_ATTEMPTS);
      return sanitizedAttempt;
    });
  }

  async saveAttempts(attempts: SessionAttempt[]): Promise<void> {
    return this.enqueue(async () => {
      this.safeSetArray(ATTEMPTS_STORAGE_KEY, attempts, MAX_LOCAL_ATTEMPTS);
    });
  }

  async recordEvent(event: MlEvent): Promise<MlEvent> {
    const [saved] = await this.recordEvents([event]);
    return saved ?? event;
  }

  async recordEvents(events: MlEvent[]): Promise<MlEvent[]> {
    if (events.length === 0) return [];
    return this.enqueue(async () => {
      const all = await this.getEvents();
      const existingIds = new Set(all.map((e) => e.eventId));
      const inserted: MlEvent[] = [];

      for (const evt of events) {
        if (!existingIds.has(evt.eventId)) {
          existingIds.add(evt.eventId);
          all.push(evt);
          inserted.push(evt);
        }
      }

      if (inserted.length > 0) {
        all.sort((a, b) => a.timestampMs - b.timestampMs);
        this.safeSetArray(EVENTS_STORAGE_KEY, all, MAX_LOCAL_EVENTS);
      }
      return inserted;
    });
  }

  async saveEvents(events: MlEvent[]): Promise<void> {
    return this.enqueue(async () => {
      const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
      this.safeSetArray(EVENTS_STORAGE_KEY, sorted, MAX_LOCAL_EVENTS);
    });
  }

  async getActiveDraft(): Promise<ActiveAttemptDraft | null> {
    const draft = this.storage.getItem<ActiveAttemptDraft | null>(ACTIVE_DRAFT_STORAGE_KEY, null);
    if (!draft || typeof draft !== 'object' || !draft.attempt) return null;
    return draft;
  }

  async saveActiveDraft(draft: ActiveAttemptDraft | null): Promise<void> {
    return this.enqueue(async () => {
      if (!draft) {
        this.storage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
      } else {
        try {
          this.storage.setItem(ACTIVE_DRAFT_STORAGE_KEY, draft);
        } catch {
          // Ignore storage quota errors so telemetry queue continues safely
        }
      }
    });
  }

  async discardAttempt(attemptId: string): Promise<void> {
    return this.enqueue(async () => {
      const attempts = await this.getAttempts();
      const filteredAttempts = attempts.filter(
        (a) => !(a.attemptId === attemptId && a.status === 'in_progress')
      );
      if (filteredAttempts.length !== attempts.length) {
        this.safeSetArray(ATTEMPTS_STORAGE_KEY, filteredAttempts, MAX_LOCAL_ATTEMPTS);
      }

      const lifecycleTypes = new Set([
        'session_started',
        'session_paused',
        'session_resumed',
        'tag_changed',
      ]);
      const events = await this.getEvents();
      let eventsChanged = false;
      const cleanedEvents: MlEvent[] = [];
      for (const evt of events) {
        if (evt.attemptId === attemptId) {
          if (lifecycleTypes.has(evt.eventType)) {
            eventsChanged = true;
            continue;
          }
          if (evt.attemptId !== null) {
            eventsChanged = true;
            cleanedEvents.push({ ...evt, attemptId: null });
            continue;
          }
        }
        cleanedEvents.push(evt);
      }
      if (eventsChanged) {
        this.safeSetArray(EVENTS_STORAGE_KEY, cleanedEvents, MAX_LOCAL_EVENTS);
      }

      const draft = await this.getActiveDraft();
      if (draft?.attempt.attemptId === attemptId) {
        this.storage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
      }
    });
  }

  async clearTagReferences(tagId: string): Promise<void> {
    return this.enqueue(async () => {
      const attempts = await this.getAttempts();
      let attemptsChanged = false;
      const cleanedAttempts = attempts.map((a) => {
        if (a.tagId === tagId || a.initialTagId === tagId) {
          attemptsChanged = true;
          return {
            ...a,
            tagId: a.tagId === tagId ? null : a.tagId,
            initialTagId: a.initialTagId === tagId ? null : a.initialTagId,
          };
        }
        return a;
      });
      if (attemptsChanged) {
        this.safeSetArray(ATTEMPTS_STORAGE_KEY, cleanedAttempts, MAX_LOCAL_ATTEMPTS);
      }

      const draft = await this.getActiveDraft();
      if (draft && (draft.attempt.tagId === tagId || draft.attempt.initialTagId === tagId)) {
        try {
          this.storage.setItem(ACTIVE_DRAFT_STORAGE_KEY, {
            ...draft,
            attempt: {
              ...draft.attempt,
              tagId: draft.attempt.tagId === tagId ? null : draft.attempt.tagId,
              initialTagId:
                draft.attempt.initialTagId === tagId ? null : draft.attempt.initialTagId,
            },
          });
        } catch {
          // Ignore storage quota errors
        }
      }
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      this.safeSetArray(ATTEMPTS_STORAGE_KEY, [], MAX_LOCAL_ATTEMPTS);
      this.safeSetArray(EVENTS_STORAGE_KEY, [], MAX_LOCAL_EVENTS);
      this.storage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
    });
  }
}

export type { AttemptOutcome, PauseInterval };
