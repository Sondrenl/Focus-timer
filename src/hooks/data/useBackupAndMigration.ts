import React, { useCallback } from 'react';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { BackupData, UserProfile } from '../../types/user';
import { CoffeeCup } from '../../types/coffee';
import { LAST_DAY_RESET_STORAGE_KEY } from '../../utils/newDayCheck';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
  telemetryTracker,
} from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';

export function sanitizeProfileForExport(
  profile: UserProfile | null | undefined
): BackupData['profile'] {
  if (!profile) return undefined;
  return {
    displayName: profile.displayName,
    avatarEmoji: profile.avatarEmoji,
    dailyGoalMinutes: profile.dailyGoalMinutes,
  };
}

interface UseBackupAndMigrationParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  profile: ReturnType<typeof useAuthProfile>['profile'];
  settings: ReturnType<typeof useAuthProfile>['settings'];
  resetProfileToDefaults: ReturnType<typeof useAuthProfile>['resetProfileToDefaults'];
  resetSettingsToDefaults: ReturnType<typeof useAuthProfile>['resetSettingsToDefaults'];
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  tags: Tag[];
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  setActiveTagId: (id: string | null) => void;
  sessions: CompletedSession[];
  setSessions: React.Dispatch<React.SetStateAction<CompletedSession[]>>;
  coffeeCups: CoffeeCup[];
  setCoffeeCups: React.Dispatch<React.SetStateAction<CoffeeCup[]>>;
  onDataReset?: (scope: 'sessions-only' | 'factory-reset') => void;
}

export function useBackupAndMigration({
  isEffectiveAuthenticated,
  isConvexAuthReady: isConvexAuthReadyParam,
  profile,
  settings,
  resetProfileToDefaults,
  resetSettingsToDefaults,
  convexSync,
  tags,
  setTags,
  setActiveTagId,
  sessions,
  setSessions,
  coffeeCups,
  setCoffeeCups,
  onDataReset,
}: UseBackupAndMigrationParams) {
  const isConvexAuthReady = isConvexAuthReadyParam ?? isEffectiveAuthenticated;
  const { isConvexConfigured, mutations: convexMutations } = convexSync;
  const isCloudMode = isConvexConfigured && isEffectiveAuthenticated;

  const exportBackup = useCallback((): BackupData => {
    const sortedSessions = [...sessions].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    const sortedCoffee = [...coffeeCups].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return {
      version: '3.1.0',
      exportedAt: new Date().toISOString(),
      profile: sanitizeProfileForExport(profile),
      tags,
      sessions: sortedSessions,
      coffeeCups: sortedCoffee,
      settings,
    };
  }, [sessions, coffeeCups, profile, tags, settings]);

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

      if (scope === 'factory-reset') {
        const defaultTags = await tagRepository.resetToDefaults();
        await resetSettingsToDefaults();
        await resetProfileToDefaults();

        setTags(defaultTags);
        setActiveTagId(defaultTags[0]?.id || null);
      }

      onDataReset?.(scope);

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
      onDataReset,
    ]
  );

  return {
    exportBackup,
    resetAllData,
  };
}
