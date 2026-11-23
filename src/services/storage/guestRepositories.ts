import { CompletedSession } from '../../types/session';
import { CoffeeCup } from '../../types/coffee';
import { Tag, CreateTagInput, UpdateTagInput, DEFAULT_TAGS } from '../../types/tag';
import { UserSettings, DEFAULT_SETTINGS } from '../../types/settings';
import { UserProfile, DEFAULT_PROFILE } from '../../types/user';
import { SessionAttempt } from '../../types/telemetry';
import { IStorageService } from './IStorageService';
import { toDateKey } from '../../utils/dates';
import { sanitizeHexColor } from '../../utils/colors';

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const MAX_TAG_NAME_LENGTH = 50;
const MAX_TAGS_LIMIT = 100;
const MAX_LOCAL_ATTEMPTS = 5000;
const MAX_PAUSE_INTERVALS = 50;

export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_AVATAR_EMOJI_LENGTH = 32;

export function sanitizeProfile(raw: Partial<UserProfile> | null | undefined): UserProfile {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROFILE };
  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
      : DEFAULT_PROFILE.displayName;
  const avatarUrl =
    typeof raw.avatarUrl === 'string' && raw.avatarUrl.trim().startsWith('https://')
      ? raw.avatarUrl.trim()
      : undefined;
  const rawDaily = Number(raw.dailyGoalMinutes);
  const dailyGoalMinutes =
    !isNaN(rawDaily) && rawDaily > 0
      ? Math.max(1, Math.min(1440, Math.floor(rawDaily)))
      : DEFAULT_PROFILE.dailyGoalMinutes;
  const avatarEmoji =
    typeof raw.avatarEmoji === 'string'
      ? raw.avatarEmoji.trim().slice(0, MAX_AVATAR_EMOJI_LENGTH)
      : DEFAULT_PROFILE.avatarEmoji;
  const createdAt =
    typeof raw.createdAt === 'string' && !isNaN(new Date(raw.createdAt).getTime())
      ? raw.createdAt
      : DEFAULT_PROFILE.createdAt;

  return {
    displayName,
    avatarUrl,
    dailyGoalMinutes,
    avatarEmoji,
    createdAt,
    id: typeof raw.id === 'string' ? raw.id : undefined,
    email: typeof raw.email === 'string' ? raw.email : undefined,
  };
}

abstract class QueuedRepository {
  protected storage: IStorageService;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(storage: IStorageService) {
    this.storage = storage;
  }

  protected enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }
}

export class SessionRepository extends QueuedRepository {
  private static readonly KEY = 'sessions_v1';

  async getAll(): Promise<CompletedSession[]> {
    const raw = this.storage.getItem<CompletedSession[]>(SessionRepository.KEY, []);
    return Array.isArray(raw) ? raw : [];
  }

  async add(session: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const sessionId =
        session.id || `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const existing = all.find(
        (s) => s.id === sessionId || (Boolean(session.timerRunId) && s.timerRunId === session.timerRunId)
      );
      if (existing) return existing;
      const created: CompletedSession = { ...session, id: sessionId };
      all.push(created);
      this.storage.setItem(SessionRepository.KEY, all);
      return created;
    });
  }

  async saveAll(sessions: CompletedSession[]): Promise<void> {
    return this.enqueue(async () => {
      this.storage.setItem(SessionRepository.KEY, Array.isArray(sessions) ? sessions : []);
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => this.storage.setItem(SessionRepository.KEY, []));
  }
}

export class CoffeeRepository extends QueuedRepository {
  private static readonly KEY = 'coffee_cups_v1';

  async getAll(): Promise<CoffeeCup[]> {
    const raw = this.storage.getItem<CoffeeCup[]>(CoffeeRepository.KEY, []);
    const list = Array.isArray(raw) ? raw : [];
    let needsMigration = !Array.isArray(raw);
    const sanitized = list
      .map((c) => {
        let date = c.date;
        if (!date) {
          needsMigration = true;
          date = c.createdAt ? toDateKey(c.createdAt) : toDateKey(new Date());
        } else if (date.length > 10) {
          needsMigration = true;
          date = toDateKey(date);
        }
        const tagId = c.tagId || null;
        if (c.tagId !== tagId) needsMigration = true;
        return { ...c, date, tagId, createdAt: c.createdAt || new Date().toISOString() };
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (needsMigration) this.storage.setItem(CoffeeRepository.KEY, sanitized);
    return sanitized;
  }

  async addCup(date: string, tagId: string | null = null): Promise<CoffeeCup> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const newCup: CoffeeCup = {
        id: `coffee-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        date,
        tagId: tagId || null,
        createdAt: new Date().toISOString(),
      };
      all.push(newCup);
      all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      this.storage.setItem(CoffeeRepository.KEY, all);
      return newCup;
    });
  }

  async removeCup(date: string, tagId?: string | null, cupId?: string): Promise<CoffeeCup | null> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      let idx = cupId ? all.findIndex((c) => c.id === cupId) : -1;
      if (idx < 0) {
        for (let i = all.length - 1; i >= 0; i--) {
          if (all[i].date === date && (tagId === undefined || (all[i].tagId || null) === (tagId || null))) {
            idx = i;
            break;
          }
        }
      }
      if (idx < 0) return null;
      const [removed] = all.splice(idx, 1);
      this.storage.setItem(CoffeeRepository.KEY, all);
      return removed;
    });
  }

  async saveAll(cups: CoffeeCup[]): Promise<void> {
    return this.enqueue(async () => {
      const sorted = [...cups].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      this.storage.setItem(CoffeeRepository.KEY, sorted);
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => this.storage.setItem(CoffeeRepository.KEY, []));
  }
}

export class TagRepository extends QueuedRepository {
  private static readonly KEY = 'tags_v1';

  constructor(storage: IStorageService) {
    super(storage);
    if (this.storage.getItem<Tag[] | null>(TagRepository.KEY, null) === null) {
      this.storage.setItem(TagRepository.KEY, DEFAULT_TAGS);
    }
  }

  async getAll(): Promise<Tag[]> {
    const raw = this.storage.getItem<Tag[]>(TagRepository.KEY, []);
    let needsMigration = false;
    const tags = (Array.isArray(raw) ? raw : []).map((t) => {
      const isArchived = Boolean(t.isArchived);
      const updatedAt = t.updatedAt || t.createdAt || EPOCH_ISO;
      const safeColor = sanitizeHexColor(t.color);
      const safeName = typeof t.name === 'string' ? t.name.trim().slice(0, MAX_TAG_NAME_LENGTH) : 'Tag';
      if (t.isArchived !== isArchived || !t.updatedAt || t.color !== safeColor || t.name !== safeName) {
        needsMigration = true;
      }
      return { ...t, name: safeName, color: safeColor, isArchived, updatedAt };
    });
    if (needsMigration) this.storage.setItem(TagRepository.KEY, tags);
    return tags;
  }

  async create(input: CreateTagInput): Promise<Tag> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      if (all.length >= MAX_TAGS_LIMIT) throw new Error(`Maximum limit of ${MAX_TAGS_LIMIT} tags reached.`);
      const trimmedName = input.name.trim().slice(0, MAX_TAG_NAME_LENGTH);
      if (!trimmedName) throw new Error('Tag name cannot be empty.');
      const nowIso = new Date().toISOString();
      const newTag: Tag = {
        id: `tag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: trimmedName,
        color: sanitizeHexColor(input.color, '#7E57C2'),
        isArchived: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      all.push(newTag);
      this.storage.setItem(TagRepository.KEY, all);
      return newTag;
    });
  }

  async update(id: string, updates: UpdateTagInput): Promise<Tag | null> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const index = all.findIndex((tag) => tag.id === id);
      if (index === -1) return null;
      const updatedName =
        updates.name !== undefined ? updates.name.trim().slice(0, MAX_TAG_NAME_LENGTH) : all[index].name;
      if (updates.name !== undefined && !updatedName) throw new Error('Tag name cannot be empty.');
      const updated: Tag = {
        ...all[index],
        ...updates,
        name: updatedName,
        color: updates.color !== undefined ? sanitizeHexColor(updates.color, all[index].color) : all[index].color,
        updatedAt: updates.updatedAt || new Date().toISOString(),
      };
      all[index] = updated;
      this.storage.setItem(TagRepository.KEY, all);
      return updated;
    });
  }

  archive = (id: string) => this.update(id, { isArchived: true, updatedAt: new Date().toISOString() });
  unarchive = (id: string) => this.update(id, { isArchived: false, updatedAt: new Date().toISOString() });

  async delete(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const filtered = all.filter((tag) => tag.id !== id);
      if (filtered.length === all.length) return false;
      this.storage.setItem(TagRepository.KEY, filtered);
      return true;
    });
  }

  async saveAll(tags: Tag[]): Promise<void> {
    return this.enqueue(async () => {
      const safeList = (Array.isArray(tags) ? tags : []).slice(0, MAX_TAGS_LIMIT).map((t) => ({
        ...t,
        name: typeof t.name === 'string' ? t.name.trim().slice(0, MAX_TAG_NAME_LENGTH) || 'Tag' : 'Tag',
        color: sanitizeHexColor(t.color),
        isArchived: Boolean(t.isArchived),
        updatedAt: t.updatedAt || t.createdAt || EPOCH_ISO,
      }));
      this.storage.setItem(TagRepository.KEY, safeList);
    });
  }

  async resetToDefaults(): Promise<Tag[]> {
    return this.enqueue(async () => {
      const nowIso = new Date().toISOString();
      const fresh = DEFAULT_TAGS.map((t) => ({ ...t, updatedAt: nowIso }));
      this.storage.setItem(TagRepository.KEY, fresh);
      return fresh;
    });
  }
}

const clampDuration = (val: unknown, fallback: number, max: number) =>
  typeof val === 'number' && Number.isFinite(val) && val > 0
    ? Math.max(0.01, Math.min(max, Math.round(val * 100) / 100))
    : fallback;

export class SettingsRepository {
  private static readonly KEY = 'settings_v1';
  constructor(private storage: IStorageService) {}

  private sanitize(saved: Partial<UserSettings> | null): UserSettings {
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_SETTINGS };
    const m: UserSettings = { ...DEFAULT_SETTINGS, ...saved };
    return {
      ...m,
      workDurationMinutes: clampDuration(m.workDurationMinutes, DEFAULT_SETTINGS.workDurationMinutes, 360),
      shortBreakDurationMinutes: clampDuration(m.shortBreakDurationMinutes, DEFAULT_SETTINGS.shortBreakDurationMinutes, 120),
      longBreakDurationMinutes: clampDuration(m.longBreakDurationMinutes, DEFAULT_SETTINGS.longBreakDurationMinutes, 180),
      longBreakInterval:
        typeof m.longBreakInterval === 'number' && Number.isFinite(m.longBreakInterval) && m.longBreakInterval >= 1
          ? Math.max(1, Math.min(20, Math.floor(m.longBreakInterval)))
          : DEFAULT_SETTINGS.longBreakInterval,
      soundVolume:
        typeof m.soundVolume === 'number' && Number.isFinite(m.soundVolume)
          ? Math.max(0, Math.min(1, m.soundVolume))
          : DEFAULT_SETTINGS.soundVolume,
      soundEnabled: typeof m.soundEnabled === 'boolean' ? m.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
      notificationsEnabled: typeof m.notificationsEnabled === 'boolean' ? m.notificationsEnabled : DEFAULT_SETTINGS.notificationsEnabled,
      autoStartBreaks: typeof m.autoStartBreaks === 'boolean' ? m.autoStartBreaks : DEFAULT_SETTINGS.autoStartBreaks,
      autoStartPomodoros: typeof m.autoStartPomodoros === 'boolean' ? m.autoStartPomodoros : DEFAULT_SETTINGS.autoStartPomodoros,
      keepAwake: typeof m.keepAwake === 'boolean' ? m.keepAwake : DEFAULT_SETTINGS.keepAwake,
    };
  }

  getSync(): UserSettings {
    return this.sanitize(this.storage.getItem<Partial<UserSettings> | null>(SettingsRepository.KEY, null));
  }
  async get(): Promise<UserSettings> {
    return this.getSync();
  }
  async save(settings: UserSettings): Promise<void> {
    this.storage.setItem(SettingsRepository.KEY, this.sanitize(settings));
  }
  async resetToDefaults(): Promise<UserSettings> {
    this.storage.setItem(SettingsRepository.KEY, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
}

export class ProfileRepository {
  private static readonly KEY = 'profile_v1';
  constructor(private storage: IStorageService) {}

  async get(): Promise<UserProfile> {
    return sanitizeProfile(this.storage.getItem<Partial<UserProfile> | null>(ProfileRepository.KEY, null));
  }
  async save(profile: UserProfile): Promise<void> {
    this.storage.setItem(ProfileRepository.KEY, sanitizeProfile(profile));
  }
  async resetToDefaults(): Promise<UserProfile> {
    this.storage.setItem(ProfileRepository.KEY, DEFAULT_PROFILE);
    return { ...DEFAULT_PROFILE };
  }
}

export class TelemetryRepository extends QueuedRepository {
  private static readonly KEY = 'ml_attempts_v1';

  private safeSetArray(items: SessionAttempt[]): void {
    const trimmed = items.length > MAX_LOCAL_ATTEMPTS ? items.slice(items.length - MAX_LOCAL_ATTEMPTS) : items;
    try {
      this.storage.setItem(TelemetryRepository.KEY, trimmed, { throwOnQuotaError: true });
    } catch {
      try {
        this.storage.setItem(TelemetryRepository.KEY, trimmed.slice(Math.floor(trimmed.length * 0.25)), {
          throwOnQuotaError: true,
        });
      } catch {
        // Ignore storage errors silently so UI is never disrupted
      }
    }
  }

  getAttemptsSync(): SessionAttempt[] {
    const raw = this.storage.getItem<SessionAttempt[]>(TelemetryRepository.KEY, []);
    return Array.isArray(raw) ? raw : [];
  }

  async getAttempts(): Promise<SessionAttempt[]> {
    return this.getAttemptsSync();
  }

  async upsertAttempt(attempt: SessionAttempt): Promise<SessionAttempt> {
    return this.enqueue(async () => {
      const all = this.getAttemptsSync();
      const sanitized: SessionAttempt = {
        ...attempt,
        pauseIntervals: attempt.pauseIntervals.slice(0, MAX_PAUSE_INTERVALS),
      };
      const idx = all.findIndex((a) => a.attemptId === sanitized.attemptId);
      if (idx >= 0) {
        const existing = all[idx];
        const upgradesStale =
          existing.status === 'abandoned_stale' && sanitized.status !== 'abandoned_stale';
        if (
          (existing.status === 'completed' && sanitized.status !== 'completed') ||
          (!upgradesStale && sanitized.updatedAtMs < existing.updatedAtMs)
        ) {
          return existing;
        }
        all[idx] = sanitized;
      } else {
        all.push(sanitized);
      }
      this.safeSetArray(all);
      return sanitized;
    });
  }

  async saveAttempts(attempts: SessionAttempt[]): Promise<void> {
    return this.enqueue(async () => this.safeSetArray(attempts));
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => this.safeSetArray([]));
  }
}
