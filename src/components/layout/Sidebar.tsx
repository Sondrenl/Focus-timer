import React from 'react';
import { Tag, BarChart3, Settings, User } from 'lucide-react';
import { EggTimerIcon } from '../ui/EggTimerIcon';
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

  // Navigation items without the duplicate timer item; the top title routes home
  const navItems = [
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
          className="fixed inset-0 bg-black/30 z-30 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={onCloseMobile}
        />
      )}

      {/* Navigation Rail (collapsed by default, expands to Drawer on hover) */}
      <aside
        className={clsx(
          'group fixed top-0 bottom-0 left-0 z-40 bg-md-surface-container-low border-r border-md-outline-variant/30 flex flex-col justify-between py-6 px-3 transition-all duration-300 ease-in-out',
          // Mobile state
          isOpenOnMobile
            ? 'w-64 translate-x-0 shadow-elevation-3'
            : '-translate-x-full lg:translate-x-0 shadow-xs hover:shadow-elevation-2',
          // Desktop collapsed width vs hover expanded width
          'lg:w-[72px] lg:hover:w-64'
        )}
      >
        {/* Top: Pomodor Brand / Home Navigation with Egg Timer Icon */}
        <div className="flex flex-col gap-6">
          <button
            onClick={() => handleNav('timer')}
            className="flex items-center gap-3.5 p-1 rounded-2xl transition-colors text-left group/brand hover:bg-md-surface-container"
            title="Pomodor Home"
          >
            {/* Crisp Egg Timer Brand Icon without offset background halos */}
            <div className="w-11 h-11 shrink-0 rounded-2xl bg-md-primary flex items-center justify-center text-white shadow-xs transition-transform group-hover/brand:scale-105">
              <EggTimerIcon className="w-6 h-6" />
            </div>
            <div className="opacity-0 lg:group-hover:opacity-100 max-lg:opacity-100 transition-opacity duration-200 whitespace-nowrap overflow-hidden">
              <span className="text-xl font-bold tracking-tight text-md-on-surface block leading-none">
                Pomodor
              </span>
              <span className="text-[11px] text-md-on-surface-variant tracking-wider font-medium uppercase mt-1 block">
                Focus timer
              </span>
            </div>
          </button>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-2 mt-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  title={item.label}
                  className={clsx(
                    'flex items-center gap-3.5 p-2 rounded-2xl text-sm font-medium transition-all duration-200 text-left relative overflow-hidden',
                    isActive
                      ? 'bg-md-primary-container text-md-on-primary-container font-semibold shadow-xs'
                      : 'text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-on-surface'
                  )}
                >
                  <div className="w-8 h-8 shrink-0 flex items-center justify-center">
                    <Icon
                      className={clsx(
                        'w-5 h-5 transition-transform duration-200',
                        isActive ? 'text-md-primary scale-110' : 'text-md-outline'
                      )}
                    />
                  </div>
                  <span className="opacity-0 lg:group-hover:opacity-100 max-lg:opacity-100 transition-opacity duration-200 whitespace-nowrap overflow-hidden">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom: User Profile Link */}
        <div className="border-t border-md-outline-variant/20 pt-4">
          <button
            onClick={() => handleNav('profile')}
            title="Profile & Sync"
            className={clsx(
              'flex items-center gap-3.5 p-1.5 rounded-2xl transition-all duration-200 text-left w-full overflow-hidden',
              currentView === 'profile'
                ? 'bg-md-secondary-container text-md-on-secondary-container font-semibold'
                : 'hover:bg-md-surface-container text-md-on-surface-variant'
            )}
          >
            <div className="w-10 h-10 rounded-full bg-md-primary/10 border border-md-primary/20 flex items-center justify-center text-md-primary shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div className="opacity-0 lg:group-hover:opacity-100 max-lg:opacity-100 transition-opacity duration-200 whitespace-nowrap overflow-hidden">
              <span className="text-sm font-semibold text-md-on-surface truncate block">
                Focus Practitioner
              </span>
              <span className="text-[11px] text-md-outline truncate block">
                Profile & Sync
              </span>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
};
