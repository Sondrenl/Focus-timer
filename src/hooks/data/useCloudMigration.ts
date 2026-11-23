import { useState, useEffect, useCallback, useRef } from 'react';
import { isSampleSessionId } from '../../services/storage/guestRepositories';
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
import { TAG_ID_REGEX } from '../../utils/backupSanitizers';
import {
  clearGuestDataModifiedFlag,
  getLocalDataOwner,
  hasGuestDataBeenModified,
  setLocalDataOwner,
} from '../../services/sync/offlineOutbox';

const BACKUP_CHUNK_SIZE = 400;

export interface GuestReconciliationSummary {
  sessionsCount: number;
  coffeeCount: number;
  customTagsCount: number;
  hasCustomSettings: boolean;
  hasCustomProfile: boolean;
}

export interface PendingGuestReconciliation {
  summary: GuestReconciliationSummary;
  isResolving: boolean;
  error: string | null;
  resolve: (choice: 'merge' | 'discard') => Promise<void>;
}

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

function countCustomOrModifiedTags(tags: Tag[]): number {
  return tags.filter((tag) => !isUntouchedDefaultTag(tag)).length;
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
    telemetryTracker.clearAll(),
  ]);
  clearGuestDataModifiedFlag();
}

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
    convexUser,
    convexCoffee,
    convexSessions,
    mutations: convexMutations,
  } = convexSync;

  const convexUserId = convexUser?.id ?? null;

  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const [pendingGuestReconciliation, setPendingGuestReconciliation] =
    useState<PendingGuestReconciliation | null>(null);
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
      mode: 'merge' | 'replace',
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
      }>,
      options?: { skipPreClear?: boolean }
    ) => {
      const cleanSessions = sessionsToSync.filter((s) => !isSampleSessionId(s.id));
      const cleanCups = cupsToSync.filter((c) => !isSampleSessionId(c.id));

      let didPreClear = Boolean(options?.skipPreClear);
      if (
        mode === 'replace' &&
        !options?.skipPreClear &&
        typeof convexMutations.clearForReplaceBatch === 'function'
      ) {
        let hasMore = true;
        let batches = 0;
        const MAX_CLEAR_BATCHES = 500;
        while (hasMore && batches < MAX_CLEAR_BATCHES) {
          const res = await convexMutations.clearForReplaceBatch({});
          hasMore = Boolean(res?.hasMore);
          batches += 1;
        }
        didPreClear = true;
      }

      const maxChunks = Math.max(
        1,
        Math.ceil(cleanSessions.length / BACKUP_CHUNK_SIZE),
        Math.ceil(cleanCups.length / BACKUP_CHUNK_SIZE)
      );

      for (let i = 0; i < maxChunks; i++) {
        const chunkMode = i === 0 ? mode : 'merge';
        const sessionSlice = cleanSessions.slice(
          i * BACKUP_CHUNK_SIZE,
          (i + 1) * BACKUP_CHUNK_SIZE
        );
        const cupSlice = cleanCups.slice(
          i * BACKUP_CHUNK_SIZE,
          (i + 1) * BACKUP_CHUNK_SIZE
        );

        await convexMutations.importBackup({
          mode: chunkMode,
          ...(i === 0 && didPreClear ? { skipReplaceClear: true } : {}),
          tags: i === 0 || chunkMode === 'merge' ? tagsToSync : [],
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
      setPendingGuestReconciliation(null);
      isReconcilingUserIdRef.current = null;
      return;
    }
    if (convexUserId && syncedUserId && syncedUserId !== convexUserId) {
      setSyncedUserId(null);
      setPendingGuestReconciliation(null);
      isReconcilingUserIdRef.current = null;
    }
  }, [isEffectiveAuthenticated, isConvexConfigured, convexUserId, syncedUserId]);

  useEffect(() => {
    if (
      !isEffectiveAuthenticated ||
      !isConvexConfigured ||
      !isConvexAuthReady ||
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

    const runSyncGate = async () => {
      try {
        const owner = getLocalDataOwner();

        if (owner === `user:${userId}`) {
          if (!cancelled) {
            setSyncedUserId(userId);
          }
          return;
        }

        if (owner !== null && owner !== 'guest') {
          await clearLocalGuestRepositories();
          setLocalDataOwner(`user:${userId}`);
          if (!cancelled) {
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
          sessionRepository.purgeSampleSessions(),
          coffeeRepository.getAll(),
          tagRepository.getAll(),
          settingsRepository.get(),
          profileRepository.get(),
        ]);

        const cleanSessions = localSessions.filter((s) => !isSampleSessionId(s.id));
        const cleanCoffee = localCoffee.filter((c) => !isSampleSessionId(c.id));

        const customTagCount = countCustomOrModifiedTags(localTags);
        const tagsModifiedFromDefaults = !areTagsDefault(localTags);
        const customSettings = extractCustomGuestSettings(localSettings);
        const customProfile = extractCustomGuestProfile(localProfile);
        const hasCustomSettings = Object.keys(customSettings).length > 0;
        const hasCustomProfile = Object.keys(customProfile).length > 0;
        const guestModifiedFlag = hasGuestDataBeenModified();

        const hasGenuineGuestData =
          cleanSessions.length > 0 ||
          cleanCoffee.length > 0 ||
          tagsModifiedFromDefaults ||
          (guestModifiedFlag && (hasCustomSettings || hasCustomProfile));

        if (!hasGenuineGuestData) {
          await clearLocalGuestRepositories();
          setLocalDataOwner(`user:${userId}`);
          if (!cancelled) {
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

        const uploadGuestData = async (strategy: 'new-account' | 'merge-existing') => {
          if (strategy === 'new-account') {
            const tagMode: 'replace' | 'merge' = tagsModifiedFromDefaults ? 'replace' : 'merge';
            const tagsPayload = tagsModifiedFromDefaults
              ? localTags.map((t) => ({
                  id: t.id,
                  name: t.name,
                  color: t.color,
                  isArchived: t.isArchived,
                  createdAt: t.createdAt,
                  updatedAt: t.updatedAt,
                }))
              : [];

            await syncBackupToConvexChunked(
              tagMode,
              tagsPayload,
              cleanSessions.map((s) => ({
                id: s.id,
                tagId: s.tagId || undefined,
                sessionType: s.sessionType,
                durationSeconds: s.durationSeconds,
                completedAt: s.completedAt,
                timerRunId: s.timerRunId || undefined,
              })),
              cleanCoffee.map((c) => ({
                id: c.id,
                date: c.date,
                tagId: c.tagId || undefined,
                createdAt: c.createdAt,
              })),
              { skipPreClear: true }
            );

            if (hasCustomSettings) {
              await convexMutations.updateSettings(customSettings);
            }
            if (hasCustomProfile) {
              await convexMutations.updateProfile(customProfile);
            }
            return;
          }

          const referencedTagIds = new Set<string>();
          for (const s of cleanSessions) if (s.tagId) referencedTagIds.add(s.tagId);
          for (const c of cleanCoffee) if (c.tagId) referencedTagIds.add(c.tagId);

          const remoteTagByName = new Map(
            remoteTags.map((t) => [t.name.toLowerCase().trim(), t.id])
          );
          const remoteTagIds = new Set(remoteTags.map((t) => t.id));
          const localTagIdRemap = new Map<string, string>();
          const tagsToMerge: Array<{
            id: string;
            name: string;
            color: string;
            isArchived: boolean;
            createdAt?: string;
            updatedAt?: string;
          }> = [];

          for (const t of localTags) {
            const nameKey = t.name.toLowerCase().trim();
            const matchedRemoteId = remoteTagByName.get(nameKey);
            if (matchedRemoteId) {
              localTagIdRemap.set(t.id, matchedRemoteId);
              continue;
            }
            if (isUntouchedDefaultTag(t) && !referencedTagIds.has(t.id)) {
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

          const resolveTagRef = (rawTagId?: string | null): string | undefined => {
            if (!rawTagId) return undefined;
            const mapped = localTagIdRemap.get(rawTagId) ?? rawTagId;
            return remoteTagIds.has(mapped) && TAG_ID_REGEX.test(mapped) ? mapped : undefined;
          };

          await syncBackupToConvexChunked(
            'merge',
            tagsToMerge,
            cleanSessions.map((s) => ({
              id: s.id,
              tagId: resolveTagRef(s.tagId),
              sessionType: s.sessionType,
              durationSeconds: s.durationSeconds,
              completedAt: s.completedAt,
              timerRunId: s.timerRunId || undefined,
            })),
            cleanCoffee.map((c) => ({
              id: c.id,
              date: c.date,
              tagId: resolveTagRef(c.tagId),
              createdAt: c.createdAt,
            }))
          );

          try {
            const currentActiveId = localStorage.getItem('active_tag_id_v1');
            if (currentActiveId && localTagIdRemap.has(currentActiveId) && setActiveTagId) {
              setActiveTagId(localTagIdRemap.get(currentActiveId) ?? null);
            }
          } catch {
            // Ignore storage errors
          }
        };

        if (isBrandNewEmptyCloudAccount) {
          await uploadGuestData('new-account');
          await clearLocalGuestRepositories();
          setLocalDataOwner(`user:${userId}`);
          if (!cancelled) {
            setSyncedUserId(userId);
          }
          return;
        }

        if (!cancelled) {
          const summary: GuestReconciliationSummary = {
            sessionsCount: cleanSessions.length,
            coffeeCount: cleanCoffee.length,
            customTagsCount: customTagCount,
            hasCustomSettings,
            hasCustomProfile,
          };

          const resolveChoice = async (choice: 'merge' | 'discard') => {
            setPendingGuestReconciliation((prev) =>
              prev ? { ...prev, isResolving: true, error: null } : prev
            );
            try {
              if (choice === 'merge') {
                await uploadGuestData('merge-existing');
              }
              await clearLocalGuestRepositories();
              setLocalDataOwner(`user:${userId}`);
              setPendingGuestReconciliation(null);
              setSyncedUserId(userId);
            } catch (err) {
              const msg =
                err instanceof Error
                  ? err.message
                  : 'Failed to complete account sync. Please try again.';
              setPendingGuestReconciliation((prev) =>
                prev ? { ...prev, isResolving: false, error: msg } : prev
              );
            }
          };

          setPendingGuestReconciliation({
            summary,
            isResolving: false,
            error: null,
            resolve: resolveChoice,
          });
        }
      } catch (err) {
        console.warn('Cloud reconciliation/sync gate failed (will retry):', err);
        if (isReconcilingUserIdRef.current === userId) {
          isReconcilingUserIdRef.current = null;
        }
      }
    };

    void runSyncGate();

    return () => {
      cancelled = true;
    };
  }, [
    isEffectiveAuthenticated,
    isConvexConfigured,
    isConvexAuthReady,
    convexUser,
    convexSessions,
    convexCoffee,
    syncedUserId,
    convexMutations,
    syncBackupToConvexChunked,
    setActiveTagId,
  ]);

  const isSyncGateActive =
    isEffectiveAuthenticated &&
    isConvexConfigured &&
    (pendingGuestReconciliation !== null ||
      !convexUserId ||
      syncedUserId !== convexUserId);

  return {
    syncBackupToConvexChunked,
    isSyncGateActive,
    pendingGuestReconciliation,
  };
}
