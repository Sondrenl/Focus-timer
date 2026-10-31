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
import { useConvexSync } from '../hooks/useConvexSync';
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

function getTagTimestampMs(tag: Tag): number {
  const tsStr = tag.updatedAt || tag.createdAt;
  if (tsStr) {
    const normalized = tsStr.includes('T') ? tsStr : tsStr.replace(' ', 'T') + 'Z';
    const t = Date.parse(normalized);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function mergeTagLists(localTags: Tag[], remoteTags: Tag[], deletedTagIds: Set<string>): Tag[] {
  const mergedMap = new Map<string, Tag>();

  for (const local of localTags) {
    if (!deletedTagIds.has(local.id)) {
      mergedMap.set(local.id, local);
    }
  }

  for (const remote of remoteTags) {
    if (deletedTagIds.has(remote.id)) continue;
    const existing = mergedMap.get(remote.id);
    if (!existing) {
      mergedMap.set(remote.id, remote);
    } else {
      const localTs = getTagTimestampMs(existing);
      const remoteTs = getTagTimestampMs(remote);
      // Adopt remote if its updatedAt timestamp is newer or equal (or if local had no updatedAt)
      if (remoteTs >= localTs) {
        mergedMap.set(remote.id, remote);
      }
    }
  }

  return Array.from(mergedMap.values());
}

function areTagListsEqual(a: Tag[], b: Tag[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const t1 = a[i];
    const t2 = b[i];
    if (
      t1.id !== t2.id ||
      t1.name !== t2.name ||
      t1.color !== t2.color ||
      t1.isArchived !== t2.isArchived ||
      t1.updatedAt !== t2.updatedAt
    ) {
      return false;
    }
  }
  return true;
}

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

  const lastSyncCompletedMsRef = useRef<number>(0);
  const isSyncingRef = useRef<boolean>(false);
  const syncPendingRef = useRef<boolean>(false);

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

  // Synchronize remote tags (including archive state) received from real-time polling or background sync
  const syncRemoteTags = useCallback(async (remoteTags: Tag[], remoteDeletedIds?: string[]) => {
    const deletedTagIds = authService.getDeletedTagIds();
    if (Array.isArray(remoteDeletedIds)) {
      remoteDeletedIds.forEach((id) => {
        deletedTagIds.add(id);
        authService.addDeletedTagId(id);
      });
    }

    const localTags = await tagRepository.getAll();
    const mergedTags = mergeTagLists(localTags, remoteTags, deletedTagIds);

    if (!areTagListsEqual(localTags, mergedTags)) {
      await tagRepository.saveAll(mergedTags);
      setTags(mergedTags);
      broadcastTags(mergedTags);
    }
  }, []);

  // Synchronize remote coffee cups received from real-time timer polling or background sync
  const syncRemoteCoffeeCups = useCallback(async (remoteCups: CoffeeCup[], remoteDeletedIds?: string[]) => {
    const deletedCupIds = authService.getDeletedCoffeeCupIds();
    if (Array.isArray(remoteDeletedIds)) {
      remoteDeletedIds.forEach((id) => {
        deletedCupIds.add(id);
        authService.addDeletedCoffeeCupId(id);
      });
    }

    const localCups = await coffeeRepository.getAll();
    const cupMap = new Map<string, CoffeeCup>();

    // 1. Keep local cups that have NOT been deleted
    localCups.forEach((c) => {
      if (!deletedCupIds.has(c.id)) {
        cupMap.set(c.id, c);
      }
    });

    let hasChanges = false;

    // 2. Add remote cups that have NOT been deleted
    remoteCups.forEach((c) => {
      if (!deletedCupIds.has(c.id) && !cupMap.has(c.id)) {
        cupMap.set(c.id, c);
        hasChanges = true;
      }
    });

    // 3. Purge any cups from cupMap that were deleted
    for (const [id] of cupMap.entries()) {
      if (deletedCupIds.has(id)) {
        cupMap.delete(id);
        hasChanges = true;
      }
    }

    if (hasChanges || localCups.length !== cupMap.size) {
      const finalCups = Array.from(cupMap.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      await coffeeRepository.saveAll(finalCups);
      setCoffeeCups(finalCups);
    }
  }, []);

  // Synchronize local data with Cloudflare D1
  const syncWithCloud = useCallback(async (force = false): Promise<void> => {
    if (isConvexConfigured) {
      // In Convex, reactive WebSocket subscriptions maintain live state automatically
      return;
    }

    if (!authService.getStoredToken()) return;
    if (isSyncingRef.current) {
      if (force) syncPendingRef.current = true;
      return;
    }

    const now = Date.now();
    // Cooldown: prevent automated background syncs from running more than once every 15 seconds
    if (!force && now - lastSyncCompletedMsRef.current < 15000) {
      return;
    }

    isSyncingRef.current = true;
    setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));

    try {
      // 1. Fetch latest cloud state first so stale local defaults never clobber cloud archives/edits
      const cloudData = await authService.fetchCloudData();

      // 2. Read current local repositories after network fetch to include any recent local changes
      const currentTags = await tagRepository.getAll();
      const currentSessions = await sessionRepository.getAll();
      const currentSettings = await settingsRepository.get();
      const currentProfile = await profileRepository.get();
      const localCoffee = await coffeeRepository.getAll();

      if (cloudData) {
        if (Array.isArray(cloudData.deletedTagIds)) {
          cloudData.deletedTagIds.forEach((id) => authService.addDeletedTagId(id));
        }
        if (Array.isArray(cloudData.deletedCoffeeCupIds)) {
          cloudData.deletedCoffeeCupIds.forEach((id) => authService.addDeletedCoffeeCupId(id));
        }
      }

      const effectiveDeletedTagIds = authService.getDeletedTagIds();
      const effectiveDeletedCoffeeCupIds = authService.getDeletedCoffeeCupIds();

      // 3. Synchronize Tags
      const mergedTags = mergeTagLists(currentTags, cloudData?.tags || [], effectiveDeletedTagIds);
      let finalTags = currentTags;
      if (!areTagListsEqual(currentTags, mergedTags)) {
        await tagRepository.saveAll(mergedTags);
        finalTags = mergedTags;
        setTags(mergedTags);
        broadcastTags(mergedTags);
      }

      // 4. Synchronize Coffee Cups
      const coffeeMap = new Map<string, CoffeeCup>();
      localCoffee.forEach((c) => {
        if (!effectiveDeletedCoffeeCupIds.has(c.id)) {
          coffeeMap.set(c.id, c);
        }
      });
      (cloudData?.coffeeCups || []).forEach((c) => {
        if (!effectiveDeletedCoffeeCupIds.has(c.id) && !coffeeMap.has(c.id)) {
          coffeeMap.set(c.id, c);
        }
      });
      const finalCoffee = Array.from(coffeeMap.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      if (finalCoffee.length !== localCoffee.length) {
        await coffeeRepository.saveAll(finalCoffee);
        setCoffeeCups(finalCoffee);
      }

      // 5. Synchronize Sessions
      const localSessionMap = new Map(currentSessions.map((s) => [s.id, s]));
      (cloudData?.sessions || []).forEach((remoteSession) => {
        if (!localSessionMap.has(remoteSession.id)) {
          localSessionMap.set(remoteSession.id, remoteSession);
        }
      });
      const mergedSessions = Array.from(localSessionMap.values()).sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      );
      const finalSessions = isProduction()
        ? mergedSessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-'))
        : mergedSessions;
      if (finalSessions.length !== currentSessions.length) {
        await sessionRepository.saveAll(finalSessions);
        setSessions(finalSessions);
      }

      // 6. Synchronize Settings
      let finalSettings = currentSettings;
      if (cloudData?.settings) {
        const cloudSettingsTs = cloudData.settings.updatedAt ? Date.parse(cloudData.settings.updatedAt) : 0;
        const localSettingsEditedRecently = lastLocalSettingsEditMsRef.current > 0;
        if (!localSettingsEditedRecently && cloudSettingsTs > lastLocalSettingsEditMsRef.current) {
          const { updatedAt: _, ...settingsToAdopt } = cloudData.settings;
          const merged = { ...currentSettings, ...settingsToAdopt };
          await settingsRepository.save(merged);
          setSettings(merged);
          settingsRef.current = merged;
          finalSettings = merged;
          lastLocalSettingsEditMsRef.current = 0;
        } else {
          finalSettings = settingsRef.current;
        }
      }

      // 7. Synchronize Profile
      let finalProfile = currentProfile;
      if (cloudData?.profile) {
        const localProfileEditedRecently = lastLocalProfileEditMsRef.current > 0;
        if (!localProfileEditedRecently) {
          const mergedProfile: UserProfile = {
            ...currentProfile,
            id: cloudData.profile.id ?? currentProfile.id,
            email: cloudData.profile.email ?? currentProfile.email,
            avatarUrl: cloudData.profile.avatarUrl ?? currentProfile.avatarUrl,
            avatarEmoji: cloudData.profile.avatarEmoji ?? currentProfile.avatarEmoji,
            displayName: cloudData.profile.displayName ?? currentProfile.displayName,
            dailyGoalMinutes: cloudData.profile.dailyGoalMinutes ?? currentProfile.dailyGoalMinutes,
          };
          await profileRepository.save(mergedProfile);
          setProfile(mergedProfile);
          profileRef.current = mergedProfile;
          finalProfile = mergedProfile;
          lastLocalProfileEditMsRef.current = 0;
        } else {
          finalProfile = profileRef.current;
        }
      }

      // 8. Push only incremental / new records to Cloudflare Worker
      const cloudSessionIdSet = new Set((cloudData?.sessions || []).map((s) => s.id));
      const sessionsToPush = finalSessions.filter(
        (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-') && !cloudSessionIdSet.has(s.id)
      );

      const cloudCoffeeMap = new Map((cloudData?.coffeeCups || []).map((c) => [c.id, c]));
      const coffeeToPush = finalCoffee.filter((c) => {
        const cloudCup = cloudCoffeeMap.get(c.id);
        if (!cloudCup) return true;
        return cloudCup.tagId !== c.tagId || cloudCup.date !== c.date;
      });

      const cloudDeletedTagSet = new Set(cloudData?.deletedTagIds || []);
      const deletedTagsToPush = Array.from(effectiveDeletedTagIds).filter((id) => !cloudDeletedTagSet.has(id));

      const cloudDeletedCoffeeSet = new Set(cloudData?.deletedCoffeeCupIds || []);
      const deletedCoffeeToPush = Array.from(effectiveDeletedCoffeeCupIds).filter((id) => !cloudDeletedCoffeeSet.has(id));

      await authService.pushCloudData({
        profile: {
          displayName: finalProfile.displayName,
          avatarEmoji: finalProfile.avatarEmoji,
          dailyGoalMinutes: finalProfile.dailyGoalMinutes,
        },
        tags: finalTags,
        deletedTagIds: deletedTagsToPush,
        deletedCoffeeCupIds: deletedCoffeeToPush,
        sessions: sessionsToPush,
        coffeeCups: coffeeToPush,
        settings: finalSettings,
      });

      lastLocalSettingsEditMsRef.current = 0;
      lastLocalProfileEditMsRef.current = 0;

      const nowIso = new Date().toISOString();
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncedAt: nowIso,
        syncError: null,
      }));
    } catch (err) {
      console.error('Cloud sync error:', err);
      setAuth((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: (err as Error).message || 'Sync failed',
      }));
    } finally {
      isSyncingRef.current = false;
      lastSyncCompletedMsRef.current = Date.now();
      if (syncPendingRef.current) {
        syncPendingRef.current = false;
        setTimeout(() => {
          void syncWithCloud(true);
        }, 1000);
      }
    }
  }, [isConvexConfigured]);

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
      const { user, token } = await authService.loginWithGoogle(idToken);
      notificationService.setAuthToken(token);
      setAuth({
        isAuthenticated: true,
        user,
        token,
        isSyncing: false,
        lastSyncedAt: null,
        syncError: null,
      });

      if (isConvexConfigured) {
        setAuthToken(idToken);
      }

      // Update local profile with Google identity and auto-activate Google avatar
      const updatedProfile: UserProfile = {
        ...profileRef.current,
        id: user.id,
        email: user.email,
        avatarUrl: user.avatarUrl,
        avatarEmoji: '', // Switch to Google account photo
        displayName: user.displayName || profileRef.current.displayName,
      };
      profileRef.current = updatedProfile;
      await profileRepository.save(updatedProfile);
      setProfile(updatedProfile);

      // Perform initial cloud sync
      await syncWithCloud();
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
          setAuthToken(storedToken);
          setAuth((prev) => ({
            ...prev,
            isAuthenticated: true,
            token: storedToken,
          }));
        } else {
          const verifiedUser = await authService.verifySession();
          if (verifiedUser) {
            setAuth((prev) => ({
              ...prev,
              isAuthenticated: true,
              user: verifiedUser,
              token: storedToken,
            }));
            syncWithCloud();
          } else {
            notificationService.setAuthToken(null);
            setAuth({
              isAuthenticated: false,
              user: null,
              token: null,
              isSyncing: false,
              lastSyncedAt: null,
              syncError: null,
            });
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
    } else if (auth.isAuthenticated) {
      await authService.pushCloudData({
        profile: {
          displayName: merged.displayName,
          avatarEmoji: merged.avatarEmoji,
          dailyGoalMinutes: merged.dailyGoalMinutes,
        },
      });
      setTimeout(() => {
        if (lastLocalProfileEditMsRef.current === editMs) {
          lastLocalProfileEditMsRef.current = 0;
        }
      }, 2000);
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
        name: input.name,
        color: input.color,
      }).catch(console.warn);
    } else if (auth.isAuthenticated) {
      authService.upsertTagRemote(created).then((remoteTags) => {
        if (remoteTags) {
          syncRemoteTags(remoteTags);
        }
      });
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
    } else if (auth.isAuthenticated && result) {
      authService.upsertTagRemote(result).then((remoteTags) => {
        if (remoteTags) {
          syncRemoteTags(remoteTags);
        }
      });
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
    } else if (auth.isAuthenticated && result) {
      authService.upsertTagRemote(result).then((remoteTags) => {
        if (remoteTags) {
          syncRemoteTags(remoteTags);
        }
      });
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
    } else if (auth.isAuthenticated && result) {
      authService.upsertTagRemote(result).then((remoteTags) => {
        if (remoteTags) {
          syncRemoteTags(remoteTags);
        }
      });
    }
    return result;
  };

  const deleteTag = async (id: string): Promise<boolean> => {
    authService.addDeletedTagId(id);
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
    } else if (auth.isAuthenticated) {
      await authService.deleteTag(id);
      syncWithCloud();
    }
    return success;
  };

  // Coffee Operations
  const addCoffeeCup = async (tagId: string | null, dateStr?: string): Promise<CoffeeCup> => {
    const today = dateStr || new Date().toISOString().slice(0, 10);
    const created = await coffeeRepository.addCup(today, tagId);
    authService.removeDeletedCoffeeCupId(created.id);
    const updated = await coffeeRepository.getAll();
    setCoffeeCups(updated);
    broadcastCoffeeCups(updated);

    if (isConvexConfigured) {
      convexMutations.addCup({
        date: today,
        tagId: tagId || undefined,
        createdAt: created.createdAt,
      }).catch(console.warn);
    } else if (auth.isAuthenticated) {
      authService.addCoffeeCupRemote(created).then((remoteCups) => {
        if (remoteCups) {
          syncRemoteCoffeeCups(remoteCups);
        }
      });
    }
    return created;
  };

  const removeCoffeeCup = async (dateStr?: string, tagId?: string | null, cupId?: string): Promise<boolean> => {
    const today = dateStr || new Date().toISOString().slice(0, 10);
    const removedCup = await coffeeRepository.removeCup(today, tagId, cupId);
    if (removedCup) {
      authService.addDeletedCoffeeCupId(removedCup.id);
      const updated = await coffeeRepository.getAll();
      setCoffeeCups(updated);
      broadcastCoffeeCups(updated);

      if (isConvexConfigured) {
        convexMutations.removeCup({ id: removedCup.id as any }).catch(console.warn);
      } else if (auth.isAuthenticated) {
        authService.removeCoffeeCupRemote(removedCup.id);
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
      } else if (auth.isAuthenticated) {
        void authService.recordSessionRemote(created);
        void syncWithCloud();
      }
      return created;
    },
    [auth.isAuthenticated, syncWithCloud, isConvexConfigured, convexMutations]
  );

  const clearSessions = async (): Promise<void> => {
    await sessionRepository.clear();
    setSessions([]);
    if (isConvexConfigured) {
      convexMutations.clearSessions({}).catch(console.warn);
    } else if (auth.isAuthenticated) {
      await syncWithCloud();
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
    } else if (auth.isAuthenticated) {
      await authService.pushCloudData({
        settings: merged,
      });
      setTimeout(() => {
        if (lastLocalSettingsEditMsRef.current === editMs) {
          lastLocalSettingsEditMsRef.current = 0;
        }
      }, 2000);
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
      authService.clearDeletedTagIds();
      authService.clearDeletedCoffeeCupIds();
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
    } else if (auth.isAuthenticated) {
      await syncWithCloud();
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
