import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { TimerProvider } from './context/TimerContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { TimerWorkspace } from './components/timer/TimerWorkspace';
import { CoffeeWorkspace } from './components/coffee/CoffeeWorkspace';
import { TagManager } from './components/tags/TagManager';
import { StatisticsView } from './components/stats/StatisticsView';
import { SettingsView } from './components/settings/SettingsView';
import { ProfileView } from './components/profile/ProfileView';

const MainContent: React.FC = () => {
  const { currentView } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="fixed inset-0 h-[100dvh] w-full md:static md:h-screen md:w-screen flex overflow-hidden bg-md-background">
      {/* Left Collapsible Rail / Sidebar */}
      <Sidebar
        isOpenOnMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Workspace Area with offset for the collapsed rail */}
      <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden lg:pl-[72px]">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain p-2 pb-8 sm:p-4 md:p-6">
          {/* Keep TimerWorkspace mounted so timer ticks and animations stay live across tab switches */}
          <div className={currentView === 'timer' ? 'contents' : 'hidden'}>
            <TimerWorkspace isActiveView={currentView === 'timer'} />
          </div>

          {currentView === 'coffee' && <CoffeeWorkspace />}
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
      <TimerProvider>
        <MainContent />
      </TimerProvider>
    </AppProvider>
  );
}

export default App;
