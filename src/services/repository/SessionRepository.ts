import { ISessionRepository } from './ISessionRepository';
import { CompletedSession } from '../../types/session';
import { IStorageService } from '../storage/IStorageService';

const SESSIONS_STORAGE_KEY = 'sessions_v1';

/**
 * Implementation of ISessionRepository backed by IStorageService.
 * Clean, production-ready storage that never auto-seeds sample or mock data.
 */
export class SessionRepository implements ISessionRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
    this.initSessions();
  }

  private initSessions(): void {
    // Purge any legacy sample or seed sessions from local storage
    const existing = this.storage.getItem<CompletedSession[] | null>(SESSIONS_STORAGE_KEY, null);
    if (existing && Array.isArray(existing)) {
      const clean = existing.filter(
        (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')
      );
      if (clean.length !== existing.length) {
        this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
      }
    }
  }

  async getAll(): Promise<CompletedSession[]> {
    const sessions = this.storage.getItem<CompletedSession[]>(SESSIONS_STORAGE_KEY, []);
    const clean = sessions.filter(
      (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')
    );
    if (clean.length !== sessions.length) {
      this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
    }
    return clean;
  }

  async add(session: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> {
    const all = await this.getAll();
    const sessionId = session.id || `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const existing = all.find((s) => s.id === sessionId);
    if (existing) return existing;
    const newSession: CompletedSession = {
      ...session,
      id: sessionId,
    };
    all.push(newSession);
    this.storage.setItem(SESSIONS_STORAGE_KEY, all);
    return newSession;
  }

  async saveAll(sessions: CompletedSession[]): Promise<void> {
    const clean = sessions.filter(
      (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')
    );
    this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
  }

  async loadSampleData(): Promise<CompletedSession[]> {
    return [];
  }

  async clear(): Promise<void> {
    this.storage.setItem(SESSIONS_STORAGE_KEY, []);
  }
}
