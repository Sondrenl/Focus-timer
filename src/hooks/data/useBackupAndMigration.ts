import React, { useEffect, useCallback, useRef } from 'react';
import { Tag } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { SessionType } from '../../types/timer';
import { BackupData, UserProfile } from '../../types/user';
import { CoffeeCup } from '../../types/coffee';
import { isSampleSessionId } from '../../services/repository/SessionRepository';
import {
  broadcastCoffeeCups,
  broadcastTags,
  broadcastReset,
} from '../../services/timer/TimerBroadcast';
import { isProduction } from '../../utils/environment';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
} from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';

const BACKUP_CHUNK_SIZE = 400;

interface UseBackupAndMigrationParams {
  isEffectiveAuthenticated: boolean;
  profile: ReturnType<typeof useAuthProfile>['profile'];
  settings: ReturnType<typeof useAuthProfile>['settings'];
  updateProfile: ReturnType<typeof useAuthProfile>['updateProfile'];
  updateSettings: ReturnType<typeof useAuthProfile>['updateSettings'];
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
}

export function useBackupAndMigration({
  isEffectiveAuthenticated,
  profile,
  settings,
  updateProfile,
  updateSettings,
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
}: UseBackupAndMigrationParams) {
  const {
    isConvexConfigured,
    convexUser,
    convexCoffee,
    convexSessions,
    mutations: convexMutations,
  } = convexSync;

  const hasMigratedToCloudRef = useRef<boolean>(false);

  // Helper to send backup payloads to Convex in bounded chunks (<= 400 items per mutation)
  const syncBackupToConvexChunked = useCallback(
    async (
      mode: 'merge' | 'replace',
      tagsToSync: Array<{ id?: string; name: string; color: string; isArchived?: boolean }>,
      sessionsToSync: Array<{
        id?: string;
        tagId?: string | null;
        sessionType: 'WORK' | 'SHORT_BREAK' | 'LONG_BREAK';
        durationSeconds: number;
        completedAt: string;
      }>,
      cupsToSync: Array<{
        id?: string;
        date: string;
        tagId?: string | null;
        createdAt?: string;
      }>
    ) => {
      // Never sync sample or seed data to Convex
      const cleanSessions = sessionsToSync.filter((s) => !isSampleSessionId(s.id));
      const cleanCups = cupsToSync.filter((c) => !isSampleSessionId(c.id));

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
          tags: i === 0 ? tagsToSync : [],
          sessions: sessionSlice,
          coffeeCups: cupSlice,
        });
      }
    },
    [convexMutations]
  );

  // Background migration of local offline data to Convex upon first login/load
  useEffect(() => {
    if (!isEffectiveAuthenticated || !isConvexConfigured) {
      hasMigratedToCloudRef.current = false;
      return;
    }

    if (hasMigratedToCloudRef.current) return;
    if (convexUser === undefined || convexSessions === undefined || convexCoffee === undefined) {
      return;
    }

    hasMigratedToCloudRef.current = true;

    (async () => {
      try {
        // First purge any dev sample sessions from local storage before inspecting local data
        const [localSessions, localCoffee, localTags] = await Promise.all([
          sessionRepository.purgeSampleSessions(),
          coffeeRepository.getAll(),
          tagRepository.getAll(),
        ]);

        const remoteSessionTimes = Array.isArray(convexSessions)
          ? convexSessions.map((s) => ({
              sessionType: s.sessionType,
              completedAt: s.completedAt,
              ms: new Date(s.completedAt).getTime(),
            }))
          : [];
        const missingSessions = Array.isArray(convexSessions)
          ? localSessions.filter((s) => {
              if (isSampleSessionId(s.id)) {
                return false;
              }
              const sMs = new Date(s.completedAt).getTime();
              return !remoteSessionTimes.some(
                (r) =>
                  r.completedAt === s.completedAt ||
                  (r.sessionType === s.sessionType &&
                    !isNaN(sMs) &&
                    !isNaN(r.ms) &&
                    Math.abs(r.ms - sMs) <= 45000)
              );
            })
          : [];

        const remoteCupTimes = new Set(
          Array.isArray(convexCoffee) ? convexCoffee.map((c) => c.createdAt) : []
        );
        const missingCups = Array.isArray(convexCoffee)
          ? localCoffee.filter((c) => !isSampleSessionId(c.id) && !remoteCupTimes.has(c.createdAt))
          : [];

        const remoteTagByName = new Map(
          (convexUser?.tags || []).map((t) => [t.name.toLowerCase().trim(), t.id])
        );
        const remoteTagIds = new Set((convexUser?.tags || []).map((t) => t.id));
        const localTagIdRemap = new Map<string, string>();
        localTags.forEach((t) => {
          const remoteId = remoteTagByName.get(t.name.toLowerCase().trim());
          if (remoteId) {
            localTagIdRemap.set(t.id, remoteId);
          } else {
            localTagIdRemap.set(t.id, t.id);
          }
        });

        const missingTags = localTags.filter(
          (t) => !remoteTagByName.has(t.name.toLowerCase().trim())
        );

        const resolveMigratedTagId = (rawTagId?: string | null): string | undefined => {
          if (!rawTagId) return undefined;
          const mapped = localTagIdRemap.get(rawTagId) ?? rawTagId;
          if (remoteTagIds.has(mapped) || missingTags.some((t) => t.id === mapped)) {
            return mapped;
          }
          return undefined;
        };

        if (missingSessions.length > 0 || missingCups.length > 0 || missingTags.length > 0) {
          await syncBackupToConvexChunked(
            'merge',
            localTags.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              isArchived: t.isArchived,
            })),
            missingSessions.map((s) => ({
              id: s.id,
              tagId: resolveMigratedTagId(s.tagId),
              sessionType: s.sessionType,
              durationSeconds: s.durationSeconds,
              completedAt: s.completedAt,
            })),
            missingCups.map((c) => ({
              id: c.id,
              date: c.date,
              tagId: resolveMigratedTagId(c.tagId),
              createdAt: c.createdAt,
            }))
          );
        }
      } catch (err) {
        console.warn('Initial local-to-Convex migration check failed', err);
      }
    })();
  }, [
    isEffectiveAuthenticated,
    isConvexConfigured,
    convexUser,
    convexSessions,
    convexCoffee,
    syncBackupToConvexChunked,
  ]);

  const exportBackup = useCallback((): BackupData => {
    // Always exclude dev sample/seed sessions from exported backups so they can never pollute a real profile
    const cleanSessions = sessions.filter((s) => !isSampleSessionId(s.id));
    const sortedSessions = [...cleanSessions].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    const sortedCoffee = [...coffeeCups].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return {
      version: '3.0.0',
      exportedAt: new Date().toISOString(),
      profile,
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
      const rawTags = Array.isArray(data.tags) ? data.tags : [];
      const validTags: Tag[] = rawTags
        .filter((t: any) => t && typeof t.name === 'string' && t.name.trim().length > 0)
        .map((t: any) => ({
          id:
            typeof t.id === 'string' && t.id.trim().length > 0
              ? t.id
              : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: t.name.trim(),
          color: typeof t.color === 'string' && t.color.trim().length > 0 ? t.color : '#3B82F6',
          isArchived: typeof t.isArchived === 'boolean' ? t.isArchived : Boolean(t.is_archived),
          createdAt:
            typeof t.createdAt === 'string'
              ? t.createdAt
              : typeof t.created_at === 'string'
              ? t.created_at
              : new Date().toISOString(),
          updatedAt:
            typeof t.updatedAt === 'string'
              ? t.updatedAt
              : typeof t.updated_at === 'string'
              ? t.updated_at
              : new Date().toISOString(),
        }));

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
          return {
            id:
              typeof s.id === 'string' && s.id.trim().length > 0
                ? s.id
                : `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            tagId: tag || null,
            sessionType: type,
            durationSeconds: duration,
            completedAt: completed,
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
        .map((c: any) => {
          const date = c.date;
          const tag = c.tagId !== undefined ? c.tagId : c.tag_id !== undefined ? c.tag_id : null;
          const createdAt =
            typeof c.createdAt === 'string'
              ? c.createdAt
              : typeof c.created_at === 'string'
              ? c.created_at
              : `${date}T12:00:00.000Z`;
          return {
            id:
              typeof c.id === 'string' && c.id.trim().length > 0
                ? c.id
                : `cup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            date,
            tagId: tag || null,
            createdAt,
          };
        });

      let finalTags: Tag[] = [];
      let finalSessions: CompletedSession[] = [];
      let finalCoffee: CoffeeCup[] = [];
      let sessionsAdded = 0;
      let tagsAdded = 0;
      let coffeeAdded = 0;

      if (mode === 'replace') {
        await sessionRepository.clear();
        await coffeeRepository.clear();

        finalTags = validTags.length > 0 ? validTags : await tagRepository.resetToDefaults();
        finalSessions = [...validSessions].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
        finalCoffee = [...validCoffee].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        await tagRepository.saveAll(finalTags);
        await sessionRepository.saveAll(finalSessions);
        await coffeeRepository.saveAll(finalCoffee);

        setTags(finalTags);
        setSessions(finalSessions);
        setCoffeeCups(finalCoffee);

        broadcastTags(finalTags);
        broadcastCoffeeCups(finalCoffee);

        sessionsAdded = finalSessions.length;
        tagsAdded = finalTags.length;
        coffeeAdded = finalCoffee.length;
      } else {
        const existingTagIds = new Set(tags.map((t) => t.id));
        const existingTagNames = new Set(tags.map((t) => t.name.toLowerCase().trim()));
        const newTagsToKeep: Tag[] = [];

        for (const t of validTags) {
          const nameKey = t.name.toLowerCase().trim();
          if (!existingTagIds.has(t.id) && !existingTagNames.has(nameKey)) {
            newTagsToKeep.push(t);
            existingTagIds.add(t.id);
            existingTagNames.add(nameKey);
            tagsAdded++;
          }
        }
        finalTags = [...tags, ...newTagsToKeep];
        await tagRepository.saveAll(finalTags);
        setTags(finalTags);
        broadcastTags(finalTags);

        const baseSessions = (isProduction() || isEffectiveAuthenticated)
          ? sessions.filter((s) => !isSampleSessionId(s.id))
          : sessions;
        const existingSessionIds = new Set(baseSessions.map((s) => s.id));
        const existingSessionKeys = new Set(
          baseSessions.map((s) => `${s.sessionType}-${s.completedAt}`)
        );
        const newSessionsToKeep: CompletedSession[] = [];

        for (const s of validSessions) {
          const sessionKey = `${s.sessionType}-${s.completedAt}`;
          if (!existingSessionIds.has(s.id) && !existingSessionKeys.has(sessionKey)) {
            newSessionsToKeep.push(s);
            existingSessionIds.add(s.id);
            existingSessionKeys.add(sessionKey);
            sessionsAdded++;
          }
        }
        finalSessions = [...baseSessions, ...newSessionsToKeep].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
        await sessionRepository.saveAll(finalSessions);
        setSessions(finalSessions);

        const existingCupIds = new Set(coffeeCups.map((c) => c.id));
        const existingCupKeys = new Set(coffeeCups.map((c) => `${c.date}-${c.createdAt}`));
        const newCoffeeToKeep: CoffeeCup[] = [];

        for (const c of validCoffee) {
          const cupKey = `${c.date}-${c.createdAt}`;
          if (!existingCupIds.has(c.id) && !existingCupKeys.has(cupKey)) {
            newCoffeeToKeep.push(c);
            existingCupIds.add(c.id);
            existingCupKeys.add(cupKey);
            coffeeAdded++;
          }
        }
        finalCoffee = [...coffeeCups, ...newCoffeeToKeep].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        await coffeeRepository.saveAll(finalCoffee);
        setCoffeeCups(finalCoffee);
        broadcastCoffeeCups(finalCoffee);
      }

      if (data.settings) {
        await updateSettings(data.settings);
      }
      if (data.profile) {
        const safeProfileUpdate: Partial<UserProfile> = {
          displayName: data.profile.displayName,
          avatarEmoji: data.profile.avatarEmoji,
          dailyGoalMinutes: data.profile.dailyGoalMinutes,
        };
        if (!isEffectiveAuthenticated && data.profile.avatarUrl) {
          safeProfileUpdate.avatarUrl = data.profile.avatarUrl;
        }
        await updateProfile(safeProfileUpdate);
      }

      if (isConvexConfigured && isEffectiveAuthenticated) {
        syncBackupToConvexChunked(
          mode,
          validTags.map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            isArchived: t.isArchived,
          })),
          validSessions.map((s) => ({
            id: s.id,
            tagId: s.tagId || undefined,
            sessionType: s.sessionType,
            durationSeconds: s.durationSeconds,
            completedAt: s.completedAt,
          })),
          validCoffee.map((c) => ({
            id: c.id,
            date: c.date,
            tagId: c.tagId || undefined,
            createdAt: c.createdAt,
          }))
        ).catch(console.warn);
      }

      return {
        sessionsAdded,
        tagsAdded,
        coffeeAdded,
      };
    },
    [
      isEffectiveAuthenticated,
      isConvexConfigured,
      tags,
      sessions,
      coffeeCups,
      updateSettings,
      updateProfile,
      syncBackupToConvexChunked,
      setTags,
      setSessions,
      setCoffeeCups,
    ]
  );

  const resetAllData = useCallback(
    async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
      broadcastReset(scope);
      if (scope === 'sessions-only') {
        await sessionRepository.clear();
        await coffeeRepository.clear();
        setSessions([]);
        setCoffeeCups([]);
        if (isConvexConfigured && isEffectiveAuthenticated) {
          convexMutations.clearSessions({}).catch(console.warn);
          convexMutations.clearCoffee({}).catch(console.warn);
        }
      } else {
        await sessionRepository.clear();
        await coffeeRepository.clear();
        const defaultTags = await tagRepository.resetToDefaults();
        await resetSettingsToDefaults();
        await resetProfileToDefaults();

        setSessions([]);
        setCoffeeCups([]);
        setTags(defaultTags);
        setActiveTagId(defaultTags[0]?.id || null);

        if (isConvexConfigured && isEffectiveAuthenticated) {
          convexMutations.clearSessions({}).catch(console.warn);
          convexMutations.clearCoffee({}).catch(console.warn);
          convexMutations.resetTags({}).catch(console.warn);
        }
      }
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
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
