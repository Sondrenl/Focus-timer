import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../types/tag';
import { CompletedSession } from '../types/session';
import { BackupData } from '../types/user';
import { CoffeeCup } from '../types/coffee';
import { useAuthProfile } from './AuthProfileContext';
import { useTagsData } from '../hooks/data/useTagsData';
import { useSessionsData } from '../hooks/data/useSessionsData';
import { useCoffeeData } from '../hooks/data/useCoffeeData';
import { useCloudMigration } from '../hooks/data/useCloudMigration';
import { useBackupAndMigration } from '../hooks/data/useBackupAndMigration';

export interface DataResetEvent {
  id: number;
  scope: 'sessions-only' | 'factory-reset';
}

export interface DataContextValue {
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
  coffeeCups: CoffeeCup[];
  addCoffeeCup: (tagId: string | null, date?: string) => Promise<CoffeeCup>;
  removeCoffeeCup: (date?: string, tagId?: string | null, cupId?: string) => Promise<boolean>;
  exportBackup: () => BackupData;
  resetAllData: (scope: 'sessions-only' | 'factory-reset') => Promise<void>;
  resetEvent: DataResetEvent | null;
}

const DataContext = createContext<DataContextValue | null>(null);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    isEffectiveAuthenticated,
    isConvexAuthReady,
    profile,
    settings,
    resetProfileToDefaults,
    resetSettingsToDefaults,
    convexSync,
  } = useAuthProfile();

  const setActiveTagIdRef = useRef<((id: string | null) => void) | null>(null);
  const [resetEvent, setResetEvent] = useState<DataResetEvent | null>(null);
  const handleDataReset = useCallback((scope: 'sessions-only' | 'factory-reset') => {
    setResetEvent((prev) => ({ id: (prev?.id ?? 0) + 1, scope }));
  }, []);

  const { isSyncGateActive } = useCloudMigration({
    isEffectiveAuthenticated,
    isConvexAuthReady,
    convexSync,
    setActiveTagId: (id) => setActiveTagIdRef.current?.(id),
  });

  const {
    sessions,
    setSessions,
    recordSession,
  } = useSessionsData({
    isEffectiveAuthenticated,
    isConvexAuthReady,
    isAdoptionPaused: isSyncGateActive,
    convexSync,
  });

  const {
    coffeeCups,
    setCoffeeCups,
    addCoffeeCup,
    removeCoffeeCup,
  } = useCoffeeData({
    isEffectiveAuthenticated,
    isConvexAuthReady,
    isAdoptionPaused: isSyncGateActive,
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
    isConvexAuthReady,
    isAdoptionPaused: isSyncGateActive,
    convexSync,
    setSessions,
    setCoffeeCups,
  });

  setActiveTagIdRef.current = setActiveTagId;

  const { exportBackup, resetAllData } = useBackupAndMigration({
    isEffectiveAuthenticated,
    isConvexAuthReady,
    profile,
    settings,
    resetProfileToDefaults,
    resetSettingsToDefaults,
    convexSync,
    tags,
    setTags,
    setActiveTagId,
    sessions,
    setSessions,
    coffeeCups,
    setCoffeeCups,
    onDataReset: handleDataReset,
  });

  const value = useMemo<DataContextValue>(
    () => ({
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
      coffeeCups,
      addCoffeeCup,
      removeCoffeeCup,
      exportBackup,
      resetAllData,
      resetEvent,
    }),
    [
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
      coffeeCups,
      addCoffeeCup,
      removeCoffeeCup,
      exportBackup,
      resetAllData,
      resetEvent,
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
