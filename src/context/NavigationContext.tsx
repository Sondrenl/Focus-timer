import React, { createContext, useContext, useState, useMemo } from 'react';

export type AppView = 'timer' | 'coffee' | 'tags' | 'stats' | 'settings' | 'profile';

export interface NavigationContextValue {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentView, setCurrentView] = useState<AppView>('timer');

  const value = useMemo<NavigationContextValue>(
    () => ({
      currentView,
      setCurrentView,
    }),
    [currentView]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};

export const useNavigation = (): NavigationContextValue => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};
