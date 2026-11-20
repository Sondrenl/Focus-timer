import React, { useEffect } from 'react';
import { TagSelector } from './TagSelector';
import { TimerDisplay } from './TimerDisplay';
import { TimerControls } from './TimerControls';
import { CycleIndicator } from './CycleIndicator';
import { useTimer } from '../../context/TimerContext';

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
    previousInterval,
  } = useTimer();

  // Keyboard shortcut listener (Space = Toggle, ArrowLeft = Back, ArrowRight = Skip, R = Reset)
  // Only active when the Timer tab is actively displayed to the user
  useEffect(() => {
    if (!isActiveView) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector('[role="dialog"], [role="listbox"]')) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggleStartPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        previousInterval();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipInterval();
      } else if (e.key === 'r' || e.key === 'R') {
        resetTimer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActiveView, toggleStartPause, resetTimer, skipInterval, previousInterval]);

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
          onPrevious={previousInterval}
        />
      </div>

      {/* Helpful keyboard cues (hidden on mobile devices) */}
      <div className="hidden sm:flex items-center gap-4 text-[11px] text-md-outline mt-8 select-none font-mono">
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">Space</kbd> Start/Pause</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">←</kbd> Back</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">→</kbd> Skip</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">R</kbd> Reset</span>
      </div>
    </div>
  );
};
