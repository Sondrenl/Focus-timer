import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { TimerWorkspace } from './components/timer/TimerWorkspace';
import { TagManager } from './components/tags/TagManager';
import { StatisticsView } from './components/stats/StatisticsView';
import { SettingsView } from './components/settings/SettingsView';
import { ProfileView } from './components/profile/ProfileView';

const MainContent: React.FC = () => {
  const { currentView } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-md-background">
      {/* Left Sidebar */}
      <Sidebar
        isOpenOnMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-2 sm:p-4 md:p-6">
          {currentView === 'timer' && <TimerWorkspace />}
          {currentView === 'tags' && <TagManager />}
          {currentView === 'stats' && <StatisticsView />}
          {currentView === 'settings' && <SettingsView />}
          {currentView === 'profile' && <ProfileView />}
        </main>
      </div>
    </div>
  );
};

export function App() {
  return (
    <AppProvider>
      <MainContent />
    </AppProvider>
  );
}

export default App;
