import React, { useEffect } from 'react';
import { TagSelector } from './TagSelector';
import { TimerDisplay } from './TimerDisplay';
import { TimerControls } from './TimerControls';
import { CycleIndicator } from './CycleIndicator';
import { useTimer } from '../../hooks/useTimer';

interface TimerWorkspaceProps {
  isActiveView?: boolean;
}

export const TimerWorkspace: React.FC<TimerWorkspaceProps> = ({ isActiveView = true }) => {
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
  } = useTimer();

  // Keyboard shortcut listener (Space = Toggle, R = Reset, S = Skip)
  // Only active when the Timer tab is actively displayed to the user
  useEffect(() => {
    if (!isActiveView) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
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
  }, [isActiveView, toggleStartPause, resetTimer, skipInterval]);

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center justify-center py-6 px-4">
      {/* Top Tag Selector */}
      <div className="w-full flex flex-col items-center mb-6">
        <TagSelector />
      </div>

      {/* Central Timer Elements (no box/card container) */}
      <div className="w-full flex flex-col items-center">
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

      {/* Helpful keyboard cues (hidden on mobile devices) */}
      <div className="hidden sm:flex items-center gap-4 text-[11px] text-md-outline mt-8 select-none font-mono">
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">Space</kbd> Start/Pause</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">R</kbd> Reset</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">S</kbd> Skip</span>
      </div>
    </div>
  );
};
