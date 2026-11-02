import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { SessionType } from '../types/timer';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { UserProfile, DEFAULT_PROFILE, BackupData, AuthState } from '../types/user';
import { CoffeeCup } from '../types/coffee';
import { CoffeeRepository } from '../services/repository/CoffeeRepository';
import { LocalStorageService } from '../services/storage/LocalStorageService';
import { TagRepository } from '../services/repository/TagRepository';
import { SessionRepository } from '../services/repository/SessionRepository';
import { SettingsRepository } from '../services/repository/SettingsRepository';
import { ProfileRepository } from '../services/repository/ProfileRepository';
import { AuthService, parseGoogleJwt, buildProfileFromJwt } from '../services/auth/AuthService';
import { SoundService, soundService } from '../services/audio/SoundService';
import { NotificationService, notificationService } from '../services/notification/NotificationService';
import { useConvexSync } from '../services/convex/useConvexSync';
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

interface AppContextValue {
  // Environment
  isDemoEnvironment: boolean;
  reloadSampleData: () => Promise<void>;

  // Authentication & Cloud Sync
  auth: AuthState;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
  syncWithCloud: (force?: boolean) => Promise<void>;

  // Profile
  profile: UserProfile;
  updateProfile: (newProfile: Partial<UserProfile>) => Promise<void>;

  // Tags
  tags: Tag[];
  activeTags: Tag[];
  activeTagId: string | null;
  setActiveTagId: (id: string | null) => void;
  createTag: (input: CreateTagInput) => Promise<Tag>;
  updateTag: (id: string, updates: UpdateTagInput) => Promise<Tag | null>;
  archiveTag: (id: string) => Promise<Tag | null>;
  unarchiveTag: (id: string) => Promise<Tag | null>;
  deleteTag: (id: string) => Promise<boolean>;
  syncRemoteTags: (remoteTags: Tag[], deletedIds?: string[]) => Promise<void>;

  // Sessions
  sessions: CompletedSession[];
  recordSession: (session: Omit<CompletedSession, 'id'> & { id?: string }) => Promise<CompletedSession>;
  clearSessions: () => Promise<void>;

  // Settings
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;

  // Data Import / Export / Reset
  exportBackup: () => BackupData;
  importBackup: (data: BackupData, mode: 'merge' | 'replace') => Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded: number }>;
  resetAllData: (scope: 'sessions-only' | 'factory-reset') => Promise<void>;

  // Services
  sound: SoundService;
  notifications: NotificationService;

  // Coffee Cups
  coffeeCups: CoffeeCup[];
  addCoffeeCup: (tagId: string | null, date?: string) => Promise<CoffeeCup>;
  removeCoffeeCup: (date?: string, tagId?: string | null, cupId?: string) => Promise<boolean>;
  syncRemoteCoffeeCups: (cups: CoffeeCup[], deletedIds?: string[]) => Promise<void>;

  // View Navigation
  currentView: 'timer' | 'coffee' | 'tags' | 'stats' | 'settings' | 'profile';
  setCurrentView: (view: 'timer' | 'coffee' | 'tags' | 'stats' | 'settings' | 'profile') => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// Initialize singletons for dependency injection
const storageService = new LocalStorageService();
const tagRepository = new TagRepository(storageService);
const sessionRepository = new SessionRepository(storageService);
const settingsRepository = new SettingsRepository(storageService);
const profileRepository = new ProfileRepository(storageService);
const coffeeRepository = new CoffeeRepository(storageService);
const authService = AuthService.getInstance();



export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const profileRef = useRef<UserProfile>(profile);
  profileRef.current = profile;

  const lastLocalSettingsEditMsRef = useRef<number>(0);
  const lastLocalProfileEditMsRef = useRef<number>(0);
  const pendingAddsRef = useRef<Map<string, CoffeeCup>>(new Map());
  const pendingDeletesRef = useRef<Set<string>>(new Set());



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
      // Storage errors ignored
    }
  }, []);
  const [coffeeCups, setCoffeeCups] = useState<CoffeeCup[]>([]);
  const [currentView, setCurrentView] = useState<'timer' | 'coffee' | 'tags' | 'stats' | 'settings' | 'profile'>('timer');
  const [auth, setAuth] = useState<AuthState>(() => authService.getInitialAuthState());

  const isDemo = useMemo(() => isPreviewOrDev(), []);

  // Convex Reactive Hooks & Mutations
  const {
    isConvexConfigured,
    convexUser,
    convexCoffee,
    convexSessions,
    setAuthToken,
    mutations: convexMutations,
  } = useConvexSync(auth.isAuthenticated);

  const hasMigratedLocalToConvexRef = useRef<boolean>(false);

  // Background migration of local offline data to Convex upon first login/load
  useEffect(() => {
    if (!auth.isAuthenticated || !isConvexConfigured) {
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
        const [localSessions, localCoffee, localTags] = await Promise.all([
          sessionRepository.getAll(),
          coffeeRepository.getAll(),
          tagRepository.getAll(),
        ]);

        const remoteCompletedTimes = new Set(
          Array.isArray(convexSessions) ? convexSessions.map((s) => s.completedAt) : []
        );
        const missingSessions = Array.isArray(convexSessions)
          ? localSessions.filter(
              (s) =>
                !s.id.startsWith('seed-session-') &&
                !s.id.startsWith('sample-session-') &&
                !remoteCompletedTimes.has(s.completedAt)
            )
          : [];

        const remoteCupTimes = new Set(
          Array.isArray(convexCoffee) ? convexCoffee.map((c) => c.createdAt) : []
        );
        const missingCups = Array.isArray(convexCoffee)
          ? localCoffee.filter((c) => !remoteCupTimes.has(c.createdAt))
          : [];

        const remoteTagNames = new Set(
          (convexUser?.tags || []).map((t) => t.name.toLowerCase().trim())
        );
        const missingTags = localTags.filter(
          (t) => !remoteTagNames.has(t.name.toLowerCase().trim())
        );

        if (missingSessions.length > 0 || missingCups.length > 0 || missingTags.length > 0) {
          await convexMutations.importBackup({
            mode: 'merge',
            tags: missingTags.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              isArchived: t.isArchived,
            })),
            sessions: missingSessions.map((s) => ({
              tagId: s.tagId || undefined,
              sessionType: s.sessionType,
              durationSeconds: s.durationSeconds,
              completedAt: s.completedAt,
            })),
            coffeeCups: missingCups.map((c) => ({
              date: c.date,
              tagId: c.tagId || undefined,
              createdAt: c.createdAt,
            })),
          });
        }
      } catch (err) {
        console.warn('Initial local-to-Convex migration check failed', err);
      }
    })();
  }, [auth.isAuthenticated, isConvexConfigured, convexUser, convexSessions, convexCoffee, convexMutations]);

  // Reactive adoption of Convex state (only for authenticated cloud users)
  useEffect(() => {
    if (!auth.isAuthenticated || !convexUser) return;
    if (convexUser.tags && convexUser.tags.length > 0) {
      setTags(convexUser.tags as Tag[]);
      tagRepository.saveAll(convexUser.tags as Tag[]);
    }
    if (convexUser.settings) {
      setSettings(convexUser.settings);
      settingsRepository.save(convexUser.settings);
    }
    const updatedProfile: UserProfile = {
      ...profileRef.current,
      id: convexUser.id,
      email: convexUser.email,
      displayName: convexUser.displayName,
      avatarUrl: convexUser.avatarUrl,
      avatarEmoji: convexUser.avatarEmoji,
      dailyGoalMinutes: convexUser.dailyGoalMinutes,
    };
    setProfile(updatedProfile);
    profileRepository.save(updatedProfile);
  }, [convexUser, auth.isAuthenticated]);

  useEffect(() => {
    if (!auth.isAuthenticated || !Array.isArray(convexCoffee)) return;

    const serverCups = convexCoffee as CoffeeCup[];
    const pendingDeletes = pendingDeletesRef.current;
    const pendingAdds = Array.from(pendingAddsRef.current.values());

    // Exclude cups deleted locally that haven't been committed by the server snapshot yet
    const remainingServer = serverCups.filter((c) => !pendingDeletes.has(c.id));

    // Preserve cups added locally that haven't appeared in the server snapshot yet
    const serverIds = new Set(remainingServer.map((c) => c.id));
    const serverCreatedTimes = new Set(remainingServer.map((c) => c.createdAt));

    const unconfirmedAdds = pendingAdds.filter(
      (a) => !serverIds.has(a.id) && !serverCreatedTimes.has(a.createdAt)
    );

    const merged = [...remainingServer, ...unconfirmedAdds].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    setCoffeeCups(merged);
    coffeeRepository.saveAll(merged);
  }, [convexCoffee, auth.isAuthenticated]);

  useEffect(() => {
    if (!auth.isAuthenticated || !Array.isArray(convexSessions)) return;
    const sorted = [...(convexSessions as CompletedSession[])].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    setSessions(sorted);
    sessionRepository.saveAll(sorted);
  }, [convexSessions, auth.isAuthenticated]);

  // Stubs for cross-component compatibility
  const syncRemoteTags = useCallback(async (_remoteTags: Tag[], _remoteDeletedIds?: string[]) => {}, []);
  const syncRemoteCoffeeCups = useCallback(async (_remoteCups: CoffeeCup[], _remoteDeletedIds?: string[]) => {}, []);

  // Synchronize cloud status indicator
  const syncWithCloud = useCallback(async (_force = false): Promise<void> => {
    if (auth.isAuthenticated) {
      setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
      setTimeout(() => {
        setAuth((prev) => ({
          ...prev,
          isSyncing: false,
          lastSyncedAt: new Date().toISOString(),
        }));
      }, 300);
    }
  }, [auth.isAuthenticated]);

  // Multi-tab coffee, tag, and completed session broadcast synchronization
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

  // Google Sign In
  const loginWithGoogle = async (idToken: string): Promise<void> => {
    setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));
    try {
      const payload = parseGoogleJwt(idToken);
      if (!payload || !payload.sub) {
        throw new Error('Invalid Google identity token');
      }

      const user = buildProfileFromJwt(payload, profileRef.current);
      authService.saveAuthSession(idToken, user);

      if (isConvexConfigured) {
        setAuthToken(idToken);
      }

      notificationService.setAuthToken(idToken);
      setAuth({
        isAuthenticated: true,
        user,
        token: idToken,
        isSyncing: false,
        lastSyncedAt: null,
        syncError: null,
      });

      // Update local profile with Google identity and auto-activate Google avatar
      const updatedProfile: UserProfile = {
        ...profileRef.current,
        id: user.id,
        email: user.email,
        avatarUrl: user.avatarUrl,
        avatarEmoji: '',
        displayName: user.displayName || profileRef.current.displayName,
      };
      profileRef.current = updatedProfile;
      await profileRepository.save(updatedProfile);
      setProfile(updatedProfile);

    } catch (err) {
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: (err as Error).message || 'Google sign-in failed',
      }));
      throw err;
    }
  };

  // Sign out
  const logout = (): void => {
    pendingAddsRef.current.clear();
    pendingDeletesRef.current.clear();
    authService.logout();
    notificationService.setAuthToken(null);
    if (isConvexConfigured) {
      setAuthToken(null);
    }
    setAuth({
      isAuthenticated: false,
      user: null,
      token: null,
      isSyncing: false,
      lastSyncedAt: null,
      syncError: null,
    });
    const cleanedProfile: UserProfile = {
      ...DEFAULT_PROFILE,
      dailyGoalMinutes: profileRef.current.dailyGoalMinutes || DEFAULT_PROFILE.dailyGoalMinutes,
      createdAt: profileRef.current.createdAt || new Date().toISOString(),
    };
    profileRef.current = cleanedProfile;
    profileRepository.save(cleanedProfile);
    setProfile(cleanedProfile);
  };

  // Load initial local data and verify cloud auth on mount
  useEffect(() => {
    async function init() {
      const [loadedProfile, loadedTags, loadedSessions, loadedSettings, loadedCoffee] = await Promise.all([
        profileRepository.get(),
        tagRepository.getAll(),
        sessionRepository.getAll(),
        settingsRepository.get(),
        coffeeRepository.getAll(),
      ]);

      const cleanSessions = isProduction()
        ? loadedSessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-'))
        : loadedSessions;
      profileRef.current = loadedProfile;
      settingsRef.current = loadedSettings;
      setProfile(loadedProfile);
      setTags(loadedTags);
      setSessions(cleanSessions);
      setSettings(loadedSettings);
      setCoffeeCups(loadedCoffee);

      if (isProduction() && cleanSessions.length !== loadedSessions.length) {
        await sessionRepository.saveAll(cleanSessions);
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

      // If already logged in, verify session and trigger background sync
      const storedToken = authService.getStoredToken();
      let isAuthenticatedSession = false;

      if (storedToken && isConvexConfigured) {
        const payload = parseGoogleJwt(storedToken);
        if (payload && payload.sub && (!payload.exp || payload.exp * 1000 > Date.now())) {
          isAuthenticatedSession = true;
          notificationService.setAuthToken(storedToken);
          setAuthToken(storedToken);
          const verifiedUser = buildProfileFromJwt(payload, profileRef.current);
          setAuth({
            isAuthenticated: true,
            user: verifiedUser,
            token: storedToken,
            isSyncing: false,
            lastSyncedAt: null,
            syncError: null,
          });
        }
      }

      if (!isAuthenticatedSession) {
        logout();
      }
    }

    init();
  }, []);

  // Profile Operations: save locally and push directly to cloud
  const updateProfile = async (newProfile: Partial<UserProfile>): Promise<void> => {
    const editMs = Date.now();
    lastLocalProfileEditMsRef.current = editMs;
    const merged = { ...profileRef.current, ...newProfile };
    profileRef.current = merged;
    setProfile(merged);
    await profileRepository.save(merged);

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.updateProfile({
        displayName: newProfile.displayName,
        avatarEmoji: newProfile.avatarEmoji,
        dailyGoalMinutes: newProfile.dailyGoalMinutes,
      }).catch(console.warn);
    }
  };

  // Tag Operations
  const createTag = async (input: CreateTagInput): Promise<Tag> => {
    const created = await tagRepository.create(input);
    const updated = await tagRepository.getAll();
    setTags(updated);
    setActiveTagId(created.id);
    broadcastTags(updated);

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.createTag({
        id: created.id,
        name: input.name,
        color: input.color,
      }).catch(console.warn);
    }
    return created;
  };

  const updateTag = async (id: string, updates: UpdateTagInput): Promise<Tag | null> => {
    const result = await tagRepository.update(id, updates);
    const updated = await tagRepository.getAll();
    setTags(updated);
    broadcastTags(updated);

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.updateTag({
        id,
        name: updates.name,
        color: updates.color,
        isArchived: updates.isArchived,
      }).catch(console.warn);
    }
    return result;
  };

  const archiveTag = async (id: string): Promise<Tag | null> => {
    const result = await tagRepository.archive(id);
    const updated = await tagRepository.getAll();
    setTags(updated);
    if (activeTagId === id) {
      const nextActive = updated.find((t) => !t.isArchived);
      setActiveTagId(nextActive?.id ?? null);
    }
    broadcastTags(updated);

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.updateTag({ id, isArchived: true }).catch(console.warn);
    }
    return result;
  };

  const unarchiveTag = async (id: string): Promise<Tag | null> => {
    const result = await tagRepository.unarchive(id);
    const updated = await tagRepository.getAll();
    setTags(updated);
    broadcastTags(updated);

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.updateTag({ id, isArchived: false }).catch(console.warn);
    }
    return result;
  };

  const deleteTag = async (id: string): Promise<boolean> => {
    const success = await tagRepository.delete(id);

    const currentSessions = await sessionRepository.getAll();
    const updatedSessions = currentSessions.map((s) => (s.tagId === id ? { ...s, tagId: null } : s));
    await sessionRepository.saveAll(updatedSessions);
    setSessions(updatedSessions);

    const currentCoffee = await coffeeRepository.getAll();
    const updatedCoffee = currentCoffee.map((cup) => (cup.tagId === id ? { ...cup, tagId: null } : cup));
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

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.removeTag({ id }).catch(console.warn);
    }
    return success;
  };

  // Coffee Operations
  const addCoffeeCup = async (tagId: string | null, dateStr?: string): Promise<CoffeeCup> => {
    const today = dateStr || new Date().toISOString().slice(0, 10);
    const created = await coffeeRepository.addCup(today, tagId);

    // Track optimistic in-flight addition
    pendingAddsRef.current.set(created.id, created);

    const updated = await coffeeRepository.getAll();
    const sortedUpdated = [...updated].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    setCoffeeCups(sortedUpdated);
    broadcastCoffeeCups(sortedUpdated);

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations
        .addCup({
          date: today,
          tagId: tagId || undefined,
          createdAt: created.createdAt,
        })
        .then((serverCup) => {
          pendingAddsRef.current.delete(created.id);
          if (serverCup && serverCup.id) {
            // Adopt canonical Convex server ID for subsequent targeted removals
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
  };

  const removeCoffeeCup = async (dateStr?: string, tagId?: string | null, cupId?: string): Promise<boolean> => {
    const today = dateStr || new Date().toISOString().slice(0, 10);
    const removedCup = await coffeeRepository.removeCup(today, tagId, cupId);
    if (removedCup) {
      // Track optimistic in-flight deletion
      pendingDeletesRef.current.add(removedCup.id);

      const updated = await coffeeRepository.getAll();
      const sortedUpdated = [...updated].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setCoffeeCups(sortedUpdated);
      broadcastCoffeeCups(sortedUpdated);

      if (isConvexConfigured && auth.isAuthenticated) {
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
  };

  // Session Operations
  const recordSession = useCallback(
    async (sessionData: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> => {
      const created = await sessionRepository.add(sessionData);
      setSessions((prev) => {
        if (prev.some((s) => s.id === created.id)) return prev;
        return [...prev.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')), created];
      });
      broadcastSession(created);

      if (isConvexConfigured && auth.isAuthenticated) {
        convexMutations.recordSession({
          tagId: sessionData.tagId || undefined,
          sessionType: sessionData.sessionType,
          durationSeconds: sessionData.durationSeconds,
          completedAt: created.completedAt,
        }).catch(console.warn);
      }
      return created;
    },
    [isConvexConfigured, auth.isAuthenticated, convexMutations]
  );

  const clearSessions = async (): Promise<void> => {
    await sessionRepository.clear();
    setSessions([]);
    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.clearSessions({}).catch(console.warn);
    }
  };

  const reloadSampleData = async (): Promise<void> => {
    if (isProduction()) return;
    const samples = await sessionRepository.loadSampleData();
    setSessions(samples);
  };

  // Settings Operations
  const updateSettings = async (newValues: Partial<UserSettings>): Promise<void> => {
    const editMs = Date.now();
    lastLocalSettingsEditMsRef.current = editMs;
    const merged = { ...settingsRef.current, ...newValues };
    settingsRef.current = merged;
    setSettings(merged);
    await settingsRepository.save(merged);

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.updateSettings(newValues).catch(console.warn);
    }
  };

  // Data Operations (Export / Import / Reset)
  const exportBackup = (): BackupData => {
    const cleanSessions = isProduction()
      ? sessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-'))
      : sessions;
    const sortedSessions = [...cleanSessions].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    const sortedCoffee = [...coffeeCups].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return {
      version: '2.3.1',
      exportedAt: new Date().toISOString(),
      profile,
      tags,
      sessions: sortedSessions,
      coffeeCups: sortedCoffee,
      settings,
    };
  };

  const importBackup = async (
    data: BackupData,
    mode: 'merge' | 'replace'
  ): Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded: number }> => {
    // 1. Normalize and validate incoming tags (supporting both camelCase and legacy formats)
    const rawTags = Array.isArray(data.tags) ? data.tags : [];
    const validTags: Tag[] = rawTags
      .filter((t: any) => t && typeof t.name === 'string' && t.name.trim().length > 0)
      .map((t: any) => ({
        id: typeof t.id === 'string' && t.id.trim().length > 0 ? t.id : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: t.name.trim(),
        color: typeof t.color === 'string' && t.color.trim().length > 0 ? t.color : '#3B82F6',
        isArchived: typeof t.isArchived === 'boolean' ? t.isArchived : Boolean(t.is_archived),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : (typeof t.created_at === 'string' ? t.created_at : new Date().toISOString()),
        updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : (typeof t.updated_at === 'string' ? t.updated_at : new Date().toISOString()),
      }));

    // 2. Normalize and validate incoming sessions (supporting both camelCase and legacy formats)
    const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
    const validSessions: CompletedSession[] = rawSessions
      .filter((s: any) => {
        if (!s) return false;
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
        const tag = s.tagId !== undefined ? s.tagId : (s.tag_id !== undefined ? s.tag_id : null);
        return {
          id: typeof s.id === 'string' && s.id.trim().length > 0 ? s.id : `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          tagId: tag || null,
          sessionType: type,
          durationSeconds: duration,
          completedAt: completed,
        };
      });

    // 3. Normalize and validate incoming coffee cups (supporting both camelCase and legacy formats)
    const rawCoffee = Array.isArray(data.coffeeCups)
      ? data.coffeeCups
      : Array.isArray((data as any).coffee_cups)
      ? (data as any).coffee_cups
      : [];
    const validCoffee: CoffeeCup[] = rawCoffee
      .filter((c: any) => {
        if (!c) return false;
        const date = c.date;
        return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
      })
      .map((c: any) => {
        const date = c.date;
        const tag = c.tagId !== undefined ? c.tagId : (c.tag_id !== undefined ? c.tag_id : null);
        const createdAt = typeof c.createdAt === 'string' ? c.createdAt : (typeof c.created_at === 'string' ? c.created_at : `${date}T12:00:00.000Z`);
        return {
          id: typeof c.id === 'string' && c.id.trim().length > 0 ? c.id : `cup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
      // Merge mode
      // Merge tags (deduplicate by id or lowercase trimmed name)
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

      // Merge sessions (deduplicate by id or sessionType + completedAt)
      const existingSessionIds = new Set(sessions.map((s) => s.id));
      const existingSessionKeys = new Set(sessions.map((s) => `${s.sessionType}-${s.completedAt}`));
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
      finalSessions = [...sessions, ...newSessionsToKeep].sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      );
      await sessionRepository.saveAll(finalSessions);
      setSessions(finalSessions);

      // Merge coffee cups (deduplicate by id or date + createdAt)
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
      if (!auth.isAuthenticated) {
        if (data.profile.avatarUrl) safeProfileUpdate.avatarUrl = data.profile.avatarUrl;
      }
      await updateProfile(safeProfileUpdate);
    }

    if (isConvexConfigured && auth.isAuthenticated) {
      convexMutations.importBackup({
        mode,
        tags: validTags.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          isArchived: t.isArchived,
        })),
        sessions: validSessions.map((s) => ({
          tagId: s.tagId || undefined,
          sessionType: s.sessionType,
          durationSeconds: s.durationSeconds,
          completedAt: s.completedAt,
        })),
        coffeeCups: validCoffee.map((c) => ({
          date: c.date,
          tagId: c.tagId || undefined,
          createdAt: c.createdAt,
        })),
      }).catch(console.warn);
    }

    return {
      sessionsAdded,
      tagsAdded,
      coffeeAdded,
    };
  };

  const resetAllData = async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
    broadcastReset(scope);
    if (scope === 'sessions-only') {
      await sessionRepository.clear();
      setSessions([]);
      if (isConvexConfigured && auth.isAuthenticated) {
        convexMutations.clearSessions({}).catch(console.warn);
      }
    } else {
      await sessionRepository.clear();
      await coffeeRepository.clear();
      const defaultTags = await tagRepository.resetToDefaults();
      const defaultSettings = await settingsRepository.resetToDefaults();
      const defaultProfile = await profileRepository.resetToDefaults();

      setSessions([]);
      setCoffeeCups([]);
      setTags(defaultTags);
      setSettings(defaultSettings);
      setProfile(defaultProfile);
      settingsRef.current = defaultSettings;
      profileRef.current = defaultProfile;
      setActiveTagId(defaultTags[0]?.id || null);

      if (isConvexConfigured && auth.isAuthenticated) {
        convexMutations.clearSessions({}).catch(console.warn);
        convexMutations.clearCoffee({}).catch(console.warn);
        convexMutations.resetTags({}).catch(console.warn);
        convexMutations.updateSettings(defaultSettings).catch(console.warn);
        convexMutations.updateProfile(defaultProfile).catch(console.warn);
      }
    }
  };

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  const value: AppContextValue = {
    isDemoEnvironment: isDemo,
    reloadSampleData,
    auth,
    loginWithGoogle,
    logout,
    syncWithCloud,
    profile,
    updateProfile,
    tags,
    activeTags,
    activeTagId,
    setActiveTagId,
    createTag,
    updateTag,
    archiveTag,
    unarchiveTag,
    deleteTag,
    syncRemoteTags,
    sessions,
    recordSession,
    clearSessions,
    settings,
    updateSettings,
    exportBackup,
    importBackup,
    resetAllData,
    sound: soundService,
    notifications: notificationService,
    coffeeCups,
    addCoffeeCup,
    removeCoffeeCup,
    syncRemoteCoffeeCups,
    currentView,
    setCurrentView,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextValue => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
