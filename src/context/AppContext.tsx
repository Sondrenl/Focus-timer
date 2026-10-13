import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { LocalStorageService } from '../services/storage/LocalStorageService';
import { TagRepository } from '../services/repository/TagRepository';
import { SessionRepository } from '../services/repository/SessionRepository';
import { SettingsRepository } from '../services/repository/SettingsRepository';
import { SoundService, soundService } from '../services/audio/SoundService';
import { NotificationService, notificationService } from '../services/notification/NotificationService';

interface AppContextValue {
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

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'timer' | 'tags' | 'stats' | 'settings' | 'profile'>('timer');

  // Load initial data
  useEffect(() => {
    async function init() {
      const [loadedTags, loadedSessions, loadedSettings] = await Promise.all([
        tagRepository.getAll(),
        sessionRepository.getAll(),
        settingsRepository.get(),
      ]);

      setTags(loadedTags);
      setSessions(loadedSessions);
      setSettings(loadedSettings);

      // Default active tag to first non-archived tag
      const firstActive = loadedTags.find((t) => !t.isArchived);
      if (firstActive) {
        setActiveTagId(firstActive.id);
      }
    }
    init();
  }, []);

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  // Make sure activeTagId is valid; if current tag is archived, fallback to first active
  useEffect(() => {
    if (activeTagId && activeTags.length > 0) {
      const exists = activeTags.some((t) => t.id === activeTagId);
      if (!exists) {
        setActiveTagId(activeTags[0].id);
      }
    } else if (!activeTagId && activeTags.length > 0) {
      setActiveTagId(activeTags[0].id);
    }
  }, [activeTags, activeTagId]);

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
        const remaining = updated.filter((t) => !t.isArchived);
        setActiveTagId(remaining.length > 0 ? remaining[0].id : null);
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

  return (
    <AppContext.Provider
      value={{
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
