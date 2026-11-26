import { useState, useEffect, useCallback, useRef } from 'react';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
  settingsRepository,
  profileRepository,
  telemetryTracker,
} from '../../context/services';
import { DEFAULT_TAGS, Tag } from '../../types/tag';
import { DEFAULT_SETTINGS, UserSettings } from '../../types/settings';
import { DEFAULT_PROFILE, UserProfile } from '../../types/user';
import { useAuthProfile } from '../../context/AuthProfileContext';
import {
  clearGuestDataModifiedFlag,
  getLocalDataOwner,
  hasGuestDataBeenModified,
  setLocalDataOwner,
} from '../../services/sync/offlineOutbox';

const BACKUP_CHUNK_SIZE = 400;
const TAG_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const DEFAULT_TAG_BY_ID = new Map(DEFAULT_TAGS.map((t) => [t.id, t]));

function isUntouchedDefaultTag(tag: Tag): boolean {
  const def = DEFAULT_TAG_BY_ID.get(tag.id);
  if (!def) return false;
  return (
    def.name.trim().toLowerCase() === tag.name.trim().toLowerCase() &&
    def.color.trim().toLowerCase() === tag.color.trim().toLowerCase() &&
    Boolean(tag.isArchived) === Boolean(def.isArchived)
  );
}

function areTagsDefault(tags: Tag[] | undefined | null): boolean {
  if (!Array.isArray(tags) || tags.length !== DEFAULT_TAGS.length) return false;
  return tags.every((t) => isUntouchedDefaultTag(t));
}

export interface GuestTagMergeCandidate {
  id: string;
  name: string;
  color: string;
  isArchived: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function computeGuestTagMergePlan(params: {
  localTags: Tag[];
  remoteTags: Tag[];
  referencedTagIds: Set<string>;
  guestModifiedFlag: boolean;
}): {
  tagsToMerge: GuestTagMergeCandidate[];
  localTagIdRemap: Map<string, string>;
  remoteTagIds: Set<string>;
} {
  const { localTags, remoteTags, referencedTagIds, guestModifiedFlag } = params;
  const remoteTagByName = new Map(
    remoteTags.map((t) => [t.name.toLowerCase().trim(), t.id])
  );
  const remoteTagIds = new Set(remoteTags.map((t) => t.id));
  const localTagIdRemap = new Map<string, string>();
  const tagsToMerge: GuestTagMergeCandidate[] = [];

  for (const t of localTags) {
    const nameKey = t.name.toLowerCase().trim();
    const matchedRemoteId = remoteTagByName.get(nameKey);
    if (matchedRemoteId) {
      localTagIdRemap.set(t.id, matchedRemoteId);
      continue;
    }
    // Never resurrect an untouched default tag that was deleted or renamed in the cloud account.
    // If the remote account still has this default tag ID (e.g., renamed), remap to it;
    // otherwise leave sessions/cups referencing it unassigned.
    if (isUntouchedDefaultTag(t)) {
      if (remoteTagIds.has(t.id)) {
        localTagIdRemap.set(t.id, t.id);
      }
      continue;
    }
    // Avoid resurrecting stale unowned custom tags when guest data was not modified locally.
    if (!guestModifiedFlag && !referencedTagIds.has(t.id)) {
      continue;
    }
    const validId =
      typeof t.id === 'string' &&
      TAG_ID_REGEX.test(t.id.trim()) &&
      !remoteTagIds.has(t.id.trim())
        ? t.id.trim()
        : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    localTagIdRemap.set(t.id, validId);
    remoteTagIds.add(validId);
    tagsToMerge.push({
      id: validId,
      name: t.name,
      color: t.color,
      isArchived: t.isArchived,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    });
  }

  return { tagsToMerge, localTagIdRemap, remoteTagIds };
}

type SyncableSettingsPatch = Partial<
  Pick<
    UserSettings,
    | 'workDurationMinutes'
    | 'shortBreakDurationMinutes'
    | 'longBreakDurationMinutes'
    | 'longBreakInterval'
    | 'autoStartBreaks'
    | 'autoStartPomodoros'
    | 'soundVolume'
    | 'soundEnabled'
    | 'keepAwake'
  >
>;

function extractCustomGuestSettings(localSettings: UserSettings): SyncableSettingsPatch {
  const patch: SyncableSettingsPatch = {};
  const keys: Array<keyof SyncableSettingsPatch> = [
    'workDurationMinutes',
    'shortBreakDurationMinutes',
    'longBreakDurationMinutes',
    'longBreakInterval',
    'autoStartBreaks',
    'autoStartPomodoros',
    'soundVolume',
    'soundEnabled',
  ];
  for (const key of keys) {
    if (localSettings[key] !== DEFAULT_SETTINGS[key]) {
      (patch as Record<string, unknown>)[key] = localSettings[key];
    }
  }
  if (Boolean(localSettings.keepAwake) !== Boolean(DEFAULT_SETTINGS.keepAwake)) {
    patch.keepAwake = Boolean(localSettings.keepAwake);
  }
  return patch;
}

function extractCustomGuestProfile(localProfile: UserProfile): {
  displayName?: string;
  avatarEmoji?: string;
  dailyGoalMinutes?: number;
} {
  const patch: {
    displayName?: string;
    avatarEmoji?: string;
    dailyGoalMinutes?: number;
  } = {};

  if (
    localProfile.displayName &&
    localProfile.displayName.trim() !== DEFAULT_PROFILE.displayName
  ) {
    patch.displayName = localProfile.displayName.trim();
  }
  if (
    localProfile.avatarEmoji &&
    localProfile.avatarEmoji.trim() !== DEFAULT_PROFILE.avatarEmoji
  ) {
    patch.avatarEmoji = localProfile.avatarEmoji.trim();
  }
  if (localProfile.dailyGoalMinutes !== DEFAULT_PROFILE.dailyGoalMinutes) {
    patch.dailyGoalMinutes = localProfile.dailyGoalMinutes;
  }
  return patch;
}

async function clearLocalGuestRepositories(): Promise<void> {
  await Promise.all([
    sessionRepository.clear(),
    coffeeRepository.clear(),
    tagRepository.resetToDefaults(),
    profileRepository.resetToDefaults(),
    telemetryTracker.clearAll(),
  ]);
  clearGuestDataModifiedFlag();
}

const MAX_MIGRATION_RETRIES = 5;

interface UseCloudMigrationParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  setActiveTagId?: (id: string | null) => void;
}

export function useCloudMigration({
  isEffectiveAuthenticated,
  isConvexAuthReady: isConvexAuthReadyParam,
  convexSync,
  setActiveTagId,
}: UseCloudMigrationParams) {
  const isConvexAuthReady = isConvexAuthReadyParam ?? isEffectiveAuthenticated;
  const {
    isConvexConfigured,
    isConvexConnected,
    convexUser,
    convexCoffee,
    convexSessions,
    mutations: convexMutations,
  } = convexSync;

  const convexUserId = convexUser?.id ?? null;

  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState<number>(0);
  const retryCountRef = useRef<number>(0);
  const isReconcilingUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      isConvexConfigured &&
      isEffectiveAuthenticated &&
      isConvexAuthReady &&
      convexMutations?.upsertAttempt
    ) {
      telemetryTracker.setCloudSink({
        upsertAttempt: async (attempt) => {
          await convexMutations.upsertAttempt(attempt);
        },
      });
    } else {
      telemetryTracker.setCloudSink(null);
    }
    return () => {
      telemetryTracker.setCloudSink(null);
    };
  }, [
    isConvexConfigured,
    isEffectiveAuthenticated,
    isConvexAuthReady,
    convexMutations,
  ]);

  const syncBackupToConvexChunked = useCallback(
    async (
      tagsToSync: Array<{
        id?: string;
        name: string;
        color: string;
        isArchived?: boolean;
        createdAt?: string;
        updatedAt?: string;
      }>,
      sessionsToSync: Array<{
        id?: string;
        tagId?: string | null;
        sessionType: 'WORK' | 'SHORT_BREAK' | 'LONG_BREAK';
        durationSeconds: number;
        completedAt: string;
        timerRunId?: string | null;
      }>,
      cupsToSync: Array<{
        id?: string;
        date: string;
        tagId?: string | null;
        createdAt?: string;
      }>
    ) => {
      const maxChunks = Math.max(
        1,
        Math.ceil(sessionsToSync.length / BACKUP_CHUNK_SIZE),
        Math.ceil(cupsToSync.length / BACKUP_CHUNK_SIZE)
      );

      for (let i = 0; i < maxChunks; i++) {
        const sessionSlice = sessionsToSync.slice(
          i * BACKUP_CHUNK_SIZE,
          (i + 1) * BACKUP_CHUNK_SIZE
        );
        const cupSlice = cupsToSync.slice(
          i * BACKUP_CHUNK_SIZE,
          (i + 1) * BACKUP_CHUNK_SIZE
        );

        await convexMutations.importBackup({
          mode: 'merge',
          tags: i === 0 ? tagsToSync : [],
          sessions: sessionSlice,
          coffeeCups: cupSlice,
        });
      }
    },
    [convexMutations]
  );

  useEffect(() => {
    if (!isEffectiveAuthenticated || !isConvexConfigured) {
      setSyncedUserId(null);
      retryCountRef.current = 0;
      isReconcilingUserIdRef.current = null;
      return;
    }
    if (convexUserId && syncedUserId && syncedUserId !== convexUserId) {
      setSyncedUserId(null);
      retryCountRef.current = 0;
      isReconcilingUserIdRef.current = null;
    }
  }, [isEffectiveAuthenticated, isConvexConfigured, convexUserId, syncedUserId]);

  useEffect(() => {
    if (
      !isEffectiveAuthenticated ||
      !isConvexConfigured ||
      !isConvexAuthReady ||
      isConvexConnected === false ||
      !convexUser ||
      !Array.isArray(convexSessions) ||
      !Array.isArray(convexCoffee)
    ) {
      return;
    }

    const userId = convexUser.id;
    if (syncedUserId === userId || isReconcilingUserIdRef.current === userId) {
      return;
    }

    isReconcilingUserIdRef.current = userId;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const runSyncGate = async () => {
      try {
        const owner = getLocalDataOwner();

        if (owner === `user:${userId}`) {
          if (!cancelled) {
            retryCountRef.current = 0;
            setSyncedUserId(userId);
          }
          return;
        }

        if (owner !== null && owner !== 'guest') {
          await clearLocalGuestRepositories();
          setLocalDataOwner(`user:${userId}`);
          if (!cancelled) {
            retryCountRef.current = 0;
            setSyncedUserId(userId);
          }
          return;
        }

        const [
          localSessions,
          localCoffee,
          localTags,
          localSettings,
          localProfile,
        ] = await Promise.all([
          sessionRepository.getAll(),
          coffeeRepository.getAll(),
          tagRepository.getAll(),
          settingsRepository.get(),
          profileRepository.get(),
        ]);

        const tagsModifiedFromDefaults = !areTagsDefault(localTags);
        const customSettings = extractCustomGuestSettings(localSettings);
        const customProfile = extractCustomGuestProfile(localProfile);
        const hasCustomSettings = Object.keys(customSettings).length > 0;
        const hasCustomProfile = Object.keys(customProfile).length > 0;
        const guestModifiedFlag = hasGuestDataBeenModified();

        const hasGenuineGuestData =
          localSessions.length > 0 ||
          localCoffee.length > 0 ||
          (guestModifiedFlag &&
            (tagsModifiedFromDefaults || hasCustomSettings || hasCustomProfile));

        if (!hasGenuineGuestData) {
          await clearLocalGuestRepositories();
          setLocalDataOwner(`user:${userId}`);
          if (!cancelled) {
            retryCountRef.current = 0;
            setSyncedUserId(userId);
          }
          return;
        }

        const remoteTags = Array.isArray(convexUser.tags)
          ? (convexUser.tags as Tag[])
          : DEFAULT_TAGS;
        const isBrandNewEmptyCloudAccount =
          convexSessions.length === 0 &&
          convexCoffee.length === 0 &&
          areTagsDefault(remoteTags);

        const referencedTagIds = new Set<string>();
        for (const s of localSessions) if (s.tagId) referencedTagIds.add(s.tagId);
        for (const c of localCoffee) if (c.tagId) referencedTagIds.add(c.tagId);

        const { tagsToMerge, localTagIdRemap, remoteTagIds } = computeGuestTagMergePlan({
          localTags,
          remoteTags,
          referencedTagIds,
          guestModifiedFlag,
        });

        const resolveTagRef = (rawTagId?: string | null): string | undefined => {
          if (!rawTagId) return undefined;
          const mapped = localTagIdRemap.get(rawTagId) ?? rawTagId;
          return remoteTagIds.has(mapped) && TAG_ID_REGEX.test(mapped) ? mapped : undefined;
        };

        await syncBackupToConvexChunked(
          tagsToMerge,
          localSessions.map((s) => ({
            id: s.id,
            tagId: resolveTagRef(s.tagId),
            sessionType: s.sessionType,
            durationSeconds: s.durationSeconds,
            completedAt: s.completedAt,
            timerRunId: s.timerRunId || undefined,
          })),
          localCoffee.map((c) => ({
            id: c.id,
            date: c.date,
            tagId: resolveTagRef(c.tagId),
            createdAt: c.createdAt,
          }))
        );

        if (isBrandNewEmptyCloudAccount) {
          if (hasCustomSettings) {
            await convexMutations.updateSettings(customSettings);
          }
          if (hasCustomProfile) {
            await convexMutations.updateProfile(customProfile);
          }
        }

        try {
          const currentActiveId = localStorage.getItem('active_tag_id_v1');
          if (currentActiveId && localTagIdRemap.has(currentActiveId) && setActiveTagId) {
            setActiveTagId(localTagIdRemap.get(currentActiveId) ?? null);
          }
        } catch {
          // Ignore storage errors
        }

        await clearLocalGuestRepositories();
        setLocalDataOwner(`user:${userId}`);
        if (!cancelled) {
          retryCountRef.current = 0;
          setSyncedUserId(userId);
        }
      } catch (err) {
        console.warn('Cloud auto-merge sync gate failed (will retry):', err);
        if (isReconcilingUserIdRef.current === userId) {
          isReconcilingUserIdRef.current = null;
        }
        if (!cancelled && retryCountRef.current < MAX_MIGRATION_RETRIES) {
          retryCountRef.current += 1;
          const delayMs = Math.min(15_000, 3000 * retryCountRef.current);
          retryTimer = setTimeout(() => {
            if (!cancelled) setRetryTick((t) => t + 1);
          }, delayMs);
        }
      }
    };

    void runSyncGate();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    isEffectiveAuthenticated,
    isConvexConfigured,
    isConvexAuthReady,
    isConvexConnected,
    convexUser,
    convexSessions,
    convexCoffee,
    syncedUserId,
    retryTick,
    convexMutations,
    syncBackupToConvexChunked,
    setActiveTagId,
  ]);

  const isSyncGateActive =
    isEffectiveAuthenticated &&
    isConvexConfigured &&
    (!convexUserId || syncedUserId !== convexUserId);

  return {
    syncBackupToConvexChunked,
    isSyncGateActive,
  };
}
