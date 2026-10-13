import React, { useEffect } from 'react';
import { TagSelector } from './TagSelector';
import { TimerDisplay } from './TimerDisplay';
import { TimerControls } from './TimerControls';
import { CycleIndicator } from './CycleIndicator';
import { useTimer } from '../../hooks/useTimer';
import { SessionType } from '../../types/timer';
import { clsx } from 'clsx';

export const TimerWorkspace: React.FC = () => {
  const {
    sessionType,
    status,
    remainingSeconds,
    totalSeconds,
    currentCycle,
    maxCycles,
    toggleStartPause,
    resetTimer,
    skipInterval,
    setSessionTypeManually,
  } = useTimer();

  // Keyboard shortcut listener (Space = Toggle, R = Reset, S = Skip)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggleStartPause();
      } else if (e.key === 'r' || e.key === 'R') {
        resetTimer();
      } else if (e.key === 's' || e.key === 'S') {
        skipInterval();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleStartPause, resetTimer, skipInterval]);

  const tabs: { type: SessionType; label: string }[] = [
    { type: 'WORK', label: 'Pomodoro' },
    { type: 'SHORT_BREAK', label: 'Short Break' },
    { type: 'LONG_BREAK', label: 'Long Break' },
  ];

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center justify-center py-6 px-4">
      {/* Top Workspace Controls: Tag Selector & Mode Tabs */}
      <div className="w-full flex flex-col items-center gap-5 mb-2">
        <TagSelector />

        {/* Mode Segmented Button / Tabs */}
        <div className="inline-flex p-1 bg-md-surface-container rounded-full border border-md-outline-variant/30 shadow-xs">
          {tabs.map((tab) => {
            const isActive = sessionType === tab.type;
            return (
              <button
                key={tab.type}
                onClick={() => setSessionTypeManually(tab.type)}
                className={clsx(
                  'px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 select-none',
                  isActive
                    ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                    : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high'
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Timer Display Card */}
      <div className="w-full bg-md-surface-container-low border border-md-outline-variant/20 rounded-3xl p-6 md:p-8 flex flex-col items-center shadow-elevation-1">
        <CycleIndicator
          currentCycle={currentCycle}
          maxCycles={maxCycles}
          sessionType={sessionType}
        />

        <TimerDisplay
          remainingSeconds={remainingSeconds}
          totalSeconds={totalSeconds}
          sessionType={sessionType}
          status={status}
        />

        <TimerControls
          status={status}
          onToggleStartPause={toggleStartPause}
          onReset={resetTimer}
          onSkip={skipInterval}
        />
      </div>

      {/* Helpful keyboard cues */}
      <div className="flex items-center gap-4 text-[11px] text-md-outline mt-6 select-none font-mono">
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">Space</kbd> Start/Pause</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">R</kbd> Reset</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">S</kbd> Skip</span>
      </div>
    </div>
  );
};
