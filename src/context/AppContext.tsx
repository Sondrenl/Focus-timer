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
import { isPreviewOrDev, isProduction } from '../utils/environment';

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
      const currentTags = await tagRepository.getAll();
      const currentSessions = await sessionRepository.getAll();
      const currentSettings = await settingsRepository.get();
      const currentProfile = await profileRepository.get();
      const deletedTagIds = authService.getDeletedTagIds();

      // 1. Push local state to Cloudflare Worker with deletedTagIds
      await authService.pushCloudData({
        profile: {
          displayName: currentProfile.displayName,
          avatarEmoji: currentProfile.avatarEmoji,
          dailyGoalMinutes: currentProfile.dailyGoalMinutes,
        },
        tags: currentTags,
        deletedTagIds: Array.from(deletedTagIds),
        sessions: currentSessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-')),
        settings: currentSettings,
      });

      // 2. Fetch latest combined state from Cloudflare
      const cloudData = await authService.fetchCloudData();

      if (cloudData) {
        if (Array.isArray(cloudData.deletedTagIds)) {
          cloudData.deletedTagIds.forEach((id) => authService.addDeletedTagId(id));
        }
        const effectiveDeletedTagIds = authService.getDeletedTagIds();

        // Merge cloud tags EXCLUDING any locally or remotely deleted tag IDs
        const validLocalTags = currentTags.filter((t) => !effectiveDeletedTagIds.has(t.id));
        const mergedTagMap = new Map<string, Tag>();
        validLocalTags.forEach((t) => mergedTagMap.set(t.id, t));
        (cloudData.tags || []).forEach((t) => {
          if (!effectiveDeletedTagIds.has(t.id)) {
            mergedTagMap.set(t.id, t);
          }
        });
        const finalTags = Array.from(mergedTagMap.values());
        await tagRepository.saveAll(finalTags);
        setTags(finalTags);

        // Merge cloud sessions
        if (cloudData.sessions) {
          const sessionMap = new Map<string, CompletedSession>();
          currentSessions.forEach((s) => sessionMap.set(s.id, s));
          cloudData.sessions.forEach((s) => {
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

      const cleanSessions = isProduction()
        ? loadedSessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-'))
        : loadedSessions;
      setProfile(loadedProfile);
      setTags(loadedTags);
      setSessions(cleanSessions);
      setSettings(loadedSettings);
      if (isProduction() && cleanSessions.length !== loadedSessions.length) {
        await sessionRepository.saveAll(cleanSessions);
      }

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

    // 5. If authenticated, explicitly delete on server and push
    if (auth.isAuthenticated) {
      await authService.deleteTag(id);
      syncWithCloud();
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
      setAuth((prev) => ({ ...prev, isSyncing: true }));
      try {
        await authService.pushCloudData({
          clearSessions: true,
          sessions: [],
        });
        const nowIso = new Date().toISOString();
        setAuth((prev) => ({ ...prev, isSyncing: false, lastSyncedAt: nowIso }));
      } catch (err) {
        console.error('Error clearing sessions in cloud:', err);
        setAuth((prev) => ({ ...prev, isSyncing: false, syncError: (err as Error).message }));
      }
    }
  };

  const reloadSampleData = async (): Promise<void> => {
    if (isProduction()) return;
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
    const cleanSessions = isProduction()
      ? sessions.filter((s) => !s.id.startsWith('seed-session-') && !s.id.startsWith('sample-session-'))
      : sessions;
    return {
      version: '2.0.1',
      exportedAt: new Date().toISOString(),
      profile,
      settings,
      tags,
      sessions: cleanSessions,
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
      // Clear deleted tags tracking so imported tags are never blocked
      authService.clearDeletedTagIds();

      finalTags = incomingTags;
      finalSessions = incomingSessions;
      sessionsAdded = incomingSessions.length;
      tagsAdded = incomingTags.length;

      let finalProfile = profile;
      if (data.profile) {
        finalProfile = { ...DEFAULT_PROFILE, ...data.profile };
        await profileRepository.save(finalProfile);
        setProfile(finalProfile);
      }

      let finalSettings = settings;
      if (data.settings) {
        finalSettings = { ...DEFAULT_SETTINGS, ...data.settings };
        await settingsRepository.save(finalSettings);
        setSettings(finalSettings);
      }

      // Save locally
      await tagRepository.saveAll(finalTags);
      await sessionRepository.saveAll(finalSessions);
      setTags(finalTags);
      setSessions(finalSessions);

      const firstActive = finalTags.find((t) => !t.isArchived);
      setActiveTagId(firstActive?.id ?? null);

      // Overwrite cloud state completely without pulling/merging old cloud records!
      if (auth.isAuthenticated) {
        setAuth((prev) => ({ ...prev, isSyncing: true }));
        try {
          await authService.pushCloudData({
            mode: 'replace',
            profile: finalProfile,
            settings: finalSettings,
            tags: finalTags,
            sessions: finalSessions,
          });
          const nowIso = new Date().toISOString();
          setAuth((prev) => ({ ...prev, isSyncing: false, lastSyncedAt: nowIso }));
        } catch (err) {
          console.error('Error overwriting cloud data on replace:', err);
          setAuth((prev) => ({ ...prev, isSyncing: false, syncError: (err as Error).message }));
        }
      }
    } else {
      // Merge mode
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

      await tagRepository.saveAll(finalTags);
      await sessionRepository.saveAll(finalSessions);

      setTags(finalTags);
      setSessions(finalSessions);

      if (auth.isAuthenticated) {
        syncWithCloud();
      }
    }

    return { sessionsAdded, tagsAdded };
  };

  const resetAllData = async (scope: 'sessions-only' | 'factory-reset'): Promise<void> => {
    if (scope === 'sessions-only') {
      await clearSessions();
    } else {
      authService.clearDeletedTagIds();
      await sessionRepository.clear();
      const defTags = await tagRepository.resetToDefaults();
      const defSettings = await settingsRepository.resetToDefaults();
      const defProfile = await profileRepository.resetToDefaults();

      setSessions([]);
      setTags(defTags);
      setSettings(defSettings);
      setProfile(defProfile);
      setActiveTagId(defTags[0]?.id ?? null);

      if (auth.isAuthenticated) {
        await authService.pushCloudData({
          mode: 'replace',
          profile: defProfile,
          settings: defSettings,
          tags: defTags,
          sessions: [],
        });
      }
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
