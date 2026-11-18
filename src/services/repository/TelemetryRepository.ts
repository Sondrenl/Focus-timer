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
      this.storage.setItem(key, trimmed);
    } catch {
      // Fallback: trim oldest 25% if storage quota is tight
      try {
        const reduced = trimmed.slice(Math.floor(trimmed.length * 0.25));
        this.storage.setItem(key, reduced);
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
        if (existingFinalized && incomingInProgress) {
          return existing;
        }
        if (
          existingFinalized &&
          sanitizedAttempt.status !== 'in_progress' &&
          sanitizedAttempt.updatedAtMs < existing.updatedAtMs
        ) {
          return existing;
        }
        all[idx] = sanitizedAttempt;
      } else {
        all.push(sanitizedAttempt);
      }
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
        this.storage.setItem(ACTIVE_DRAFT_STORAGE_KEY, draft);
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
        this.storage.setItem(ACTIVE_DRAFT_STORAGE_KEY, {
          ...draft,
          attempt: {
            ...draft.attempt,
            tagId: draft.attempt.tagId === tagId ? null : draft.attempt.tagId,
            initialTagId:
              draft.attempt.initialTagId === tagId ? null : draft.attempt.initialTagId,
          },
        });
      }
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      this.storage.setItem(ATTEMPTS_STORAGE_KEY, []);
      this.storage.setItem(EVENTS_STORAGE_KEY, []);
      this.storage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
    });
  }
}

export type { AttemptOutcome, PauseInterval };
