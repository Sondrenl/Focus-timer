import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { SessionType } from '../types/timer';
import { BackupData, UserProfile } from '../types/user';
import { CoffeeCup } from '../types/coffee';
import { isSampleSessionId } from '../services/repository/SessionRepository';
import {
  broadcastCoffeeCups,
  subscribeCoffeeCups,
  broadcastTags,
  subscribeTags,
  broadcastSession,
  subscribeSessions,
  broadcastReset,
} from '../services/timer/TimerBroadcast';
import { isPreviewOrDev, isProduction } from '../utils/environment';
import { toDateKey } from '../utils/dates';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
} from './services';
import { useAuthProfile } from './AuthProfileContext';

export interface DataContextValue {
  isDemoEnvironment: boolean;
  reloadSampleData: () => Promise<void>;
  tags: Tag[];
  activeTags: Tag[];
  activeTagId: string | null;
  setActiveTagId: (id: string | null) => void;
  createTag: (input: CreateTagInput) => Promise<Tag>;
  updateTag: (id: string, updates: UpdateTagInput) => Promise<Tag | null>;
  archiveTag: (id: string) => Promise<Tag | null>;
  unarchiveTag: (id: string) => Promise<Tag | null>;
  deleteTag: (id: string) => Promise<boolean>;
  sessions: CompletedSession[];
  recordSession: (session: Omit<CompletedSession, 'id'> & { id?: string }) => Promise<CompletedSession>;
  clearSessions: () => Promise<void>;
  coffeeCups: CoffeeCup[];
  addCoffeeCup: (tagId: string | null, date?: string) => Promise<CoffeeCup>;
  removeCoffeeCup: (date?: string, tagId?: string | null, cupId?: string) => Promise<boolean>;
  exportBackup: () => BackupData;
  importBackup: (
    data: BackupData,
    mode: 'merge' | 'replace'
  ) => Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded: number }>;
  resetAllData: (scope: 'sessions-only' | 'factory-reset') => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

const BACKUP_CHUNK_SIZE = 400;

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    isEffectiveAuthenticated,
    profile,
    settings,
    updateProfile,
    updateSettings,
    resetProfileToDefaults,
    resetSettingsToDefaults,
    convexSync,
  } = useAuthProfile();

  const {
    isConvexConfigured,
    convexUser,
    convexCoffee,
    convexSessions,
    mutations: convexMutations,
  } = convexSync;

  const [tags, setTags] = useState<Tag[]>([]);
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [coffeeCups, setCoffeeCups] = useState<CoffeeCup[]>([]);

  const pendingAddsRef = useRef<Map<string, CoffeeCup>>(new Map());
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const hasMigratedLocalToConvexRef = useRef<boolean>(false);

  const [activeTagId, setActiveTagIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('active_tag_id_v1') || null;
    } catch {
      return null;
    }
  });

  const setActiveTagId = useCallback((id: string | null) => {
    setActiveTagIdState(id);
    try {
      if (id) {
        localStorage.setItem('active_tag_id_v1', id);
      } else {
        localStorage.removeItem('active_tag_id_v1');
      }
    } catch {
      // Ignore storage error
    }
  }, []);

  const isDemo = useMemo(() => isPreviewOrDev(), []);

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

  // Initial load from local storage
  useEffect(() => {
    async function initData() {
      const [loadedTags, loadedSessions, loadedCoffee] = await Promise.all([
        tagRepository.getAll(),
        sessionRepository.getAll(),
        coffeeRepository.getAll(),
      ]);

      // If production OR authenticated with a real account, purge any dev sample sessions immediately
      const shouldPurgeSample = isProduction() || isEffectiveAuthenticated;
      const cleanSessions = shouldPurgeSample
        ? loadedSessions.filter((s) => !isSampleSessionId(s.id))
        : loadedSessions;

      setTags(loadedTags);
      setSessions(cleanSessions);
      setCoffeeCups(loadedCoffee);

      if (shouldPurgeSample && cleanSessions.length !== loadedSessions.length) {
        await sessionRepository.purgeSampleSessions();
      }

      let storedTagId: string | null = null;
      try {
        storedTagId = localStorage.getItem('active_tag_id_v1');
      } catch {
        storedTagId = null;
      }

      if (storedTagId && loadedTags.some((t) => t.id === storedTagId && !t.isArchived)) {
        setActiveTagId(storedTagId);
      } else {
        const firstActive = loadedTags.find((t) => !t.isArchived);
        if (firstActive) {
          setActiveTagId(firstActive.id);
        }
      }
    }

    initData();
  }, []);

  // Immediately purge dev sample sessions whenever a user signs in so sample data never leaks into their account
  useEffect(() => {
    if (!isEffectiveAuthenticated) return;
    sessionRepository.purgeSampleSessions().then((clean) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => !isSampleSessionId(s.id));
        return filtered.length !== prev.length ? clean : prev;
      });
    });
  }, [isEffectiveAuthenticated]);

  // Background migration of local offline data to Convex upon first login/load
  useEffect(() => {
    if (!isEffectiveAuthenticated || !isConvexConfigured) {
      hasMigratedLocalToConvexRef.current = false;
      return;
    }

    if (hasMigratedLocalToConvexRef.current) return;
    if (convexUser === undefined || convexSessions === undefined || convexCoffee === undefined) {
      return;
    }

    hasMigratedLocalToConvexRef.current = true;

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

  // Reactive adoption of Convex tags
  useEffect(() => {
    if (!isEffectiveAuthenticated || !convexUser) return;
    if (Array.isArray(convexUser.tags)) {
      const nextTags = convexUser.tags as Tag[];
      setTags((prev) => {
        if (
          prev.length === nextTags.length &&
          prev.every(
            (t, i) =>
              t.id === nextTags[i].id &&
              t.name === nextTags[i].name &&
              t.color === nextTags[i].color &&
              t.isArchived === nextTags[i].isArchived
          )
        ) {
          return prev;
        }
        tagRepository.saveAll(nextTags);
        return nextTags;
      });
    }
  }, [convexUser, isEffectiveAuthenticated]);

  // Reactive adoption of Convex coffee cups
  useEffect(() => {
    if (!isEffectiveAuthenticated || !Array.isArray(convexCoffee)) return;

    const serverCups = convexCoffee as CoffeeCup[];
    const pendingDeletes = pendingDeletesRef.current;
    const pendingAdds = Array.from(pendingAddsRef.current.values());

    const remainingServer = serverCups.filter((c) => !pendingDeletes.has(c.id));
    const serverIds = new Set(remainingServer.map((c) => c.id));
    const serverCreatedTimes = new Set(remainingServer.map((c) => c.createdAt));

    const unconfirmedAdds = pendingAdds.filter(
      (a) => !serverIds.has(a.id) && !serverCreatedTimes.has(a.createdAt)
    );

    const merged = [...remainingServer, ...unconfirmedAdds].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    setCoffeeCups((prev) => {
      if (
        prev.length === merged.length &&
        prev.every(
          (c, i) =>
            c.id === merged[i].id &&
            c.date === merged[i].date &&
            c.tagId === merged[i].tagId &&
            c.createdAt === merged[i].createdAt
        )
      ) {
        return prev;
      }
      coffeeRepository.saveAll(merged);
      return merged;
    });
  }, [convexCoffee, isEffectiveAuthenticated]);

  // Reactive adoption of Convex sessions
  useEffect(() => {
    if (!isEffectiveAuthenticated || !Array.isArray(convexSessions)) return;
    const sorted = [...(convexSessions as CompletedSession[])].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    setSessions((prev) => {
      if (
        prev.length === sorted.length &&
        prev.every(
          (s, i) =>
            s.id === sorted[i].id &&
            s.sessionType === sorted[i].sessionType &&
            s.durationSeconds === sorted[i].durationSeconds &&
            s.completedAt === sorted[i].completedAt &&
            s.tagId === sorted[i].tagId
        )
      ) {
        return prev;
      }
      sessionRepository.saveAll(sorted);
      return sorted;
    });
  }, [convexSessions, isEffectiveAuthenticated]);

  // Multi-tab BroadcastChannel synchronization
  useEffect(() => {
    const unsubCoffee = subscribeCoffeeCups((cups) => {
      coffeeRepository.saveAll(cups);
      setCoffeeCups(cups);
    });
    const unsubTags = subscribeTags((incomingTags) => {
      tagRepository.saveAll(incomingTags);
      setTags(incomingTags);
    });
    const unsubSessions = subscribeSessions((incomingSession) => {
      sessionRepository.add(incomingSession);
      setSessions((prev) => {
        if (prev.some((s) => s.id === incomingSession.id)) return prev;
        return [...prev, incomingSession].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
      });
    });
    return () => {
      unsubCoffee();
      unsubTags();
      unsubSessions();
    };
  }, []);

  // Tag Operations
  const createTag = useCallback(
    async (input: CreateTagInput): Promise<Tag> => {
      const created = await tagRepository.create(input);
      const updated = await tagRepository.getAll();
      setTags(updated);
      setActiveTagId(created.id);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .createTag({
            id: created.id,
            name: input.name,
            color: input.color,
          })
          .catch(console.warn);
      }
      return created;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations, setActiveTagId]
  );

  const updateTag = useCallback(
    async (id: string, updates: UpdateTagInput): Promise<Tag | null> => {
      const result = await tagRepository.update(id, updates);
      const updated = await tagRepository.getAll();
      setTags(updated);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .updateTag({
            id,
            name: updates.name,
            color: updates.color,
            isArchived: updates.isArchived,
          })
          .catch(console.warn);
      }
      return result;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const archiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      const result = await tagRepository.archive(id);
      const updated = await tagRepository.getAll();
      setTags(updated);
      if (activeTagId === id) {
        const nextActive = updated.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null);
      }
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations.updateTag({ id, isArchived: true }).catch(console.warn);
      }
      return result;
    },
    [activeTagId, setActiveTagId, isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const unarchiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      const result = await tagRepository.unarchive(id);
      const updated = await tagRepository.getAll();
      setTags(updated);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations.updateTag({ id, isArchived: false }).catch(console.warn);
      }
      return result;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const deleteTag = useCallback(
    async (id: string): Promise<boolean> => {
      const success = await tagRepository.delete(id);

      const currentSessions = await sessionRepository.getAll();
      const updatedSessions = currentSessions.map((s) =>
        s.tagId === id ? { ...s, tagId: null } : s
      );
      await sessionRepository.saveAll(updatedSessions);
      setSessions(updatedSessions);

      const currentCoffee = await coffeeRepository.getAll();
      const updatedCoffee = currentCoffee.map((cup) =>
        cup.tagId === id ? { ...cup, tagId: null } : cup
      );
      await coffeeRepository.saveAll(updatedCoffee);
      setCoffeeCups(updatedCoffee);
      broadcastCoffeeCups(updatedCoffee);

      const updatedTags = await tagRepository.getAll();
      setTags(updatedTags);
      if (activeTagId === id) {
        const nextActive = updatedTags.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null);
      }
      broadcastTags(updatedTags);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations.removeTag({ id }).catch(console.warn);
      }
      return success;
    },
    [activeTagId, setActiveTagId, isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  // Coffee Operations
  const addCoffeeCup = useCallback(
    async (tagId: string | null, dateStr?: string): Promise<CoffeeCup> => {
      const today = dateStr || toDateKey(new Date());
      const created = await coffeeRepository.addCup(today, tagId);

      pendingAddsRef.current.set(created.id, created);

      const updated = await coffeeRepository.getAll();
      const sortedUpdated = [...updated].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setCoffeeCups(sortedUpdated);
      broadcastCoffeeCups(sortedUpdated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .addCup({
            date: today,
            tagId: tagId || undefined,
            createdAt: created.createdAt,
          })
          .then((serverCup) => {
            pendingAddsRef.current.delete(created.id);
            if (serverCup && serverCup.id) {
              setCoffeeCups((prev) =>
                prev.map((c) => (c.id === created.id ? { ...c, id: serverCup.id } : c))
              );
              coffeeRepository.getAll().then((all) => {
                const withServerId = all.map((c) =>
                  c.id === created.id ? { ...c, id: serverCup.id } : c
                );
                coffeeRepository.saveAll(withServerId);
              });
            }
          })
          .catch((err) => {
            pendingAddsRef.current.delete(created.id);
            console.warn('Convex addCup error:', err);
          });
      }
      return created;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const removeCoffeeCup = useCallback(
    async (dateStr?: string, tagId?: string | null, cupId?: string): Promise<boolean> => {
      const today = dateStr || toDateKey(new Date());
      const removedCup = await coffeeRepository.removeCup(today, tagId, cupId);
      if (removedCup) {
        pendingDeletesRef.current.add(removedCup.id);

        const updated = await coffeeRepository.getAll();
        const sortedUpdated = [...updated].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        setCoffeeCups(sortedUpdated);
        broadcastCoffeeCups(sortedUpdated);

        if (isConvexConfigured && isEffectiveAuthenticated) {
          convexMutations
            .removeCup({
              id: removedCup.id,
              date: today,
              tagId: tagId || undefined,
            })
            .finally(() => {
              pendingDeletesRef.current.delete(removedCup.id);
            })
            .catch((err) => {
              console.warn('Convex removeCup error:', err);
            });
        }
        return true;
      }
      return false;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  // Session Operations
  const recordSession = useCallback(
    async (sessionData: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> => {
      const created = await sessionRepository.add(sessionData);
      setSessions((prev) => {
        if (prev.some((s) => s.id === created.id)) return prev;
        return [
          ...prev.filter((s) => !isSampleSessionId(s.id)),
          created,
        ];
      });
      broadcastSession(created);

      if (isConvexConfigured && isEffectiveAuthenticated && !isSampleSessionId(created.id)) {
        convexMutations
          .recordSession({
            tagId: sessionData.tagId || undefined,
            sessionType: sessionData.sessionType,
            durationSeconds: sessionData.durationSeconds,
            completedAt: created.completedAt,
          })
          .then((serverSession) => {
            if (serverSession && serverSession.id) {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === created.id
                    ? { ...s, id: serverSession.id, completedAt: serverSession.completedAt }
                    : s
                )
              );
              sessionRepository.getAll().then((all) => {
                const updated = all.map((s) =>
                  s.id === created.id
                    ? { ...s, id: serverSession.id, completedAt: serverSession.completedAt }
                    : s
                );
                sessionRepository.saveAll(updated);
              });
            }
          })
          .catch(console.warn);
      }
      return created;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const clearSessions = useCallback(async (): Promise<void> => {
    await sessionRepository.clear();
    setSessions([]);
    if (isConvexConfigured && isEffectiveAuthenticated) {
      convexMutations.clearSessions({}).catch(console.warn);
    }
  }, [isConvexConfigured, isEffectiveAuthenticated, convexMutations]);

  // Sample data is strictly allowed ONLY on non-production builds when NOT signed into a real account
  const reloadSampleData = useCallback(async (): Promise<void> => {
    if (isProduction() || isEffectiveAuthenticated) return;
    const samples = await sessionRepository.loadSampleData();
    setSessions(samples);
  }, [isEffectiveAuthenticated]);

  // Export / Import / Reset
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
    ]
  );

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  const value = useMemo<DataContextValue>(
    () => ({
      isDemoEnvironment: isDemo,
      reloadSampleData,
      tags,
      activeTags,
      activeTagId,
      setActiveTagId,
      createTag,
      updateTag,
      archiveTag,
      unarchiveTag,
      deleteTag,
      sessions,
      recordSession,
      clearSessions,
      coffeeCups,
      addCoffeeCup,
      removeCoffeeCup,
      exportBackup,
      importBackup,
      resetAllData,
    }),
    [
      isDemo,
      reloadSampleData,
      tags,
      activeTags,
      activeTagId,
      setActiveTagId,
      createTag,
      updateTag,
      archiveTag,
      unarchiveTag,
      deleteTag,
      sessions,
      recordSession,
      clearSessions,
      coffeeCups,
      addCoffeeCup,
      removeCoffeeCup,
      exportBackup,
      importBackup,
      resetAllData,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = (): DataContextValue => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
