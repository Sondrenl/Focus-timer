import React, { useState, useEffect, useRef } from 'react';
import { AppProvider, useNavigation } from './context/AppContext';
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
  const { currentView } = useNavigation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Scroll to top when switching views on mobile
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    mainRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [currentView]);

  return (
    <div className="min-h-[100dvh] w-full lg:h-screen lg:w-screen flex lg:overflow-hidden bg-md-background">
      {/* Left Collapsible Rail / Sidebar */}
      <Sidebar
        isOpenOnMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Workspace Area with offset for the collapsed rail */}
      <div className="flex-1 flex flex-col min-h-[100dvh] lg:h-full lg:min-h-0 lg:overflow-hidden lg:pl-[72px]">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />

        <main ref={mainRef} className="flex-1 w-full lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden p-2 pt-[68px] pb-8 sm:p-4 sm:pt-[68px] lg:p-6">
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
