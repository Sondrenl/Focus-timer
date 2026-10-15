import { ISessionRepository } from './ISessionRepository';
import { CompletedSession } from '../../types/session';
import { IStorageService } from '../storage/IStorageService';
import { isProduction } from '../../utils/environment';
import { generateSampleSessions } from '../../utils/sampleData';

const SESSIONS_STORAGE_KEY = 'sessions_v1';

/**
 * Implementation of ISessionRepository backed by IStorageService.
 * - Production: Starts 100% clean with 0 mock sessions.
 * - Preview / Dev: Auto-seeds realistic sample sessions if empty for rich testing.
 */
export class SessionRepository implements ISessionRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
    this.initSessions();
  }

  private initSessions(): void {
    if (isProduction()) {
      // Production: Always purge mock or sample sessions
      const existing = this.storage.getItem<CompletedSession[] | null>(SESSIONS_STORAGE_KEY, null);
      if (existing && Array.isArray(existing)) {
        const clean = existing.filter(
          (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')
        );
        if (clean.length !== existing.length) {
          this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
        }
      }
    } else {
      // Preview / Development: Auto-seed sample sessions if empty or first launch
      const existing = this.storage.getItem<CompletedSession[] | null>(SESSIONS_STORAGE_KEY, null);
      if (!existing || existing.length === 0) {
        const sampleSessions = generateSampleSessions();
        this.storage.setItem(SESSIONS_STORAGE_KEY, sampleSessions);
      }
    }
  }

  async getAll(): Promise<CompletedSession[]> {
    const sessions = this.storage.getItem<CompletedSession[]>(SESSIONS_STORAGE_KEY, []);
    if (isProduction()) {
      const clean = sessions.filter(
        (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')
      );
      if (clean.length !== sessions.length) {
        this.storage.setItem(SESSIONS_STORAGE_KEY, clean);
      }
      return clean;
    }
    return sessions;
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

  async saveAll(sessions: CompletedSession[]): Promise<void> {
    this.storage.setItem(SESSIONS_STORAGE_KEY, sessions);
  }

  async loadSampleData(): Promise<CompletedSession[]> {
    const sample = generateSampleSessions();
    this.storage.setItem(SESSIONS_STORAGE_KEY, sample);
    return sample;
  }

  async clear(): Promise<void> {
    this.storage.setItem(SESSIONS_STORAGE_KEY, []);
  }
}
