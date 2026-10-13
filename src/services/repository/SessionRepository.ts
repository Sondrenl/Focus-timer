import { ISessionRepository } from './ISessionRepository';
import { CompletedSession } from '../../types/session';
import { IStorageService } from '../storage/IStorageService';

const SESSIONS_STORAGE_KEY = 'sessions_v1';

/**
 * Generate sample sessions over the past 5 days for initial visualization
 */
function generateSeedSessions(): CompletedSession[] {
  const sessions: CompletedSession[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const sampleData = [
    // 4 days ago
    { daysAgo: 4, tagId: 'tag-deep-work', duration: 25 * 60, count: 3 },
    { daysAgo: 4, tagId: 'tag-coding', duration: 25 * 60, count: 2 },
    // 3 days ago
    { daysAgo: 3, tagId: 'tag-study', duration: 25 * 60, count: 4 },
    { daysAgo: 3, tagId: 'tag-writing', duration: 25 * 60, count: 1 },
    // 2 days ago
    { daysAgo: 2, tagId: 'tag-coding', duration: 25 * 60, count: 5 },
    { daysAgo: 2, tagId: 'tag-deep-work', duration: 25 * 60, count: 2 },
    // Yesterday
    { daysAgo: 1, tagId: 'tag-deep-work', duration: 25 * 60, count: 4 },
    { daysAgo: 1, tagId: 'tag-admin', duration: 25 * 60, count: 2 },
    // Today
    { daysAgo: 0, tagId: 'tag-deep-work', duration: 25 * 60, count: 2 },
    { daysAgo: 0, tagId: 'tag-coding', duration: 25 * 60, count: 1 },
  ];

  let idCounter = 1;
  sampleData.forEach(({ daysAgo, tagId, duration, count }) => {
    for (let i = 0; i < count; i++) {
      const timestamp = new Date(now - daysAgo * dayMs - i * 35 * 60 * 1000).toISOString();
      sessions.push({
        id: `seed-session-${idCounter++}`,
        tagId,
        sessionType: 'WORK',
        durationSeconds: duration,
        completedAt: timestamp,
      });
    }
  });

  return sessions;
}

/**
 * Implementation of ISessionRepository backed by IStorageService
 */
export class SessionRepository implements ISessionRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
    this.seedDefaultSessionsIfEmpty();
  }

  private seedDefaultSessionsIfEmpty(): void {
    const existing = this.storage.getItem<CompletedSession[] | null>(SESSIONS_STORAGE_KEY, null);
    if (!existing) {
      this.storage.setItem(SESSIONS_STORAGE_KEY, generateSeedSessions());
    }
  }

  async getAll(): Promise<CompletedSession[]> {
    return this.storage.getItem<CompletedSession[]>(SESSIONS_STORAGE_KEY, []);
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
