import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { UserProfile, DEFAULT_PROFILE, BackupData, AuthState } from '../types/user';
import { LocalStorageService } from '../services/storage/LocalStorageService';
import { TagRepository } from '../services/repository/TagRepository';
import { SessionRepository } from '../services/repository/SessionRepository';
import { SettingsRepository } from '../services/repository/SettingsRepository';
import { ProfileRepository } from '../services/repository/ProfileRepository';
import { AuthService } from '../services/auth/AuthService';
import { SoundService, soundService } from '../services/audio/SoundService';
import { NotificationService, notificationService } from '../services/notification/NotificationService';
import { isPreviewOrDev } from '../utils/environment';

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

  // Sessions
  sessions: CompletedSession[];
  recordSession: (session: Omit<CompletedSession, 'id'>) => Promise<CompletedSession>;
  clearSessions: () => Promise<void>;

  // Settings
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;

  // Data Import / Export / Reset
  exportBackup: () => BackupData;
  importBackup: (data: BackupData, mode: 'merge' | 'replace') => Promise<{ sessionsAdded: number; tagsAdded: number }>;
  resetAllData: (scope: 'sessions-only' | 'factory-reset') => Promise<void>;

  // Services
  sound: SoundService;
  notifications: NotificationService;

  // View Navigation
  currentView: 'timer' | 'tags' | 'stats' | 'settings' | 'profile';
  setCurrentView: (view: 'timer' | 'tags' | 'stats' | 'settings' | 'profile') => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// Initialize singletons for dependency injection
const storageService = new LocalStorageService();
const tagRepository = new TagRepository(storageService);
const sessionRepository = new SessionRepository(storageService);
const settingsRepository = new SettingsRepository(storageService);
const profileRepository = new ProfileRepository(storageService);
const authService = AuthService.getInstance();

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'timer' | 'tags' | 'stats' | 'settings' | 'profile'>('timer');
  const [auth, setAuth] = useState<AuthState>(() => authService.getInitialAuthState());

  const isDemo = useMemo(() => isPreviewOrDev(), []);

  // Synchronize local data with Cloudflare D1
  const syncWithCloud = useCallback(async (): Promise<void> => {
    if (!authService.getStoredToken()) return;

    setAuth((prev) => ({ ...prev, isSyncing: true, syncError: null }));

    try {
      // 1. Gather current local state
      const currentTags = await tagRepository.getAll();
      const currentSessions = await sessionRepository.getAll();
      const currentSettings = await settingsRepository.get();
      const currentProfile = await profileRepository.get();

      // 2. Push local state to Cloudflare Worker
      await authService.pushCloudData({
        profile: {
          displayName: currentProfile.displayName,
          avatarEmoji: currentProfile.avatarEmoji,
          dailyGoalMinutes: currentProfile.dailyGoalMinutes,
        },
        tags: currentTags,
        sessions: currentSessions,
        settings: currentSettings,
      });

      // 3. Fetch latest combined state from Cloudflare
      const cloudData = await authService.fetchCloudData();

      if (cloudData) {
        // Merge cloud tags
        if (cloudData.tags && cloudData.tags.length > 0) {
          const mergedTagMap = new Map<string, Tag>();
          currentTags.forEach((t) => mergedTagMap.set(t.id, t));
          cloudData.tags.forEach((t) => mergedTagMap.set(t.id, t));
          const finalTags = Array.from(mergedTagMap.values());
          await tagRepository.saveAll(finalTags);
          setTags(finalTags);
        }

        // Merge cloud sessions
        if (cloudData.sessions && cloudData.sessions.length > 0) {
          const sessionMap = new Map<string, CompletedSession>();
          currentSessions.forEach((s) => sessionMap.set(s.id, s));
          cloudData.sessions.forEach((s) => sessionMap.set(s.id, s));
          const finalSessions = Array.from(sessionMap.values()).sort(
            (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
          );
          await sessionRepository.saveAll(finalSessions);
          setSessions(finalSessions);
        }

        // Merge cloud settings
        if (cloudData.settings) {
          const mergedSettings = { ...currentSettings, ...cloudData.settings };
          await settingsRepository.save(mergedSettings);
          setSettings(mergedSettings);
        }

        // Merge cloud profile
        if (cloudData.profile) {
          const mergedProfile = { ...currentProfile, ...cloudData.profile };
          await profileRepository.save(mergedProfile);
          setProfile(mergedProfile);
        }
      }

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
    }
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
        ...profile,
        id: user.id,
        email: user.email,
        avatarUrl: user.avatarUrl,
        avatarEmoji: '', // Switch to Google account photo
        displayName: user.displayName || profile.displayName,
      };
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
    // Remove cloud-specific fields from local profile
    const cleanedProfile: UserProfile = {
      ...profile,
      id: undefined,
      email: undefined,
      avatarUrl: undefined,
    };
    profileRepository.save(cleanedProfile);
    setProfile(cleanedProfile);
  };

  // Load initial local data and verify cloud auth on mount
  useEffect(() => {
    async function init() {
      const [loadedProfile, loadedTags, loadedSessions, loadedSettings] = await Promise.all([
        profileRepository.get(),
        tagRepository.getAll(),
        sessionRepository.getAll(),
        settingsRepository.get(),
      ]);

      setProfile(loadedProfile);
      setTags(loadedTags);
      setSessions(loadedSessions);
      setSettings(loadedSettings);

      const firstActive = loadedTags.find((t) => !t.isArchived);
      if (firstActive) {
        setActiveTagId(firstActive.id);
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
          // Run background sync
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
  }, [syncWithCloud]);

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  useEffect(() => {
    if (activeTagId !== null && activeTags.length > 0) {
      const exists = activeTags.some((t) => t.id === activeTagId);
      if (!exists) {
        setActiveTagId(null);
      }
    }
  }, [activeTags, activeTagId]);

  // Profile Operations
  const updateProfile = async (newProfile: Partial<UserProfile>): Promise<void> => {
    const merged = { ...profile, ...newProfile };
    await profileRepository.save(merged);
    setProfile(merged);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
  };

  // Tag Operations
  const createTag = async (input: CreateTagInput): Promise<Tag> => {
    const created = await tagRepository.create(input);
    const updated = await tagRepository.getAll();
    setTags(updated);
    setActiveTagId(created.id);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
    return created;
  };

  const updateTag = async (id: string, updates: UpdateTagInput): Promise<Tag | null> => {
    const result = await tagRepository.update(id, updates);
    const updated = await tagRepository.getAll();
    setTags(updated);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
    return result;
  };

  const archiveTag = async (id: string): Promise<Tag | null> => {
    const result = await tagRepository.archive(id);
    const updated = await tagRepository.getAll();
    setTags(updated);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
    return result;
  };

  const unarchiveTag = async (id: string): Promise<Tag | null> => {
    const result = await tagRepository.unarchive(id);
    const updated = await tagRepository.getAll();
    setTags(updated);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
    return result;
  };

  const deleteTag = async (id: string): Promise<boolean> => {
    const success = await tagRepository.delete(id);
    if (success) {
      const updated = await tagRepository.getAll();
      setTags(updated);
      if (activeTagId === id) {
        setActiveTagId(null);
      }
      if (auth.isAuthenticated) {
        syncWithCloud();
      }
    }
    return success;
  };

  // Session Operations
  const recordSession = async (sessionData: Omit<CompletedSession, 'id'>): Promise<CompletedSession> => {
    const created = await sessionRepository.add(sessionData);
    setSessions((prev) => [...prev, created]);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
    return created;
  };

  const clearSessions = async (): Promise<void> => {
    await sessionRepository.clear();
    setSessions([]);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
  };

  const reloadSampleData = async (): Promise<void> => {
    const samples = await sessionRepository.loadSampleData();
    setSessions(samples);
  };

  // Settings Operations
  const updateSettings = async (newValues: Partial<UserSettings>): Promise<void> => {
    const merged = { ...settings, ...newValues };
    await settingsRepository.save(merged);
    setSettings(merged);
    if (auth.isAuthenticated) {
      syncWithCloud();
    }
  };

  // Data Operations (Export / Import / Reset)
  const exportBackup = (): BackupData => {
    return {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      profile,
      settings,
      tags,
      sessions,
    };
  };

  const importBackup = async (
    data: BackupData,
    mode: 'merge' | 'replace'
  ): Promise<{ sessionsAdded: number; tagsAdded: number }> => {
    const incomingTags = Array.isArray(data.tags) ? data.tags : [];
    const incomingSessions = Array.isArray(data.sessions) ? data.sessions : [];

    let finalTags: Tag[] = [];
    let finalSessions: CompletedSession[] = [];
    let sessionsAdded = 0;
    let tagsAdded = 0;

    if (mode === 'replace') {
      finalTags = incomingTags.length > 0 ? incomingTags : tags;
      finalSessions = incomingSessions;
      sessionsAdded = incomingSessions.length;
      tagsAdded = incomingTags.length;

      if (data.profile) {
        const mergedProf = { ...DEFAULT_PROFILE, ...data.profile };
        await profileRepository.save(mergedProf);
        setProfile(mergedProf);
      }
      if (data.settings) {
        const mergedSett = { ...DEFAULT_SETTINGS, ...data.settings };
        await settingsRepository.save(mergedSett);
        setSettings(mergedSett);
      }
    } else {
      const existingTagIds = new Set(tags.map((t) => t.id));
      const existingTagNames = new Set(tags.map((t) => t.name.toLowerCase().trim()));
      const newTagsToKeep: Tag[] = [];

      for (const t of incomingTags) {
        if (!existingTagIds.has(t.id) && !existingTagNames.has(t.name.toLowerCase().trim())) {
          newTagsToKeep.push(t);
          existingTagIds.add(t.id);
          tagsAdded++;
        }
      }
      finalTags = [...tags, ...newTagsToKeep];

      const existingSessionIds = new Set(sessions.map((s) => s.id));
      const newSessionsToKeep: CompletedSession[] = [];
      for (const s of incomingSessions) {
        if (!existingSessionIds.has(s.id)) {
          newSessionsToKeep.push(s);
          existingSessionIds.add(s.id);
          sessionsAdded++;
        }
      }
      finalSessions = [...sessions, ...newSessionsToKeep];
    }

    await tagRepository.saveAll(finalTags);
    await sessionRepository.saveAll(finalSessions);

    setTags(finalTags);
    setSessions(finalSessions);

    if (auth.isAuthenticated) {
      syncWithCloud();
    }

    return { sessionsAdded, tagsAdded };
  };

  const resetAllData = async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
    if (scope === 'sessions-only') {
      await sessionRepository.clear();
      setSessions([]);
    } else {
      await sessionRepository.clear();
      const defTags = await tagRepository.resetToDefaults();
      const defSettings = await settingsRepository.resetToDefaults();
      const defProfile = await profileRepository.resetToDefaults();

      setSessions([]);
      setTags(defTags);
      setSettings(defSettings);
      setProfile(defProfile);
      setActiveTagId(defTags[0]?.id ?? null);
    }

    if (auth.isAuthenticated) {
      syncWithCloud();
    }
  };

  return (
    <AppContext.Provider
      value={{
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
        currentView,
        setCurrentView,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
