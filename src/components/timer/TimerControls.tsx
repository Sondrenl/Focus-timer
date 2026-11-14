import React from 'react';
import { Play, Pause, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { TimerStatus } from '../../types/timer';

interface TimerControlsProps {
  status: TimerStatus;
  onToggleStartPause: () => void;
  onReset: () => void;
  onSkip: () => void;
  onPrevious: () => void;
}

export const TimerControls: React.FC<TimerControlsProps> = ({
  status,
  onToggleStartPause,
  onReset,
  onSkip,
  onPrevious,
}) => {
  const isRunning = status === 'RUNNING';

  return (
    <div className="flex flex-col items-center justify-center mt-4">
      {/* Top Row: Previous, Play/Pause Hero FAB, Skip Forward */}
      <div className="flex items-center justify-center gap-6">
        {/* Left: Previous Interval */}
        <button
          onClick={onPrevious}
          title="Previous interval (←)"
          className="flex items-center justify-center w-14 h-14 md:w-12 md:h-12 rounded-full bg-md-surface-container-high hover:bg-md-surface-container-highest text-md-on-surface-variant hover:text-md-on-surface transition-all duration-200 active:scale-95 shadow-xs"
          aria-label="Previous interval"
        >
          <SkipBack className="w-6 h-6 md:w-5 md:h-5" />
        </button>

        {/* Center: Start / Pause Toggle (Large M3 Hero FAB) */}
        <button
          onClick={onToggleStartPause}
          className="flex items-center justify-center w-20 h-20 rounded-full bg-md-primary text-md-on-primary hover:bg-[#584192] shadow-elevation-2 hover:shadow-elevation-3 transition-all duration-200 active:scale-95 text-lg group"
          aria-label={isRunning ? 'Pause timer' : 'Start timer'}
        >
          {isRunning ? (
            <Pause className="w-8 h-8 fill-current" />
          ) : (
            <Play className="w-8 h-8 fill-current translate-x-0.5" />
          )}
        </button>

        {/* Right: Skip Forward Button */}
        <button
          onClick={onSkip}
          title="Skip to next interval (→)"
          className="flex items-center justify-center w-14 h-14 md:w-12 md:h-12 rounded-full bg-md-surface-container-high hover:bg-md-surface-container-highest text-md-on-surface-variant hover:text-md-on-surface transition-all duration-200 active:scale-95 shadow-xs"
          aria-label="Skip to next interval"
        >
          <SkipForward className="w-6 h-6 md:w-5 md:h-5" />
        </button>
      </div>

      {/* Below Play/Pause: Centered Reset Button */}
      <div className="flex items-center justify-center mt-3">
        <button
          onClick={onReset}
          title="Reset interval (R)"
          className="flex items-center justify-center w-11 h-11 rounded-full bg-md-surface-container hover:bg-md-surface-container-high text-md-on-surface-variant hover:text-md-on-surface transition-all duration-200 active:scale-95 shadow-xs"
          aria-label="Reset interval"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

