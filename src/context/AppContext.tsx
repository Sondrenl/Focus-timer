import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { UserProfile, DEFAULT_PROFILE, BackupData, AuthState } from '../types/user';
import { CoffeeCup } from '../types/coffee';
import { CoffeeRepository } from '../services/repository/CoffeeRepository';
import { LocalStorageService } from '../services/storage/LocalStorageService';
import { TagRepository } from '../services/repository/TagRepository';
import { SessionRepository } from '../services/repository/SessionRepository';
import { SettingsRepository } from '../services/repository/SettingsRepository';
import { ProfileRepository } from '../services/repository/ProfileRepository';
import { AuthService } from '../services/auth/AuthService';
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

const parseGoogleJwt = (token: string): any => {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
};

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

        if (Array.isArray(convexSessions)) {
          const remoteCompletedTimes = new Set(convexSessions.map((s) => s.completedAt));
          const missingSessions = localSessions.filter(
            (s) =>
              !s.id.startsWith('seed-session-') &&
              !s.id.startsWith('sample-session-') &&
              !remoteCompletedTimes.has(s.completedAt)
          );
          for (const s of missingSessions) {
            convexMutations.recordSession({
              tagId: s.tagId || undefined,
              sessionType: s.sessionType,
              durationSeconds: s.durationSeconds,
              completedAt: s.completedAt,
            }).catch(console.warn);
          }
        }

        if (Array.isArray(convexCoffee)) {
          const remoteCupTimes = new Set(convexCoffee.map((c) => c.createdAt));
          const missingCups = localCoffee.filter((c) => !remoteCupTimes.has(c.createdAt));
          for (const c of missingCups) {
            convexMutations.addCup({
              date: c.date,
              tagId: c.tagId || undefined,
              createdAt: c.createdAt,
            }).catch(console.warn);
          }
        }

        if (convexUser?.tags) {
          const remoteTagIds = new Set(convexUser.tags.map((t) => t.id));
          const missingTags = localTags.filter((t) => !remoteTagIds.has(t.id));
          for (const t of missingTags) {
            convexMutations.createTag({
              id: t.id,
              name: t.name,
              color: t.color,
            }).catch(console.warn);
          }
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
    setCoffeeCups(convexCoffee as CoffeeCup[]);
    coffeeRepository.saveAll(convexCoffee as CoffeeCup[]);
  }, [convexCoffee, auth.isAuthenticated]);

  useEffect(() => {
    if (!auth.isAuthenticated || !Array.isArray(convexSessions)) return;
    setSessions(convexSessions as CompletedSession[]);
    sessionRepository.saveAll(convexSessions as CompletedSession[]);
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

      const user: UserProfile = {
        id: payload.sub,
        email: payload.email || '',
        displayName: payload.name || payload.email?.split('@')[0] || 'Focus Practitioner',
        avatarUrl: payload.picture,
        avatarEmoji: '',
        dailyGoalMinutes: profileRef.current.dailyGoalMinutes || 120,
        createdAt: profileRef.current.createdAt || new Date().toISOString(),
      };

      try {
        localStorage.setItem('focus_timer_auth_token', idToken);
        localStorage.setItem('focus_timer_user_profile', JSON.stringify(user));
      } catch (e) {
        console.warn('Could not persist auth to localStorage', e);
      }

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
      ...profileRef.current,
      id: undefined,
      email: undefined,
      avatarUrl: undefined,
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
      if (storedToken) {
        notificationService.setAuthToken(storedToken);
        if (isConvexConfigured) {
          const payload = parseGoogleJwt(storedToken);
          if (payload && payload.sub && (!payload.exp || payload.exp * 1000 > Date.now())) {
            setAuthToken(storedToken);
            const verifiedUser: UserProfile = {
              id: payload.sub,
              email: payload.email || '',
              displayName: payload.name || payload.email?.split('@')[0] || 'Focus Practitioner',
              avatarUrl: payload.picture,
              avatarEmoji: '',
              dailyGoalMinutes: profileRef.current.dailyGoalMinutes || 120,
              createdAt: profileRef.current.createdAt || new Date().toISOString(),
            };
            setAuth({
              isAuthenticated: true,
              user: verifiedUser,
              token: storedToken,
              isSyncing: false,
              lastSyncedAt: null,
              syncError: null,
            });
          } else {
            logout();
          }
        }
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

    if (isConvexConfigured) {
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

    if (isConvexConfigured) {
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

    if (isConvexConfigured) {
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

    if (isConvexConfigured) {
      convexMutations.updateTag({ id, isArchived: true }).catch(console.warn);
    }
    return result;
  };

  const unarchiveTag = async (id: string): Promise<Tag | null> => {
    const result = await tagRepository.unarchive(id);
    const updated = await tagRepository.getAll();
    setTags(updated);
    broadcastTags(updated);

    if (isConvexConfigured) {
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

    if (isConvexConfigured) {
      convexMutations.removeTag({ id }).catch(console.warn);
    }
    return success;
  };

  // Coffee Operations
  const addCoffeeCup = async (tagId: string | null, dateStr?: string): Promise<CoffeeCup> => {
    const today = dateStr || new Date().toISOString().slice(0, 10);
    const created = await coffeeRepository.addCup(today, tagId);
    const updated = await coffeeRepository.getAll();
    setCoffeeCups(updated);
    broadcastCoffeeCups(updated);

    if (isConvexConfigured) {
      convexMutations.addCup({
        date: today,
        tagId: tagId || undefined,
        createdAt: created.createdAt,
      }).catch(console.warn);
    }
    return created;
  };

  const removeCoffeeCup = async (dateStr?: string, tagId?: string | null, cupId?: string): Promise<boolean> => {
    const today = dateStr || new Date().toISOString().slice(0, 10);
    const removedCup = await coffeeRepository.removeCup(today, tagId, cupId);
    if (removedCup) {
      const updated = await coffeeRepository.getAll();
      setCoffeeCups(updated);
      broadcastCoffeeCups(updated);

      if (isConvexConfigured) {
        convexMutations.removeCup({
          id: removedCup.id,
          date: today,
          tagId: tagId || undefined,
        }).catch(console.warn);
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

      if (isConvexConfigured) {
        convexMutations.recordSession({
          tagId: sessionData.tagId || undefined,
          sessionType: sessionData.sessionType,
          durationSeconds: sessionData.durationSeconds,
          completedAt: created.completedAt,
        }).catch(console.warn);
      }
      return created;
    },
    [isConvexConfigured, convexMutations]
  );

  const clearSessions = async (): Promise<void> => {
    await sessionRepository.clear();
    setSessions([]);
    if (isConvexConfigured) {
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

    if (isConvexConfigured) {
      convexMutations.updateSettings(newValues).catch(console.warn);
    }
  };

  // Data Operations (Export / Import / Reset)
  const exportBackup = (): BackupData => {
    const cleanSessions = isProduction()
      ? sessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-'))
      : sessions;
    return {
      version: '2.3.1',
      exportedAt: new Date().toISOString(),
      profile,
      tags,
      sessions: cleanSessions,
      coffeeCups,
      settings,
    };
  };

  const importBackup = async (
    data: BackupData,
    mode: 'merge' | 'replace'
  ): Promise<{ sessionsAdded: number; tagsAdded: number; coffeeAdded: number }> => {
    if (mode === 'replace') {
      await sessionRepository.clear();
      await coffeeRepository.clear();
      await tagRepository.resetToDefaults();
      if (isConvexConfigured) {
        convexMutations.clearSessions({}).catch(console.warn);
        convexMutations.clearCoffee({}).catch(console.warn);
      }
    }

    const newTags = data.tags.filter(
      (t): t is Tag =>
        typeof t.id === 'string' &&
        t.id.trim().length > 0 &&
        typeof t.name === 'string' &&
        typeof t.color === 'string' &&
        typeof t.isArchived === 'boolean'
    );
    await tagRepository.saveAll(newTags);
    setTags(newTags);

    const validSessions = data.sessions.filter(
      (s): s is CompletedSession =>
        typeof s.sessionType === 'string' &&
        ['WORK', 'SHORT_BREAK', 'LONG_BREAK'].includes(s.sessionType) &&
        typeof s.durationSeconds === 'number' &&
        s.durationSeconds > 0 &&
        typeof s.completedAt === 'string' &&
        !isNaN(new Date(s.completedAt).getTime())
    );
    await sessionRepository.saveAll(validSessions);
    setSessions(validSessions);

    const validCoffee = (data.coffeeCups || []).filter(
      (c): c is CoffeeCup =>
        typeof c.id === 'string' &&
        typeof c.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(c.date)
    );
    await coffeeRepository.saveAll(validCoffee);
    setCoffeeCups(validCoffee);

    if (data.settings) {
      await updateSettings(data.settings);
    }
    if (data.profile) {
      await updateProfile(data.profile);
    }

    if (isConvexConfigured) {
      convexMutations.importBackup({
        tags: newTags.map((t) => ({
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
      sessionsAdded: validSessions.length,
      tagsAdded: newTags.length,
      coffeeAdded: validCoffee.length,
    };
  };

  const resetAllData = async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
    broadcastReset(scope);
    if (scope === 'sessions-only') {
      await sessionRepository.clear();
      setSessions([]);
      if (isConvexConfigured) {
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

      if (isConvexConfigured) {
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
