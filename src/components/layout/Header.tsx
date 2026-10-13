import React from 'react';
import { Menu, Volume2, VolumeX } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { clsx } from 'clsx';

interface HeaderProps {
  onOpenMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const { currentView, settings, updateSettings } = useApp();

  const viewTitles: Record<string, { title: string; subtitle: string }> = {
    tags: { title: 'Tag Management', subtitle: 'Organize and label your focus categories' },
    stats: { title: 'Statistics & Analytics', subtitle: 'Review your focus distribution and trends' },
    settings: { title: 'Preferences & Durations', subtitle: 'Configure cycle lengths and audio cues' },
    profile: { title: 'Account Profile', subtitle: 'Local sync and workspace overview' },
  };

  const currentInfo = viewTitles[currentView];

  const toggleSound = () => {
    updateSettings({ soundEnabled: !settings.soundEnabled });
  };

  const isTimerView = currentView === 'timer';

  return (
    <header
      className={clsx(
        'w-full flex items-center justify-between px-6 py-4 sticky top-0 z-20 transition-all',
        isTimerView
          ? 'bg-transparent border-b border-transparent'
          : 'bg-md-surface/80 backdrop-blur-md border-b border-md-outline-variant/20'
      )}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>

        {/* Show title only when NOT on timer view */}
        {!isTimerView && currentInfo && (
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-md-on-surface tracking-tight">
              {currentInfo.title}
            </h1>
            <p className="text-xs text-md-on-surface-variant hidden sm:block">
              {currentInfo.subtitle}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleSound}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium bg-md-surface-container hover:bg-md-surface-container-high transition-colors text-md-on-surface-variant shadow-xs"
          title={settings.soundEnabled ? 'Mute sound chime' : 'Enable sound chime'}
        >
          {settings.soundEnabled ? (
            <>
              <Volume2 className="w-4 h-4 text-md-primary" />
              <span className="hidden sm:inline">Chime On</span>
            </>
          ) : (
            <>
              <VolumeX className="w-4 h-4 text-md-outline" />
              <span className="hidden sm:inline">Muted</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
