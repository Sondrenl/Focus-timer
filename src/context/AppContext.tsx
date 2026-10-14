import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { UserProfile, DEFAULT_PROFILE, BackupData } from '../types/user';
import { LocalStorageService } from '../services/storage/LocalStorageService';
import { TagRepository } from '../services/repository/TagRepository';
import { SessionRepository } from '../services/repository/SessionRepository';
import { SettingsRepository } from '../services/repository/SettingsRepository';
import { ProfileRepository } from '../services/repository/ProfileRepository';
import { SoundService, soundService } from '../services/audio/SoundService';
import { NotificationService, notificationService } from '../services/notification/NotificationService';

interface AppContextValue {
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

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'timer' | 'tags' | 'stats' | 'settings' | 'profile'>('timer');

  // Load initial data
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

      // Default active tag to first non-archived tag if available
      const firstActive = loadedTags.find((t) => !t.isArchived);
      if (firstActive) {
        setActiveTagId(firstActive.id);
      }
    }
    init();
  }, []);

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  // If currently selected tag ID was deleted or archived, fallback to null (Unspecified) or first active
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
  };

  // Tag Operations
  const createTag = async (input: CreateTagInput): Promise<Tag> => {
    const created = await tagRepository.create(input);
    const updated = await tagRepository.getAll();
    setTags(updated);
    setActiveTagId(created.id);
    return created;
  };

  const updateTag = async (id: string, updates: UpdateTagInput): Promise<Tag | null> => {
    const result = await tagRepository.update(id, updates);
    const updated = await tagRepository.getAll();
    setTags(updated);
    return result;
  };

  const archiveTag = async (id: string): Promise<Tag | null> => {
    const result = await tagRepository.archive(id);
    const updated = await tagRepository.getAll();
    setTags(updated);
    return result;
  };

  const unarchiveTag = async (id: string): Promise<Tag | null> => {
    const result = await tagRepository.unarchive(id);
    const updated = await tagRepository.getAll();
    setTags(updated);
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
    }
    return success;
  };

  // Session Operations
  const recordSession = async (sessionData: Omit<CompletedSession, 'id'>): Promise<CompletedSession> => {
    const created = await sessionRepository.add(sessionData);
    setSessions((prev) => [...prev, created]);
    return created;
  };

  const clearSessions = async (): Promise<void> => {
    await sessionRepository.clear();
    setSessions([]);
  };

  // Settings Operations
  const updateSettings = async (newValues: Partial<UserSettings>): Promise<void> => {
    const merged = { ...settings, ...newValues };
    await settingsRepository.save(merged);
    setSettings(merged);
  };

  // Data Operations (Export / Import / Reset)
  const exportBackup = (): BackupData => {
    return {
      version: '1.0.0',
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
    }

    await tagRepository.saveAll(finalTags);
    await sessionRepository.saveAll(finalSessions);

    setTags(finalTags);
    setSessions(finalSessions);

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
  };

  return (
    <AppContext.Provider
      value={{
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
