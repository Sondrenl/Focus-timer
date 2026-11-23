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

  // Swipe gestures for opening / closing the sidebar drawer on mobile
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Do not initiate global swipe if touching interactive controls like sliders or text inputs
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) {
        touchStartX = 0;
        touchStartY = 0;
        return;
      }
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length !== 1 || touchStartX === 0) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;

      // Ensure horizontal swipe is dominant
      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) * 1.5;
      if (!isHorizontalSwipe) return;

      if (!mobileMenuOpen) {
        // Swiping left-to-right anywhere on the screen opens sidebar
        if (deltaX > 50) {
          setMobileMenuOpen(true);
        }
      } else {
        // Swiping right-to-left anywhere on the screen closes sidebar
        if (deltaX < -50) {
          setMobileMenuOpen(false);
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [mobileMenuOpen]);

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden lg:h-screen lg:w-screen flex lg:overflow-hidden bg-md-background">
      {/* Left Collapsible Rail / Sidebar */}
      <Sidebar
        isOpenOnMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Workspace Area with offset for the collapsed rail */}
      <div className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden flex flex-col min-h-[100dvh] lg:h-full lg:min-h-0 lg:overflow-hidden lg:pl-[72px]">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />

        <main ref={mainRef} className="flex-1 min-w-0 w-full overflow-x-hidden lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden p-2 pb-8 sm:p-4 lg:p-6">
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
