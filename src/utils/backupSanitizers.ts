import { Tag } from '../types/tag';
import { CompletedSession } from '../types/session';
import { SessionType } from '../types/timer';
import { BackupData, UserProfile, ExportedProfile } from '../types/user';
import { CoffeeCup } from '../types/coffee';
import { UserSettings } from '../types/settings';
import { MlEvent, MlTelemetryExport, SessionAttempt } from '../types/telemetry';
import { isSampleSessionId } from '../services/repository/SessionRepository';
import { isProduction } from './environment';
import { sanitizeHexColor } from './colors';

export const TAG_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const ML_HYDRATED_DATE_PREFIX = 'ml_hydrated_date_v1_';

export function shiftDateDays(yyyyMmDd: string, deltaDays: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function readHydrationWatermark(userId: string): string | null {
  if (!userId || typeof localStorage === 'undefined') return null;
  try {
    const val = localStorage.getItem(`${ML_HYDRATED_DATE_PREFIX}${userId}`);
    return val && /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : null;
  } catch {
    return null;
  }
}

export function writeHydrationWatermark(userId: string, yyyyMmDd: string): void {
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd) || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(`${ML_HYDRATED_DATE_PREFIX}${userId}`, yyyyMmDd);
  } catch {
    // Ignore storage quota or disabled storage errors
  }
}

export function clearAllHydrationWatermarks(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ML_HYDRATED_DATE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore storage access errors
  }
}

/**
 * Sanitizes user profile for backup export, removing private identifiers and PII
 * (cloud user id, email, and non-custom account photo avatarUrl).
 * Only portable customization settings (displayName, avatarEmoji, dailyGoalMinutes) are exported.
 */
export function sanitizeProfileForExport(
  profile?: UserProfile | null
): ExportedProfile | undefined {
  if (!profile) return undefined;
  return {
    displayName: profile.displayName,
    avatarEmoji: profile.avatarEmoji,
    dailyGoalMinutes: profile.dailyGoalMinutes,
  };
}

export function sanitizeMlTelemetryForImport(
  raw: unknown,
  resolveTagId: (rawTagId?: string | null) => string | null
): MlTelemetryExport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const rawAttempts = Array.isArray(obj.sessionAttempts) ? obj.sessionAttempts : [];
  const rawEvents = Array.isArray(obj.events) ? obj.events : [];

  const validSessionTypes = new Set(['WORK', 'SHORT_BREAK', 'LONG_BREAK']);
  const validStatuses = new Set([
    'in_progress',
    'completed',
    'skipped',
    'reset',
    'switched',
    'abandoned_stale',
  ]);

  const sessionAttempts: SessionAttempt[] = rawAttempts
    .filter((a: any) => {
      if (!a || typeof a !== 'object') return false;
      if (isSampleSessionId(a.attemptId)) return false;
      return (
        typeof a.attemptId === 'string' &&
        a.attemptId.length > 0 &&
        validSessionTypes.has(a.sessionType) &&
        validStatuses.has(a.status) &&
        typeof a.plannedDurationSeconds === 'number' &&
        Number.isFinite(a.plannedDurationSeconds) &&
        typeof a.localDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(a.localDate) &&
        a.settingsSnapshot &&
        typeof a.settingsSnapshot === 'object'
      );
    })
    .map((a: any) => ({
      ...a,
      initialTagId: resolveTagId(a.initialTagId),
      tagId: resolveTagId(a.tagId),
      pauseIntervals: Array.isArray(a.pauseIntervals) ? a.pauseIntervals.slice(0, 50) : [],
    }));

  const events: MlEvent[] = rawEvents
    .filter((e: any) => {
      if (!e || typeof e !== 'object') return false;
      if (isSampleSessionId(e.eventId)) return false;
      return (
        typeof e.eventId === 'string' &&
        e.eventId.length > 0 &&
        typeof e.eventType === 'string' &&
        typeof e.timestamp === 'string' &&
        typeof e.timestampMs === 'number' &&
        Number.isFinite(e.timestampMs) &&
        typeof e.localDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.localDate)
      );
    })
    .map((e: any) => ({
      ...e,
      tagId: e.tagId !== undefined ? resolveTagId(e.tagId) : null,
      fromTagId: e.fromTagId !== undefined ? resolveTagId(e.fromTagId) : null,
      toTagId: e.toTagId !== undefined ? resolveTagId(e.toTagId) : null,
    }));

  return {
    schemaVersion:
      typeof obj.schemaVersion === 'number' && Number.isFinite(obj.schemaVersion)
        ? obj.schemaVersion
        : 1,
    sessionAttempts,
    events,
  };
}

function isValidIsoTimestamp(val: unknown): val is string {
  return typeof val === 'string' && val.length <= 64 && !Number.isNaN(Date.parse(val));
}

export function parseAndValidateBackupEntities(
  data: BackupData,
  isEffectiveAuthenticated: boolean
): {
  validTags: Tag[];
  validSessions: CompletedSession[];
  validCoffee: CoffeeCup[];
  normalizeRawTagRef: (tagRef: unknown) => string | null;
} {
  const rawImportTagIdMap = new Map<string, string>();
  const rawTags = Array.isArray(data.tags) ? data.tags : [];
  const validTags: Tag[] = rawTags
    .filter((t: any) => t && typeof t.name === 'string' && t.name.trim().length > 0)
    .map((t: any) => {
      const rawId = typeof t.id === 'string' ? t.id.trim() : '';
      const safeId =
        rawId.length > 0 && TAG_ID_REGEX.test(rawId)
          ? rawId
          : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (rawId.length > 0) {
        rawImportTagIdMap.set(rawId, safeId);
        if (typeof t.id === 'string') {
          rawImportTagIdMap.set(t.id, safeId);
        }
      }
      const fallbackNowIso = new Date().toISOString();
      const createdAt = isValidIsoTimestamp(t.createdAt)
        ? t.createdAt
        : isValidIsoTimestamp(t.created_at)
        ? t.created_at
        : fallbackNowIso;
      const updatedAt = isValidIsoTimestamp(t.updatedAt)
        ? t.updatedAt
        : isValidIsoTimestamp(t.updated_at)
        ? t.updated_at
        : createdAt;
      return {
        id: safeId,
        name: t.name.trim().slice(0, 50),
        color: sanitizeHexColor(t.color, '#3B82F6'),
        isArchived: typeof t.isArchived === 'boolean' ? t.isArchived : Boolean(t.is_archived),
        createdAt,
        updatedAt,
      };
    });

  const normalizeRawTagRef = (tagRef: unknown): string | null => {
    if (typeof tagRef !== 'string' || !tagRef.trim()) return null;
    return rawImportTagIdMap.get(tagRef) ?? rawImportTagIdMap.get(tagRef.trim()) ?? tagRef.trim();
  };

  const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
  const validSessions: CompletedSession[] = rawSessions
    .filter((s: any) => {
      if (!s) return false;
      if ((isProduction() || isEffectiveAuthenticated) && isSampleSessionId(s.id)) {
        return false;
      }
      const type = s.sessionType || s.session_type;
      const duration = Number(s.durationSeconds ?? s.duration_seconds);
      const completed = s.completedAt || s.completed_at;
      return (
        ['WORK', 'SHORT_BREAK', 'LONG_BREAK'].includes(type) &&
        !isNaN(duration) &&
        duration > 0 &&
        typeof completed === 'string' &&
        !isNaN(new Date(completed).getTime())
      );
    })
    .map((s: any) => {
      const type = (s.sessionType || s.session_type) as SessionType;
      const duration = Number(s.durationSeconds ?? s.duration_seconds);
      const completed = s.completedAt || s.completed_at;
      const tag = s.tagId !== undefined ? s.tagId : s.tag_id !== undefined ? s.tag_id : null;
      const rawRunId = s.timerRunId ?? s.timer_run_id;
      const timerRunId =
        typeof rawRunId === 'string' && rawRunId.trim().length > 0
          ? rawRunId.trim().slice(0, 128)
          : undefined;
      return {
        id:
          typeof s.id === 'string' && s.id.trim().length > 0
            ? s.id
            : `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tagId: normalizeRawTagRef(tag),
        sessionType: type,
        durationSeconds: duration,
        completedAt: completed,
        ...(timerRunId ? { timerRunId } : {}),
      };
    });

  const rawCoffee = Array.isArray(data.coffeeCups)
    ? data.coffeeCups
    : Array.isArray((data as any).coffee_cups)
    ? (data as any).coffee_cups
    : [];
  const validCoffee: CoffeeCup[] = rawCoffee
    .filter((c: any) => {
      if (!c) return false;
      if ((isProduction() || isEffectiveAuthenticated) && isSampleSessionId(c.id)) {
        return false;
      }
      const date = c.date;
      return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
    })
    .map((c: any, idx: number) => {
      const date = c.date;
      const tag = c.tagId !== undefined ? c.tagId : c.tag_id !== undefined ? c.tag_id : null;
      const fallbackBaseMs = Date.parse(`${date}T12:00:00.000Z`);
      const fallbackIso = !Number.isNaN(fallbackBaseMs)
        ? new Date(fallbackBaseMs + idx).toISOString()
        : `${date}T12:00:00.000Z`;
      const createdAt = isValidIsoTimestamp(c.createdAt)
        ? c.createdAt
        : isValidIsoTimestamp(c.created_at)
        ? c.created_at
        : fallbackIso;
      return {
        id:
          typeof c.id === 'string' && c.id.trim().length > 0
            ? c.id
            : `cup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date,
        tagId: normalizeRawTagRef(tag),
        createdAt,
      };
    });

  return {
    validTags,
    validSessions,
    validCoffee,
    normalizeRawTagRef,
  };
}

export function sanitizeBackupSettings(rawSettings: unknown): Partial<UserSettings> | null {
  if (!rawSettings || typeof rawSettings !== 'object') return null;
  const raw = rawSettings as Record<string, unknown>;
  const safeSettings: Partial<UserSettings> = {};

  if (typeof raw.workDurationMinutes === 'number' && Number.isFinite(raw.workDurationMinutes)) {
    safeSettings.workDurationMinutes = Math.max(
      0.01,
      Math.min(360, Math.round(raw.workDurationMinutes * 100) / 100)
    );
  }
  if (
    typeof raw.shortBreakDurationMinutes === 'number' &&
    Number.isFinite(raw.shortBreakDurationMinutes)
  ) {
    safeSettings.shortBreakDurationMinutes = Math.max(
      0.01,
      Math.min(120, Math.round(raw.shortBreakDurationMinutes * 100) / 100)
    );
  }
  if (
    typeof raw.longBreakDurationMinutes === 'number' &&
    Number.isFinite(raw.longBreakDurationMinutes)
  ) {
    safeSettings.longBreakDurationMinutes = Math.max(
      0.01,
      Math.min(180, Math.round(raw.longBreakDurationMinutes * 100) / 100)
    );
  }
  if (typeof raw.longBreakInterval === 'number' && Number.isFinite(raw.longBreakInterval)) {
    safeSettings.longBreakInterval = Math.max(
      1,
      Math.min(20, Math.floor(raw.longBreakInterval))
    );
  }
  if (typeof raw.soundVolume === 'number' && Number.isFinite(raw.soundVolume)) {
    safeSettings.soundVolume = Math.max(0, Math.min(1, raw.soundVolume));
  }
  if (typeof raw.soundEnabled === 'boolean') safeSettings.soundEnabled = raw.soundEnabled;
  if (typeof raw.notificationsEnabled === 'boolean') {
    safeSettings.notificationsEnabled = raw.notificationsEnabled;
  }
  if (typeof raw.autoStartBreaks === 'boolean') safeSettings.autoStartBreaks = raw.autoStartBreaks;
  if (typeof raw.autoStartPomodoros === 'boolean') {
    safeSettings.autoStartPomodoros = raw.autoStartPomodoros;
  }
  if (typeof raw.keepAwake === 'boolean') safeSettings.keepAwake = raw.keepAwake;

  return safeSettings;
}

export function sanitizeBackupProfile(
  rawProfile: BackupData['profile'],
  isEffectiveAuthenticated: boolean
): Partial<UserProfile> | null {
  if (!rawProfile) return null;
  const safeDisplayName =
    typeof rawProfile.displayName === 'string' && rawProfile.displayName.trim().length > 0
      ? rawProfile.displayName.trim().slice(0, 50)
      : undefined;
  const safeDailyGoal =
    typeof rawProfile.dailyGoalMinutes === 'number' && !isNaN(rawProfile.dailyGoalMinutes)
      ? Math.max(1, Math.min(1440, Math.floor(rawProfile.dailyGoalMinutes)))
      : undefined;
  const safeAvatarEmoji =
    typeof rawProfile.avatarEmoji === 'string' && rawProfile.avatarEmoji.trim().length > 0
      ? rawProfile.avatarEmoji.trim().slice(0, 32)
      : undefined;

  const safeProfileUpdate: Partial<UserProfile> = {};
  if (safeDisplayName !== undefined) {
    safeProfileUpdate.displayName = safeDisplayName;
  }
  if (safeAvatarEmoji !== undefined) {
    safeProfileUpdate.avatarEmoji = safeAvatarEmoji;
  }
  if (safeDailyGoal !== undefined) {
    safeProfileUpdate.dailyGoalMinutes = safeDailyGoal;
  }
  if (
    !isEffectiveAuthenticated &&
    'avatarUrl' in rawProfile &&
    typeof rawProfile.avatarUrl === 'string' &&
    rawProfile.avatarUrl.startsWith('https://') &&
    rawProfile.avatarUrl.length <= 2048
  ) {
    safeProfileUpdate.avatarUrl = rawProfile.avatarUrl;
  }
  return Object.keys(safeProfileUpdate).length > 0 ? safeProfileUpdate : null;
}
