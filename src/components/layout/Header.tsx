import React from 'react';
import { Menu, Volume2, VolumeX } from 'lucide-react';
import { useAuthProfile } from '../../context/AuthProfileContext';

interface HeaderProps {
  onOpenMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const { settings, updateSettings, sound } = useAuthProfile();

  const toggleSound = () => {
    const nextEnabled = !settings.soundEnabled;
    if (nextEnabled) {
      sound.prepareForPlayback();
    }
    updateSettings({ soundEnabled: nextEnabled });
  };

  return (
    <header className="w-full shrink-0 flex items-center justify-between px-4 lg:px-6 py-3 bg-transparent">
      {/* Left: Mobile hamburger drawer trigger */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden w-11 h-11 flex items-center justify-center rounded-2xl bg-md-surface-container/80 text-md-on-surface-variant hover:bg-md-surface-container-high active:scale-95 transition-all shadow-xs"
          aria-label="Open navigation menu"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Right: Sound chime toggle (icon only) */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSound}
          className="w-11 h-11 lg:w-10 lg:h-10 rounded-full flex items-center justify-center bg-md-surface-container hover:bg-md-surface-container-high text-md-on-surface-variant hover:text-md-on-surface transition-all shadow-xs active:scale-95"
          title={settings.soundEnabled ? 'Mute sounds & alerts' : 'Enable sounds & alerts'}
          aria-label={settings.soundEnabled ? 'Mute sounds & alerts' : 'Enable sounds & alerts'}
        >
          {settings.soundEnabled ? (
            <Volume2 className="w-5 h-5 lg:w-5 lg:h-5 text-md-primary" />
          ) : (
            <VolumeX className="w-5 h-5 lg:w-5 lg:h-5 text-md-outline" />
          )}
        </button>
      </div>
    </header>
  );
};
