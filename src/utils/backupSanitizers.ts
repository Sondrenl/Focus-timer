import { Tag } from '../types/tag';
import { CompletedSession } from '../types/session';
import { SessionType } from '../types/timer';
import { BackupData, UserProfile, ExportedProfile } from '../types/user';
import { CoffeeCup } from '../types/coffee';
import { UserSettings } from '../types/settings';
import { isSampleSessionId } from '../services/storage/guestRepositories';
import { isProduction } from './environment';
import { sanitizeHexColor } from './colors';

export const TAG_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

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
      const createdAt = isValidIsoTimestamp(t.createdAt) ? t.createdAt : fallbackNowIso;
      const updatedAt = isValidIsoTimestamp(t.updatedAt) ? t.updatedAt : createdAt;
      return {
        id: safeId,
        name: t.name.trim().slice(0, 50),
        color: sanitizeHexColor(t.color, '#3B82F6'),
        isArchived: Boolean(t.isArchived),
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
      const duration = Number(s.durationSeconds);
      return (
        ['WORK', 'SHORT_BREAK', 'LONG_BREAK'].includes(s.sessionType) &&
        !isNaN(duration) &&
        duration > 0 &&
        typeof s.completedAt === 'string' &&
        !isNaN(new Date(s.completedAt).getTime())
      );
    })
    .map((s: any) => {
      const timerRunId =
        typeof s.timerRunId === 'string' && s.timerRunId.trim().length > 0
          ? s.timerRunId.trim().slice(0, 128)
          : undefined;
      return {
        id:
          typeof s.id === 'string' && s.id.trim().length > 0
            ? s.id
            : `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tagId: normalizeRawTagRef(s.tagId),
        sessionType: s.sessionType as SessionType,
        durationSeconds: Number(s.durationSeconds),
        completedAt: s.completedAt,
        ...(timerRunId ? { timerRunId } : {}),
      };
    });

  const rawCoffee = Array.isArray(data.coffeeCups) ? data.coffeeCups : [];
  const validCoffee: CoffeeCup[] = rawCoffee
    .filter((c: any) => {
      if (!c) return false;
      if ((isProduction() || isEffectiveAuthenticated) && isSampleSessionId(c.id)) {
        return false;
      }
      return typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date);
    })
    .map((c: any, idx: number) => {
      const fallbackBaseMs = Date.parse(`${c.date}T12:00:00.000Z`);
      const fallbackIso = !Number.isNaN(fallbackBaseMs)
        ? new Date(fallbackBaseMs + idx).toISOString()
        : `${c.date}T12:00:00.000Z`;
      return {
        id:
          typeof c.id === 'string' && c.id.trim().length > 0
            ? c.id
            : `cup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: c.date,
        tagId: normalizeRawTagRef(c.tagId),
        createdAt: isValidIsoTimestamp(c.createdAt) ? c.createdAt : fallbackIso,
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
  if (safeDisplayName !== undefined) safeProfileUpdate.displayName = safeDisplayName;
  if (safeAvatarEmoji !== undefined) safeProfileUpdate.avatarEmoji = safeAvatarEmoji;
  if (safeDailyGoal !== undefined) safeProfileUpdate.dailyGoalMinutes = safeDailyGoal;
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
