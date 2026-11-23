import React, { useCallback } from 'react';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { BackupData } from '../../types/user';
import { CoffeeCup } from '../../types/coffee';
import { isSampleSessionId } from '../../services/storage/guestRepositories';
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
import { useAuthProfile } from '../../context/AuthProfileContext';
import {
  parseAndValidateBackupEntities,
  sanitizeBackupProfile,
  sanitizeBackupSettings,
  sanitizeProfileForExport,
} from '../../utils/backupSanitizers';
import { markGuestDataModified } from '../../services/sync/offlineOutbox';
import { useCloudMigration } from './useCloudMigration';

export { sanitizeProfileForExport };

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
  profile: ReturnType<typeof useAuthProfile>['profile'];
  settings: ReturnType<typeof useAuthProfile>['settings'];
  updateProfile: ReturnType<typeof useAuthProfile>['updateProfile'];
  updateSettings: ReturnType<typeof useAuthProfile>['updateSettings'];
  resetProfileToDefaults: ReturnType<typeof useAuthProfile>['resetProfileToDefaults'];
  resetSettingsToDefaults: ReturnType<typeof useAuthProfile>['resetSettingsToDefaults'];
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  syncBackupToConvexChunked?: ReturnType<typeof useCloudMigration>['syncBackupToConvexChunked'];
  tags: Tag[];
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  activeTagId: string | null;
  setActiveTagId: (id: string | null) => void;
  sessions: CompletedSession[];
  setSessions: React.Dispatch<React.SetStateAction<CompletedSession[]>>;
  coffeeCups: CoffeeCup[];
  setCoffeeCups: React.Dispatch<React.SetStateAction<CoffeeCup[]>>;
}

export function useBackupAndMigration({
  isEffectiveAuthenticated,
  isConvexAuthReady: isConvexAuthReadyParam,
  profile,
  settings,
  updateProfile,
  updateSettings,
  resetProfileToDefaults,
  resetSettingsToDefaults,
  convexSync,
  syncBackupToConvexChunked: syncBackupToConvexChunkedParam,
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
  const isCloudMode = isConvexConfigured && isEffectiveAuthenticated;

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
    return {
      version: '3.0.3',
      exportedAt: new Date().toISOString(),
      profile: sanitizeProfileForExport(profile),
      tags,
      sessions: sortedSessions,
      coffeeCups: sortedCoffee,
      settings,
    };
  }, [sessions, coffeeCups, profile, tags, settings]);

  const importBackup = useCallback(
    async (
      data: BackupData,
      mode: 'merge' | 'replace'
    ): Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded: number }> => {
      const {
        validTags,
        validSessions,
        validCoffee,
        normalizeRawTagRef,
      } = parseAndValidateBackupEntities(data, isEffectiveAuthenticated);

      let finalTags: Tag[] = [];
      let finalSessions: CompletedSession[] = [];
      let finalCoffee: CoffeeCup[] = [];
      let sessionsAdded = 0;
      let tagsAdded = 0;
      let coffeeAdded = 0;

      if (mode === 'replace') {
        if (!isCloudMode) {
          await sessionRepository.clear();
          await coffeeRepository.clear();
        }

        finalTags =
          validTags.length > 0 ? validTags : await tagRepository.resetToDefaults();
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

        if (!isCloudMode) {
          await tagRepository.saveAll(finalTags);
          await sessionRepository.saveAll(finalSessions);
          await coffeeRepository.saveAll(finalCoffee);
          setTags(finalTags);
          setSessions(finalSessions);
          setCoffeeCups(finalCoffee);
          broadcastTags(finalTags);
          broadcastSessionsSync(finalSessions);
          broadcastCoffeeCups(finalCoffee);
        }

        if (!activeTagId || !finalTags.some((t) => t.id === activeTagId && !t.isArchived)) {
          const nextActive = finalTags.find((t) => !t.isArchived);
          setActiveTagId(nextActive?.id ?? null);
        }

        sessionsAdded = finalSessions.length;
        tagsAdded = finalTags.length;
        coffeeAdded = finalCoffee.length;
      } else {
        const [freshTags, freshSessions, freshCoffee] = isCloudMode
          ? [tags, sessions, coffeeCups]
          : await Promise.all([
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
          if (s.timerRunId && existingRunIds.has(s.timerRunId)) continue;
          const sessionKey = `${s.sessionType}-${s.completedAt}`;
          if (!existingSessionIds.has(s.id) && !existingSessionKeys.has(sessionKey)) {
            newSessionsToKeep.push({ ...s, tagId: resolveMergeTagId(s.tagId) });
            existingSessionIds.add(s.id);
            existingSessionKeys.add(sessionKey);
            if (s.timerRunId) existingRunIds.add(s.timerRunId);
            sessionsAdded++;
          }
        }
        finalSessions = [...baseSessions, ...newSessionsToKeep].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );

        const existingCupIds = new Set(freshCoffee.map((c) => c.id));
        const existingCupKeys = new Set(freshCoffee.map((c) => `${c.date}-${c.createdAt}`));
        const newCoffeeToKeep: CoffeeCup[] = [];

        for (const c of validCoffee) {
          const cupKey = `${c.date}-${c.createdAt}`;
          if (!existingCupIds.has(c.id) && !existingCupKeys.has(cupKey)) {
            newCoffeeToKeep.push({ ...c, tagId: resolveMergeTagId(c.tagId) });
            existingCupIds.add(c.id);
            existingCupKeys.add(cupKey);
            coffeeAdded++;
          }
        }
        finalCoffee = [...freshCoffee, ...newCoffeeToKeep].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        if (!isCloudMode) {
          await tagRepository.saveAll(finalTags);
          await sessionRepository.saveAll(finalSessions);
          await coffeeRepository.saveAll(finalCoffee);
          setTags(finalTags);
          setSessions(finalSessions);
          setCoffeeCups(finalCoffee);
          broadcastTags(finalTags);
          broadcastSessionsSync(finalSessions);
          broadcastCoffeeCups(finalCoffee);
        }

        if (!activeTagId || !finalTags.some((t) => t.id === activeTagId && !t.isArchived)) {
          const nextActive = finalTags.find((t) => !t.isArchived);
          setActiveTagId(nextActive?.id ?? null);
        }
      }

      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }

      const safeSettings = sanitizeBackupSettings(data.settings);
      if (safeSettings && Object.keys(safeSettings).length > 0) {
        await updateSettings(safeSettings);
      }

      const safeProfileUpdate = sanitizeBackupProfile(data.profile, isEffectiveAuthenticated);
      if (safeProfileUpdate) {
        await updateProfile(safeProfileUpdate);
      }

      if (isCloudMode) {
        if (!isConvexAuthReady || isConvexConnected === false) {
          throw new Error(
            'Cloud backup import requires an active internet connection.'
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
          }))
        );
      }

      return {
        sessionsAdded,
        tagsAdded,
        coffeeAdded,
      };
    },
    [
      isEffectiveAuthenticated,
      isCloudMode,
      isConvexAuthReady,
      isConvexConnected,
      tags,
      sessions,
      coffeeCups,
      activeTagId,
      updateSettings,
      updateProfile,
      syncBackupToConvexChunked,
      setTags,
      setActiveTagId,
      setSessions,
      setCoffeeCups,
    ]
  );

  const resetAllData = useCallback(
    async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
      await sessionRepository.clear();
      await coffeeRepository.clear();
      await telemetryTracker.clearAll();
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
        await resetSettingsToDefaults();
        await resetProfileToDefaults();

        setTags(defaultTags);
        setActiveTagId(defaultTags[0]?.id || null);

        broadcastTags(defaultTags);
        broadcastReset(scope);
      }

      if (isCloudMode && isConvexAuthReady) {
        await convexMutations.clearSessions({});
        await convexMutations.clearCoffee({});
        if (convexMutations.clearTelemetry) {
          await convexMutations.clearTelemetry({});
        }
        if (scope === 'factory-reset') {
          await convexMutations.resetTags({});
        }
      }
    },
    [
      isCloudMode,
      isConvexAuthReady,
      convexMutations,
      resetSettingsToDefaults,
      resetProfileToDefaults,
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
