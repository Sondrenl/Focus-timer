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
import {
  broadcastCoffeeCups,
  subscribeCoffeeCups,
  broadcastTags,
  subscribeTags,
  broadcastSession,
  subscribeSessions,
} from '../services/timer/TimerBroadcast';
import { isPreviewOrDev, isProduction } from '../utils/environment';
import { toDateKey } from '../utils/dates';

interface AppContextValue {
  // Environment
  isDemoEnvironment: boolean;
  reloadSampleData: () => Promise<void>;

  // Authentication & Cloud Sync
  auth: AuthState;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
  syncWithCloud: () => Promise<void>;

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
  const syncWithCloud = useCallback(async (): Promise<void> => {
    if (!authService.getStoredToken()) return;
    if (isSyncingRef.current) {
      syncPendingRef.current = true;
      return;
    }

    isSyncingRef.current = true;
    const syncStartedMs = Date.now();
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

      // 3. Merge tags using updatedAt timestamps (preserves archive/unarchive state across devices)
      const finalTags = mergeTagLists(
        currentTags,
        cloudData?.tags || [],
        effectiveDeletedTagIds
      );
      await tagRepository.saveAll(finalTags);
      setTags(finalTags);

      // 4. Merge sessions
      const sessionMap = new Map<string, CompletedSession>();
      currentSessions.forEach((s) => {
        const effectiveTagId = s.tagId && effectiveDeletedTagIds.has(s.tagId) ? null : s.tagId;
        sessionMap.set(s.id, { ...s, tagId: effectiveTagId });
      });
      (cloudData?.sessions || []).forEach((s) => {
        const effectiveTagId = s.tagId && effectiveDeletedTagIds.has(s.tagId) ? null : s.tagId;
        sessionMap.set(s.id, { ...s, tagId: effectiveTagId });
      });
      let finalSessions = Array.from(sessionMap.values()).sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      );
      if (isProduction()) {
        finalSessions = finalSessions.filter(
          (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')
        );
      }
      await sessionRepository.saveAll(finalSessions);
      setSessions(finalSessions);

      // 5. Merge settings: adopt cloudData.settings if user has no un-pushed local edits
      let finalSettings = currentSettings;
      if (cloudData?.settings) {
        const hasUnpushedLocalSettingsEdit =
          lastLocalSettingsEditMsRef.current > 0 && syncStartedMs <= lastLocalSettingsEditMsRef.current;
        if (!hasUnpushedLocalSettingsEdit) {
          finalSettings = { ...currentSettings, ...cloudData.settings };
          settingsRef.current = finalSettings;
          await settingsRepository.save(finalSettings);
          setSettings(finalSettings);
          lastLocalSettingsEditMsRef.current = 0;
        } else {
          finalSettings = settingsRef.current;
        }
      }

      // 6. Merge coffee cups EXCLUDING any deleted coffee cups
      const cupMap = new Map<string, CoffeeCup>();
      localCoffee.forEach((c) => {
        if (!effectiveDeletedCoffeeCupIds.has(c.id)) {
          const effectiveTagId = c.tagId && effectiveDeletedTagIds.has(c.tagId) ? null : c.tagId;
          cupMap.set(c.id, { ...c, tagId: effectiveTagId });
        }
      });
      (cloudData?.coffeeCups || []).forEach((c) => {
        if (!effectiveDeletedCoffeeCupIds.has(c.id)) {
          const effectiveTagId = c.tagId && effectiveDeletedTagIds.has(c.tagId) ? null : c.tagId;
          cupMap.set(c.id, { ...c, tagId: effectiveTagId });
        }
      });
      const finalCoffee = Array.from(cupMap.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      await coffeeRepository.saveAll(finalCoffee);
      setCoffeeCups(finalCoffee);

      // 7. Merge profile: adopt cloudData.profile if user has no un-pushed local edits
      let finalProfile = currentProfile;
      if (cloudData?.profile) {
        const hasUnpushedLocalProfileEdit =
          lastLocalProfileEditMsRef.current > 0 && syncStartedMs <= lastLocalProfileEditMsRef.current;
        if (!hasUnpushedLocalProfileEdit) {
          finalProfile = { ...currentProfile, ...cloudData.profile };
          profileRef.current = finalProfile;
          await profileRepository.save(finalProfile);
          setProfile(finalProfile);
          lastLocalProfileEditMsRef.current = 0;
        } else {
          finalProfile = profileRef.current;
        }
      }

      // 8. Push only incremental / new records to Cloudflare Worker to avoid massive batch statements and timeout errors
      const cloudSessionIdSet = new Set((cloudData?.sessions || []).map((s) => s.id));
      const sessionsToPush = finalSessions.filter(
        (s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-') && !cloudSessionIdSet.has(s.id)
      );

      const cloudCoffeeIdSet = new Set((cloudData?.coffeeCups || []).map((c) => c.id));
      const coffeeToPush = finalCoffee.filter((c) => !cloudCoffeeIdSet.has(c.id));

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
      if (syncPendingRef.current) {
        syncPendingRef.current = false;
        setTimeout(() => {
          void syncWithCloud();
        }, 300);
      }
    }
  }, []);

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
      setAuth({
        isAuthenticated: true,
        user,
        token,
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
      if (authService.getStoredToken()) {
        const verifiedUser = await authService.verifySession();
        if (verifiedUser) {
          setAuth((prev) => ({
            ...prev,
            isAuthenticated: true,
            user: verifiedUser,
            token: authService.getStoredToken(),
          }));
          syncWithCloud();
        } else {
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
    init();
  }, [syncWithCloud, setActiveTagId]);

  // Active unarchived tags sorted by most recently completed Pomodoro (sessionType === 'WORK')
  const activeTags = useMemo(() => {
    const unarchived = tags.filter((t) => !t.isArchived);

    // Build map of tagId -> latest completed WORK session timestamp in milliseconds
    const latestWorkMap = new Map<string, number>();
    for (const session of sessions) {
      if (session.sessionType === 'WORK' && session.tagId) {
        const time = new Date(session.completedAt).getTime();
        if (!Number.isNaN(time)) {
          const existing = latestWorkMap.get(session.tagId) || 0;
          if (time > existing) {
            latestWorkMap.set(session.tagId, time);
          }
        }
      }
    }

    return [...unarchived].sort((a, b) => {
      const timeA = latestWorkMap.get(a.id) || 0;
      const timeB = latestWorkMap.get(b.id) || 0;

      // Both have completed Pomodoros: most recently completed first
      if (timeA > 0 && timeB > 0) {
        if (timeA !== timeB) return timeB - timeA;
      }

      // One has completed Pomodoros and the other doesn't: used tags come first
      if (timeA > 0 && timeB === 0) return -1;
      if (timeB > 0 && timeA === 0) return 1;

      // Neither has completed Pomodoros: sort by createdAt DESC (newest tags first)
      const createdA = new Date(a.createdAt || 0).getTime() || 0;
      const createdB = new Date(b.createdAt || 0).getTime() || 0;
      if (createdA !== createdB) {
        return createdB - createdA;
      }

      // Stable fallback: alphabetical by name
      return a.name.localeCompare(b.name);
    });
  }, [tags, sessions]);

  useEffect(() => {
    if (activeTagId !== null && tags.length > 0) {
      const exists = tags.some((t) => t.id === activeTagId && !t.isArchived);
      if (!exists) {
        if (auth.isAuthenticated && !auth.isSyncing) {
          syncWithCloud().then(() => {
            tagRepository.getAll().then((currentTags) => {
              if (!currentTags.some((t) => t.id === activeTagId && !t.isArchived)) {
                setActiveTagId(null);
              }
            });
          });
        } else if (!auth.isAuthenticated) {
          setActiveTagId(null);
        }
      }
    }
  }, [tags, activeTagId, auth.isAuthenticated, auth.isSyncing, syncWithCloud, setActiveTagId]);

  // When switching views to Statistics, guarantee data is fresh from the cloud
  useEffect(() => {
    if (currentView === 'stats' && auth.isAuthenticated && !auth.isSyncing) {
      void syncWithCloud();
    }
  }, [currentView, auth.isAuthenticated, auth.isSyncing, syncWithCloud]);

  // Profile Operations: save locally and push directly to cloud so stale cloud state never overwrites local changes
  const updateProfile = async (newProfile: Partial<UserProfile>): Promise<void> => {
    lastLocalProfileEditMsRef.current = Date.now();
    const merged = { ...profileRef.current, ...newProfile };
    profileRef.current = merged;
    setProfile(merged);
    await profileRepository.save(merged);
    if (auth.isAuthenticated) {
      await authService.pushCloudData({
        profile: {
          displayName: merged.displayName,
          avatarEmoji: merged.avatarEmoji,
          dailyGoalMinutes: merged.dailyGoalMinutes,
        },
      });
      lastLocalProfileEditMsRef.current = 0;
    }
  };

  // Tag Operations
  const createTag = async (input: CreateTagInput): Promise<Tag> => {
    const created = await tagRepository.create(input);
    const updated = await tagRepository.getAll();
    setTags(updated);
    setActiveTagId(created.id);
    broadcastTags(updated);
    if (auth.isAuthenticated) {
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
    if (auth.isAuthenticated && result) {
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
    if (auth.isAuthenticated && result) {
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
    if (auth.isAuthenticated && result) {
      authService.upsertTagRemote(result).then((remoteTags) => {
        if (remoteTags) {
          syncRemoteTags(remoteTags);
        }
      });
    }
    return result;
  };

  const deleteTag = async (id: string): Promise<boolean> => {
    // 1. Record in deleted tags tracking set
    authService.addDeletedTagId(id);

    // 2. Delete locally from repository
    const success = await tagRepository.delete(id);

    // 3. Unassign sessions that had this tag
    const currentSessions = await sessionRepository.getAll();
    const updatedSessions = currentSessions.map((s) => (s.tagId === id ? { ...s, tagId: null } : s));
    await sessionRepository.saveAll(updatedSessions);
    setSessions(updatedSessions);

    // 4. Update tags in state
    const updatedTags = await tagRepository.getAll();
    setTags(updatedTags);
    if (activeTagId === id) {
      const nextActive = updatedTags.find((t) => !t.isArchived);
      setActiveTagId(nextActive?.id ?? null);
    }
    broadcastTags(updatedTags);

    // 5. If authenticated, explicitly delete on server and push
    if (auth.isAuthenticated) {
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
    if (auth.isAuthenticated) {
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
      if (auth.isAuthenticated) {
        authService.removeCoffeeCupRemote(removedCup.id);
      }
      return true;
    }
    return false;
  };

  // Session Operations: instant direct remote recording + multi-tab broadcast + cloud sync
  const recordSession = useCallback(
    async (sessionData: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> => {
      const created = await sessionRepository.add(sessionData);
      setSessions((prev) => {
        if (prev.some((s) => s.id === created.id)) return prev;
        return [...prev.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')), created];
      });
      broadcastSession(created);
      if (auth.isAuthenticated) {
        void authService.recordSessionRemote(created);
        void syncWithCloud();
      }
      return created;
    },
    [auth.isAuthenticated, syncWithCloud]
  );

  const clearSessions = async (): Promise<void> => {
    await sessionRepository.clear();
    setSessions([]);
    if (auth.isAuthenticated) {
      await authService.pushCloudData({
        clearSessions: true,
      });
      syncWithCloud();
    }
  };

  const reloadSampleData = async (): Promise<void> => {
    if (isProduction()) return;
    const samples = await sessionRepository.loadSampleData();
    setSessions(samples);
  };

  // Settings Operations: save locally and push directly to cloud so stale cloud state never overwrites local changes
  const updateSettings = async (newValues: Partial<UserSettings>): Promise<void> => {
    lastLocalSettingsEditMsRef.current = Date.now();
    const merged = { ...settingsRef.current, ...newValues };
    settingsRef.current = merged;
    setSettings(merged);
    await settingsRepository.save(merged);
    if (auth.isAuthenticated) {
      await authService.pushCloudData({
        settings: merged,
      });
      lastLocalSettingsEditMsRef.current = 0;
    }
  };

  // Data Operations (Export / Import / Reset)
  const exportBackup = (): BackupData => {
    const cleanSessions = isProduction()
      ? sessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-'))
      : sessions;
    return {
      version: '2.1.1',
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
      authService.clearDeletedTagIds();
      authService.clearDeletedCoffeeCupIds();

      // 1. Sanitize incoming tags: guarantee valid id, name, color, isArchived, and updatedAt
      const newTags: Tag[] = (data.tags || []).map((t) => ({
        id: t.id || ('tag-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7)),
        name: (t.name || 'Untitled Tag').trim(),
        color: t.color || '#7E57C2',
        isArchived: Boolean(t.isArchived),
        createdAt: t.createdAt || new Date().toISOString(),
        updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
      }));

      // 2. Filter sessions (purge sample/seed sessions in production)
      const newSessions: CompletedSession[] = (data.sessions || []).filter((s) => {
        if (!s || !s.id || !s.completedAt) return false;
        if (isProduction() && (s.id.startsWith('seed-session-') || s.id.startsWith('sample-session-'))) {
          return false;
        }
        return true;
      });

      // 3. Sanitize coffee cups: guarantee valid id and date
      const newCoffee: CoffeeCup[] = (data.coffeeCups || []).map((c) => ({
        id: c.id || ('cup-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7)),
        tagId: c.tagId || null,
        date: c.date || (c.createdAt ? toDateKey(new Date(c.createdAt)) : toDateKey(new Date())),
        createdAt: c.createdAt || new Date().toISOString(),
      }));

      const newSettings: UserSettings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      const newProfile: UserProfile = { ...DEFAULT_PROFILE, ...(data.profile || {}) };

      await tagRepository.saveAll(newTags);
      await sessionRepository.saveAll(newSessions);
      await coffeeRepository.saveAll(newCoffee);
      await settingsRepository.save(newSettings);
      await profileRepository.save(newProfile);

      setTags(newTags);
      setSessions(newSessions);
      setCoffeeCups(newCoffee);
      setSettings(newSettings);
      setProfile(newProfile);

      // Validate activeTagId after replacement
      const activeStillValid = newTags.some((t) => t.id === activeTagId && !t.isArchived);
      if (!activeStillValid) {
        setActiveTagId(newTags.find((t) => !t.isArchived)?.id ?? null);
      }

      // Broadcast changes across tabs
      broadcastTags(newTags);
      broadcastCoffeeCups(newCoffee);
      if (newSessions.length > 0) {
        broadcastSession(newSessions[newSessions.length - 1]);
      }

      if (auth.isAuthenticated) {
        await authService.pushCloudData({
          mode: 'replace',
          tags: newTags,
          sessions: newSessions,
          coffeeCups: newCoffee,
          settings: newSettings,
          profile: newProfile,
        });
      }

      return { sessionsAdded: newSessions.length, tagsAdded: newTags.length, coffeeAdded: newCoffee.length };
    } else {
      // Merge mode
      const currentTags = await tagRepository.getAll();
      const currentSessions = await sessionRepository.getAll();
      const currentCoffee = await coffeeRepository.getAll();

      // 1. Merge tags
      const tagMap = new Map<string, Tag>();
      currentTags.forEach((t) => tagMap.set(t.id, t));
      let tagsAdded = 0;
      (data.tags || []).forEach((t) => {
        const sanitizedTag: Tag = {
          id: t.id || ('tag-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7)),
          name: (t.name || 'Untitled Tag').trim(),
          color: t.color || '#7E57C2',
          isArchived: Boolean(t.isArchived),
          createdAt: t.createdAt || new Date().toISOString(),
          updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
        };
        const existing = tagMap.get(sanitizedTag.id);
        if (!existing) {
          tagMap.set(sanitizedTag.id, sanitizedTag);
          tagsAdded++;
        } else {
          // If incoming tag has newer updatedAt, adopt updates
          const existingTs = getTagTimestampMs(existing);
          const incomingTs = getTagTimestampMs(sanitizedTag);
          if (incomingTs > existingTs) {
            tagMap.set(sanitizedTag.id, sanitizedTag);
          }
        }
      });
      const mergedTags = Array.from(tagMap.values());
      await tagRepository.saveAll(mergedTags);
      setTags(mergedTags);

      // 2. Merge sessions
      const sessionMap = new Map<string, CompletedSession>();
      currentSessions.forEach((s) => sessionMap.set(s.id, s));
      let sessionsAdded = 0;
      (data.sessions || []).forEach((s) => {
        if (!s || !s.id || !s.completedAt) return;
        if (isProduction() && (s.id.startsWith('seed-session-') || s.id.startsWith('sample-session-'))) {
          return;
        }
        if (!sessionMap.has(s.id)) {
          sessionMap.set(s.id, s);
          sessionsAdded++;
        }
      });
      const mergedSessions = Array.from(sessionMap.values()).sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      );
      await sessionRepository.saveAll(mergedSessions);
      setSessions(mergedSessions);

      // 3. Merge coffee cups
      const coffeeMap = new Map<string, CoffeeCup>();
      currentCoffee.forEach((c) => coffeeMap.set(c.id, c));
      let coffeeAdded = 0;
      (data.coffeeCups || []).forEach((c) => {
        if (!c || !c.id) return;
        const sanitizedCup: CoffeeCup = {
          id: c.id,
          tagId: c.tagId || null,
          date: c.date || (c.createdAt ? toDateKey(new Date(c.createdAt)) : toDateKey(new Date())),
          createdAt: c.createdAt || new Date().toISOString(),
        };
        if (!coffeeMap.has(sanitizedCup.id)) {
          coffeeMap.set(sanitizedCup.id, sanitizedCup);
          coffeeAdded++;
        }
      });
      const mergedCoffee = Array.from(coffeeMap.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      await coffeeRepository.saveAll(mergedCoffee);
      setCoffeeCups(mergedCoffee);

      // 4. Merge settings and profile if provided
      if (data.settings) {
        const curSettings = await settingsRepository.get();
        const mergedSettings = { ...curSettings, ...data.settings };
        await settingsRepository.save(mergedSettings);
        setSettings(mergedSettings);
      }
      if (data.profile) {
        const curProfile = await profileRepository.get();
        const mergedProfile = { ...curProfile, ...data.profile };
        await profileRepository.save(mergedProfile);
        setProfile(mergedProfile);
      }

      // 5. Broadcast to other open tabs
      broadcastTags(mergedTags);
      broadcastCoffeeCups(mergedCoffee);

      if (auth.isAuthenticated) {
        await syncWithCloud();
      }

      return { sessionsAdded, tagsAdded, coffeeAdded };
    }
  };

  const resetAllData = async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
    if (scope === 'sessions-only') {
      await clearSessions();
    } else {
      // Factory reset
      await sessionRepository.clear();
      await coffeeRepository.clear();
      authService.clearDeletedTagIds();
      authService.clearDeletedCoffeeCupIds();

      const defaultTags = await tagRepository.resetToDefaults();
      const defaultSettings = await settingsRepository.resetToDefaults();
      const defaultProfile = await profileRepository.resetToDefaults();

      setSessions([]);
      setCoffeeCups([]);
      setTags(defaultTags);
      setSettings(defaultSettings);
      setProfile(defaultProfile);
      setActiveTagId(defaultTags[0]?.id || null);

      if (auth.isAuthenticated) {
        await authService.pushCloudData({
          mode: 'replace',
          tags: defaultTags,
          sessions: [],
          coffeeCups: [],
          settings: defaultSettings,
          profile: defaultProfile,
        });
      }
    }
  };

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
