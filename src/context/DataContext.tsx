import React, { createContext, useContext, useMemo } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { BackupData } from '../types/user';
import { CoffeeCup } from '../types/coffee';
import { useAuthProfile } from './AuthProfileContext';
import { useTagsData } from '../hooks/data/useTagsData';
import { useSessionsData } from '../hooks/data/useSessionsData';
import { useCoffeeData } from '../hooks/data/useCoffeeData';
import { useBackupAndMigration } from '../hooks/data/useBackupAndMigration';

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
    sessions,
    setSessions,
    isDemoEnvironment,
    recordSession,
    clearSessions,
    reloadSampleData,
  } = useSessionsData({
    isEffectiveAuthenticated,
    convexSync,
  });

  const {
    coffeeCups,
    setCoffeeCups,
    addCoffeeCup,
    removeCoffeeCup,
  } = useCoffeeData({
    isEffectiveAuthenticated,
    convexSync,
  });

  const {
    tags,
    setTags,
    activeTags,
    activeTagId,
    setActiveTagId,
    createTag,
    updateTag,
    archiveTag,
    unarchiveTag,
    deleteTag,
  } = useTagsData({
    isEffectiveAuthenticated,
    convexSync,
    setSessions,
    setCoffeeCups,
  });

  const { exportBackup, importBackup, resetAllData } = useBackupAndMigration({
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
    activeTagId,
    setActiveTagId,
    sessions,
    setSessions,
    coffeeCups,
    setCoffeeCups,
  });

  const value = useMemo<DataContextValue>(
    () => ({
      isDemoEnvironment,
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
      isDemoEnvironment,
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
