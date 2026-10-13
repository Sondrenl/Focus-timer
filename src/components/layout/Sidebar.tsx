import React from 'react';
import { Timer, Tag, BarChart3, Settings, User } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { clsx } from 'clsx';

interface SidebarProps {
  isOpenOnMobile?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpenOnMobile = false,
  onCloseMobile,
}) => {
  const { currentView, setCurrentView } = useApp();

  const navItems = [
    { id: 'timer' as const, label: 'Timer', icon: Timer },
    { id: 'tags' as const, label: 'Tags', icon: Tag },
    { id: 'stats' as const, label: 'Statistics', icon: BarChart3 },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ];

  const handleNav = (view: 'timer' | 'tags' | 'stats' | 'settings' | 'profile') => {
    setCurrentView(view);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenOnMobile && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={onCloseMobile}
        />
      )}

      {/* Navigation Drawer Container */}
      <aside
        className={clsx(
          'fixed lg:static top-0 bottom-0 left-0 z-40 w-64 md:w-72 bg-md-surface-container-low border-r border-md-outline-variant/30 flex flex-col justify-between py-6 px-4 transition-transform duration-300 ease-in-out',
          isOpenOnMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Top: Pomodor Logo / Brand */}
        <div className="flex flex-col gap-6">
          <button
            onClick={() => handleNav('timer')}
            className="flex items-center gap-3 px-3 py-2 rounded-2xl hover:bg-md-surface-container transition-colors text-left group"
          >
            <div className="w-10 h-10 rounded-2xl bg-md-primary flex items-center justify-center text-white shadow-elevation-1 group-hover:scale-105 transition-transform">
              <Timer className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-md-on-surface block leading-none">
                Pomodor
              </span>
              <span className="text-xs text-md-on-surface-variant tracking-wider font-medium uppercase mt-0.5 block">
                Focus Engine
              </span>
            </div>
          </button>

          {/* Center Navigation Links */}
          <nav className="flex flex-col gap-1.5 mt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  className={clsx(
                    'flex items-center gap-4 px-4 py-3 rounded-full text-sm font-medium transition-all duration-200 text-left',
                    isActive
                      ? 'bg-md-primary-container text-md-on-primary-container font-semibold shadow-xs'
                      : 'text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-on-surface'
                  )}
                >
                  <Icon className={clsx('w-5 h-5', isActive ? 'text-md-primary' : 'text-md-outline')} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom: Profile Link */}
        <div className="border-t border-md-outline-variant/20 pt-4">
          <button
            onClick={() => handleNav('profile')}
            className={clsx(
              'flex items-center gap-3 w-full px-3 py-2.5 rounded-2xl transition-all duration-200 text-left',
              currentView === 'profile'
                ? 'bg-md-secondary-container text-md-on-secondary-container font-semibold'
                : 'hover:bg-md-surface-container text-md-on-surface-variant'
            )}
          >
            <div className="w-9 h-9 rounded-full bg-md-primary/10 border border-md-primary/20 flex items-center justify-center text-md-primary shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <span className="text-sm font-semibold text-md-on-surface truncate block">
                Focus Champion
              </span>
              <span className="text-xs text-md-outline truncate block">
                Profile & Sync
              </span>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
};
