import { ISessionRepository } from './ISessionRepository';
import { CompletedSession } from '../../types/session';
import { IStorageService } from '../storage/IStorageService';

const SESSIONS_STORAGE_KEY = 'sessions_v1';

/**
 * Implementation of ISessionRepository backed by IStorageService.
 * Production mode: Starts clean with no mock or sample sessions.
 */
export class SessionRepository implements ISessionRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
    this.purgeLegacySeedSessions();
  }

  /**
   * Automatically strips any mock seed sessions that may have been saved
   * during development / earlier builds in the user's browser localStorage.
   */
  private purgeLegacySeedSessions(): void {
    const existing = this.storage.getItem<CompletedSession[] | null>(SESSIONS_STORAGE_KEY, null);
    if (existing && Array.isArray(existing)) {
      const clean = existing.filter((s) => !s.id.startsWith('seed-session-'));
      if (clean.length !== existing.length) {
        this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
      }
    }
  }

  async getAll(): Promise<CompletedSession[]> {
    const sessions = this.storage.getItem<CompletedSession[]>(SESSIONS_STORAGE_KEY, []);
    const clean = sessions.filter((s) => !s.id.startsWith('seed-session-'));
    if (clean.length !== sessions.length) {
      this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
    }
    return clean;
  }

  async add(session: Omit<CompletedSession, 'id'>): Promise<CompletedSession> {
    const all = await this.getAll();
    const newSession: CompletedSession = {
      ...session,
      id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
    all.push(newSession);
    this.storage.setItem(SESSIONS_STORAGE_KEY, all);
    return newSession;
  }

  async clear(): Promise<void> {
    this.storage.setItem(SESSIONS_STORAGE_KEY, []);
  }
}
