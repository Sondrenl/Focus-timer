import { CompletedSession } from '../../types/session';
import { IStorageService } from '../storage/IStorageService';
import { isProduction } from '../../utils/environment';
import { generateSampleSessions } from '../../utils/sampleData';

export function isSampleSessionId(id?: string | null): boolean {
  return Boolean(
    id &&
      (id.startsWith('seed-session-') ||
        id.startsWith('sample-session-') ||
        id.startsWith('sample-') ||
        id.startsWith('seed-'))
  );
}

export interface ISessionRepository {
  getAll(): Promise<CompletedSession[]>;
  add(session: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession>;
  saveAll(sessions: CompletedSession[]): Promise<void>;
  loadSampleData(): Promise<CompletedSession[]>;
  purgeSampleSessions(): Promise<CompletedSession[]>;
  clear(): Promise<void>;
}

const SESSIONS_STORAGE_KEY = 'sessions_v1';

/**
 * Implementation of ISessionRepository backed by IStorageService.
 * Seeds sample data ONLY in non-production (dev/preview) builds when storage is uninitialized,
 * and strictly purges sample data in production or when a real user account signs in.
 */
export class SessionRepository implements ISessionRepository {
  private storage: IStorageService;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(storage: IStorageService) {
    this.storage = storage;
    this.initSessions();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  private initSessions(): void {
    const existing = this.storage.getItem<CompletedSession[] | null>(SESSIONS_STORAGE_KEY, null);

    if (isProduction()) {
      // Production: strictly purge any sample or seed sessions
      if (existing && Array.isArray(existing)) {
        const clean = existing.filter((s) => !isSampleSessionId(s.id));
        if (clean.length !== existing.length) {
          this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
        }
      }
      return;
    }

    // Dev / Preview: seed initial sample sessions if storage has never been initialized
    if (existing === null) {
      const samples = generateSampleSessions();
      this.storage.setItem(SESSIONS_STORAGE_KEY, samples);
    }
  }

  async getAll(): Promise<CompletedSession[]> {
    const sessions = this.storage.getItem<CompletedSession[]>(SESSIONS_STORAGE_KEY, []);
    if (isProduction()) {
      const clean = sessions.filter((s) => !isSampleSessionId(s.id));
      if (clean.length !== sessions.length) {
        this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
      }
      return clean;
    }
    return sessions;
  }

  async add(session: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const sessionId =
        session.id || `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const existing = all.find((s) => s.id === sessionId);
      if (existing) return existing;
      const newSession: CompletedSession = {
        ...session,
        id: sessionId,
      };
      all.push(newSession);
      this.storage.setItem(SESSIONS_STORAGE_KEY, all);
      return newSession;
    });
  }

  async saveAll(sessions: CompletedSession[]): Promise<void> {
    return this.enqueue(async () => {
      const toSave = isProduction()
        ? sessions.filter((s) => !isSampleSessionId(s.id))
        : sessions;
      this.storage.setItem(SESSIONS_STORAGE_KEY, toSave);
    });
  }

  async loadSampleData(): Promise<CompletedSession[]> {
    if (isProduction()) {
      return [];
    }
    return this.enqueue(async () => {
      const existing = this.storage.getItem<CompletedSession[]>(SESSIONS_STORAGE_KEY, []);
      const realSessions = existing.filter((s) => !isSampleSessionId(s.id));
      const samples = generateSampleSessions();
      const merged = [...realSessions, ...samples].sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      );
      this.storage.setItem(SESSIONS_STORAGE_KEY, merged);
      return merged;
    });
  }

  async purgeSampleSessions(): Promise<CompletedSession[]> {
    return this.enqueue(async () => {
      const existing = this.storage.getItem<CompletedSession[]>(SESSIONS_STORAGE_KEY, []);
      const clean = existing.filter((s) => !isSampleSessionId(s.id));
      if (clean.length !== existing.length) {
        this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
      }
      return clean;
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      this.storage.setItem(SESSIONS_STORAGE_KEY, []);
    });
  }
}
