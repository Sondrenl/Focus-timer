import React, { useState, useEffect } from 'react';
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

  // Scroll to top when switching views on mobile
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [currentView]);

  return (
    <div className="min-h-[100dvh] w-full md:h-screen md:w-screen flex md:overflow-hidden bg-md-background">
      {/* Left Collapsible Rail / Sidebar */}
      <Sidebar
        isOpenOnMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Workspace Area with offset for the collapsed rail */}
      <div className="flex-1 flex flex-col min-h-[100dvh] md:h-full md:min-h-0 md:overflow-hidden lg:pl-[72px]">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />

        <main className="flex-1 w-full md:min-h-0 md:overflow-y-auto md:overflow-x-hidden p-2 pt-[68px] pb-8 sm:p-4 sm:pt-[68px] md:p-6">
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
