import React, { useCallback } from 'react';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { BackupData } from '../../types/user';
import { CoffeeCup } from '../../types/coffee';
import { isSampleSessionId } from '../../services/repository/SessionRepository';
import {
  broadcastCoffeeCups,
  broadcastSessionsSync,
  broadcastTags,
  broadcastReset,
} from '../../services/timer/TimerBroadcast';
import { isProduction } from '../../utils/environment';
import { LAST_DAY_RESET_STORAGE_KEY } from '../../utils/newDayCheck';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
  telemetryTracker,
} from '../../context/services';
import { MlTelemetryExport } from '../../types/telemetry';
import { useAuthProfile } from '../../context/AuthProfileContext';
import {
  clearAllHydrationWatermarks,
  parseAndValidateBackupEntities,
  readHydrationWatermark,
  sanitizeBackupProfile,
  sanitizeBackupSettings,
  sanitizeMlTelemetryForImport,
  sanitizeProfileForExport,
  shiftDateDays,
  writeHydrationWatermark,
} from '../../utils/backupSanitizers';
import {
  enqueueOutboxOperation,
  getLocalDataOwnerUserId,
  markGuestDataModified,
  removeOutboxOperation,
} from '../../services/sync/offlineOutbox';
import { useCloudMigration } from './useCloudMigration';

export {
  clearAllHydrationWatermarks,
  readHydrationWatermark,
  sanitizeProfileForExport,
  shiftDateDays,
  writeHydrationWatermark,
};

function mintUniqueLocalTagId(existingIds: Set<string>): string {
  let candidate = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  while (existingIds.has(candidate)) {
    candidate = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return candidate;
}

interface UseBackupAndMigrationParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  currentUserId?: string | null;
  profile: ReturnType<typeof useAuthProfile>['profile'];
  settings: ReturnType<typeof useAuthProfile>['settings'];
  updateProfile: ReturnType<typeof useAuthProfile>['updateProfile'];
  updateSettings: ReturnType<typeof useAuthProfile>['updateSettings'];
  resetProfileToDefaults: ReturnType<typeof useAuthProfile>['resetProfileToDefaults'];
  resetSettingsToDefaults: ReturnType<typeof useAuthProfile>['resetSettingsToDefaults'];
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  syncBackupToConvexChunked?: ReturnType<typeof useCloudMigration>['syncBackupToConvexChunked'];
  setIsBulkSyncing?: React.Dispatch<React.SetStateAction<boolean>>;
  tags: Tag[];
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  activeTagId: string | null;
  setActiveTagId: (id: string | null, options?: { skipTelemetry?: boolean }) => void;
  sessions: CompletedSession[];
  setSessions: React.Dispatch<React.SetStateAction<CompletedSession[]>>;
  coffeeCups: CoffeeCup[];
  setCoffeeCups: React.Dispatch<React.SetStateAction<CoffeeCup[]>>;
}

export function useBackupAndMigration({
  isEffectiveAuthenticated,
  isConvexAuthReady: isConvexAuthReadyParam,
  currentUserId,
  profile,
  settings,
  updateProfile,
  updateSettings,
  resetProfileToDefaults,
  resetSettingsToDefaults,
  convexSync,
  syncBackupToConvexChunked: syncBackupToConvexChunkedParam,
  setIsBulkSyncing,
  tags,
  setTags,
  activeTagId,
  setActiveTagId,
  sessions,
  setSessions,
  coffeeCups,
  setCoffeeCups,
}: UseBackupAndMigrationParams) {
  const isConvexAuthReady = isConvexAuthReadyParam ?? isEffectiveAuthenticated;
  const {
    isConvexConfigured,
    isConvexConnected,
    mutations: convexMutations,
  } = convexSync;

  // Fallback for direct unit test invocations that don't mount useCloudMigration separately
  const fallbackMigration = useCloudMigration({
    isEffectiveAuthenticated: syncBackupToConvexChunkedParam ? false : isEffectiveAuthenticated,
    isConvexAuthReady,
    convexSync,
  });
  const syncBackupToConvexChunked =
    syncBackupToConvexChunkedParam ?? fallbackMigration.syncBackupToConvexChunked;

  const exportBackup = useCallback((): BackupData => {
    const cleanSessions = sessions.filter((s) => !isSampleSessionId(s.id));
    const sortedSessions = [...cleanSessions].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    const sortedCoffee = [...coffeeCups].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const rawTelemetry = telemetryTracker.getExportDataSync();
    const mlTelemetry: MlTelemetryExport = {
      schemaVersion: rawTelemetry.schemaVersion,
      sessionAttempts: rawTelemetry.sessionAttempts.filter((a) => !isSampleSessionId(a.attemptId)),
      events: rawTelemetry.events.filter((e) => !isSampleSessionId(e.eventId)),
    };
    return {
      version: '3.0.3',
      exportedAt: new Date().toISOString(),
      profile: sanitizeProfileForExport(profile),
      tags,
      sessions: sortedSessions,
      coffeeCups: sortedCoffee,
      settings,
      mlTelemetry,
    };
  }, [sessions, coffeeCups, profile, tags, settings]);

  const importBackup = useCallback(
    async (
      data: BackupData,
      mode: 'merge' | 'replace'
    ): Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded: number }> => {
      setIsBulkSyncing?.(true);
      try {
        const {
          validTags,
          validSessions,
          validCoffee,
          normalizeRawTagRef,
        } = parseAndValidateBackupEntities(data, isEffectiveAuthenticated);

        let finalTags: Tag[] = [];
        let finalSessions: CompletedSession[] = [];
        let finalCoffee: CoffeeCup[] = [];
        let finalMlTelemetry: MlTelemetryExport | undefined;
        let sessionsAdded = 0;
        let tagsAdded = 0;
        let coffeeAdded = 0;

        if (mode === 'replace') {
          await sessionRepository.clear();
          await coffeeRepository.clear();

          finalTags = validTags.length > 0 ? validTags : await tagRepository.resetToDefaults();
          const validTagIds = new Set(finalTags.map((t) => t.id));
          const resolveReplaceTagId = (rawTagId?: string | null): string | null => {
            const normalized = normalizeRawTagRef(rawTagId);
            if (!normalized) return null;
            return validTagIds.has(normalized) ? normalized : null;
          };

          finalSessions = validSessions
            .map((s) => ({ ...s, tagId: resolveReplaceTagId(s.tagId) }))
            .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
          finalCoffee = validCoffee
            .map((c) => ({ ...c, tagId: resolveReplaceTagId(c.tagId) }))
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

          await tagRepository.saveAll(finalTags);
          await sessionRepository.saveAll(finalSessions);
          await coffeeRepository.saveAll(finalCoffee);

          finalMlTelemetry = sanitizeMlTelemetryForImport(data.mlTelemetry, resolveReplaceTagId);
          if (finalMlTelemetry) {
            await telemetryTracker.importTelemetry(finalMlTelemetry, 'replace');
          } else {
            await telemetryTracker.clearAll();
          }

          setTags(finalTags);
          setSessions(finalSessions);
          setCoffeeCups(finalCoffee);

          if (!activeTagId || !finalTags.some((t) => t.id === activeTagId && !t.isArchived)) {
            const nextActive = finalTags.find((t) => !t.isArchived);
            setActiveTagId(nextActive?.id ?? null, { skipTelemetry: true });
          }

          broadcastTags(finalTags);
          broadcastSessionsSync(finalSessions);
          broadcastCoffeeCups(finalCoffee);

          sessionsAdded = finalSessions.length;
          tagsAdded = finalTags.length;
          coffeeAdded = finalCoffee.length;
        } else {
          // Read fresh state from repositories instead of potentially stale React closures (H12)
          const [freshTags, freshSessions, freshCoffee] = await Promise.all([
            tagRepository.getAll(),
            sessionRepository.getAll(),
            coffeeRepository.getAll(),
          ]);

          const existingTagIds = new Set(freshTags.map((t) => t.id));
          const existingTagByName = new Map(
            freshTags.map((t) => [t.name.toLowerCase().trim(), t.id])
          );
          const tagIdRemap = new Map<string, string>();
          freshTags.forEach((t) => tagIdRemap.set(t.id, t.id));

          const newTagsToKeep: Tag[] = [];

          for (const t of validTags) {
            const nameKey = t.name.toLowerCase().trim();
            const existingIdByName = existingTagByName.get(nameKey);
            if (existingIdByName) {
              tagIdRemap.set(t.id, existingIdByName);
            } else {
              // If t.id collides with an existing tag's ID under a different name (e.g. renamed default tag),
              // mint a fresh unique ID and remap all incoming references so nothing is silently dropped (H4).
              const canonicalId = existingTagIds.has(t.id)
                ? mintUniqueLocalTagId(existingTagIds)
                : t.id;
              newTagsToKeep.push({ ...t, id: canonicalId });
              existingTagIds.add(canonicalId);
              existingTagByName.set(nameKey, canonicalId);
              tagIdRemap.set(t.id, canonicalId);
              tagsAdded++;
            }
          }
          finalTags = [...freshTags, ...newTagsToKeep];
          const validFinalTagIds = new Set(finalTags.map((t) => t.id));
          const resolveMergeTagId = (rawTagId?: string | null): string | null => {
            const normalized = normalizeRawTagRef(rawTagId);
            if (!normalized) return null;
            const mapped = tagIdRemap.get(normalized) ?? normalized;
            return validFinalTagIds.has(mapped) ? mapped : null;
          };

          await tagRepository.saveAll(finalTags);
          setTags(finalTags);
          if (!activeTagId || !finalTags.some((t) => t.id === activeTagId && !t.isArchived)) {
            const nextActive = finalTags.find((t) => !t.isArchived);
            setActiveTagId(nextActive?.id ?? null, { skipTelemetry: true });
          }
          broadcastTags(finalTags);

          const baseSessions =
            isProduction() || isEffectiveAuthenticated
              ? freshSessions.filter((s) => !isSampleSessionId(s.id))
              : freshSessions;
          const existingSessionIds = new Set(baseSessions.map((s) => s.id));
          const existingRunIds = new Set(
            baseSessions.map((s) => s.timerRunId).filter((r): r is string => Boolean(r))
          );
          const existingSessionKeys = new Set(
            baseSessions.map((s) => `${s.sessionType}-${s.completedAt}`)
          );
          const newSessionsToKeep: CompletedSession[] = [];

          for (const s of validSessions) {
            if (s.timerRunId && existingRunIds.has(s.timerRunId)) {
              continue;
            }
            const sessionKey = `${s.sessionType}-${s.completedAt}`;
            if (!existingSessionIds.has(s.id) && !existingSessionKeys.has(sessionKey)) {
              newSessionsToKeep.push({
                ...s,
                tagId: resolveMergeTagId(s.tagId),
              });
              existingSessionIds.add(s.id);
              existingSessionKeys.add(sessionKey);
              if (s.timerRunId) existingRunIds.add(s.timerRunId);
              sessionsAdded++;
            }
          }
          finalSessions = [...baseSessions, ...newSessionsToKeep].sort(
            (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
          );
          await sessionRepository.saveAll(finalSessions);
          setSessions(finalSessions);
          broadcastSessionsSync(finalSessions);

          const existingCupIds = new Set(freshCoffee.map((c) => c.id));
          const existingCupKeys = new Set(freshCoffee.map((c) => `${c.date}-${c.createdAt}`));
          const newCoffeeToKeep: CoffeeCup[] = [];

          for (const c of validCoffee) {
            const cupKey = `${c.date}-${c.createdAt}`;
            if (!existingCupIds.has(c.id) && !existingCupKeys.has(cupKey)) {
              newCoffeeToKeep.push({
                ...c,
                tagId: resolveMergeTagId(c.tagId),
              });
              existingCupIds.add(c.id);
              existingCupKeys.add(cupKey);
              coffeeAdded++;
            }
          }
          finalCoffee = [...freshCoffee, ...newCoffeeToKeep].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          await coffeeRepository.saveAll(finalCoffee);
          setCoffeeCups(finalCoffee);
          broadcastCoffeeCups(finalCoffee);

          finalMlTelemetry = sanitizeMlTelemetryForImport(data.mlTelemetry, resolveMergeTagId);
          if (
            finalMlTelemetry &&
            (finalMlTelemetry.sessionAttempts.length > 0 || finalMlTelemetry.events.length > 0)
          ) {
            await telemetryTracker.importTelemetry(finalMlTelemetry, 'merge');
          }
        }

        if (!isEffectiveAuthenticated) {
          markGuestDataModified();
        }

        const safeSettings = sanitizeBackupSettings(data.settings);
        if (safeSettings && Object.keys(safeSettings).length > 0) {
          await updateSettings(safeSettings, { skipTelemetry: true });
        }

        const safeProfileUpdate = sanitizeBackupProfile(data.profile, isEffectiveAuthenticated);
        if (safeProfileUpdate) {
          await updateProfile(safeProfileUpdate, { skipTelemetry: true });
        }

        if (
          mode === 'replace' ||
          (finalMlTelemetry &&
            (finalMlTelemetry.sessionAttempts.length > 0 || finalMlTelemetry.events.length > 0))
        ) {
          clearAllHydrationWatermarks();
        }

        if (isConvexConfigured && isEffectiveAuthenticated) {
          if (!isConvexAuthReady || isConvexConnected === false) {
            throw new Error(
              'Backup restored locally, but cloud sync requires an active internet connection.'
            );
          }
          await syncBackupToConvexChunked(
            mode,
            finalTags.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              isArchived: t.isArchived,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
            })),
            finalSessions.map((s) => ({
              id: s.id,
              tagId: s.tagId || undefined,
              sessionType: s.sessionType,
              durationSeconds: s.durationSeconds,
              completedAt: s.completedAt,
              timerRunId: s.timerRunId || undefined,
            })),
            finalCoffee.map((c) => ({
              id: c.id,
              date: c.date,
              tagId: c.tagId || undefined,
              createdAt: c.createdAt,
            })),
            finalMlTelemetry
          );
        }

        return {
          sessionsAdded,
          tagsAdded,
          coffeeAdded,
        };
      } finally {
        setIsBulkSyncing?.(false);
      }
    },
    [
      isEffectiveAuthenticated,
      isConvexConfigured,
      isConvexAuthReady,
      isConvexConnected,
      activeTagId,
      updateSettings,
      updateProfile,
      syncBackupToConvexChunked,
      setIsBulkSyncing,
      setTags,
      setActiveTagId,
      setSessions,
      setCoffeeCups,
    ]
  );

  const resetAllData = useCallback(
    async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
      setIsBulkSyncing?.(true);
      try {
        await sessionRepository.clear();
        await coffeeRepository.clear();
        await telemetryTracker.clearAll();
        clearAllHydrationWatermarks();
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(LAST_DAY_RESET_STORAGE_KEY);
          }
        } catch {
          // Ignore storage errors
        }
        setSessions([]);
        setCoffeeCups([]);
        broadcastCoffeeCups([]);

        if (scope === 'sessions-only') {
          broadcastReset(scope);
        } else {
          const defaultTags = await tagRepository.resetToDefaults();
          await resetSettingsToDefaults({ skipTelemetry: true });
          await resetProfileToDefaults({ skipTelemetry: true });

          setTags(defaultTags);
          setActiveTagId(defaultTags[0]?.id || null, { skipTelemetry: true });

          broadcastTags(defaultTags);
          broadcastReset(scope);
        }

        if (isConvexConfigured && isEffectiveAuthenticated) {
          const ownerId = currentUserId ?? getLocalDataOwnerUserId();
          const queuedOp = ownerId
            ? enqueueOutboxOperation(ownerId, {
                kind: 'reset_all',
                payload: { scope },
              })
            : null;

          if (isConvexAuthReady && isConvexConnected !== false) {
            try {
              // Run sequentially so clearSessions/clearCoffee/clearTelemetry complete
              // before resetTags patches the user document (eliminates OCC races — H12)
              await convexMutations.clearSessions({});
              await convexMutations.clearCoffee({});
              if (convexMutations.clearTelemetry) {
                await convexMutations.clearTelemetry({});
              }
              if (scope === 'factory-reset') {
                await convexMutations.resetTags({});
              }
              if (queuedOp) {
                removeOutboxOperation(queuedOp.id);
              }
            } catch (err) {
              // Keep queuedOp in persistent outbox so reset replays cleanly on reconnect
              console.warn('Cloud reset failed (queued for retry):', err);
            }
          }
        }
      } finally {
        setIsBulkSyncing?.(false);
      }
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      isConvexConnected,
      currentUserId,
      convexMutations,
      resetSettingsToDefaults,
      resetProfileToDefaults,
      setIsBulkSyncing,
      setActiveTagId,
      setSessions,
      setCoffeeCups,
      setTags,
    ]
  );

  return {
    exportBackup,
    importBackup,
    resetAllData,
  };
}
