import React from 'react';
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react';
import { TimerStatus } from '../../types/timer';

interface TimerControlsProps {
  status: TimerStatus;
  onToggleStartPause: () => void;
  onReset: () => void;
  onSkip: () => void;
}

export const TimerControls: React.FC<TimerControlsProps> = ({
  status,
  onToggleStartPause,
  onReset,
  onSkip,
}) => {
  const isRunning = status === 'RUNNING';

  return (
    <div className="flex items-center justify-center gap-6 mt-4">
      {/* Left: Reset Button */}
      <button
        onClick={onReset}
        title="Reset interval"
        className="flex items-center justify-center w-14 h-14 rounded-full bg-md-surface-container-high hover:bg-md-surface-container-highest text-md-on-surface-variant hover:text-md-on-surface transition-all duration-200 active:scale-95 shadow-xs"
        aria-label="Reset interval"
      >
        <RotateCcw className="w-6 h-6" />
      </button>

      {/* Center: Start / Pause Toggle (Large M3 Hero FAB) */}
      <button
        onClick={onToggleStartPause}
        className="flex items-center justify-center w-20 h-20 sm:w-22 sm:h-22 rounded-full bg-md-primary text-md-on-primary hover:bg-[#584192] shadow-elevation-2 hover:shadow-elevation-3 transition-all duration-200 active:scale-95 text-lg group"
        aria-label={isRunning ? 'Pause timer' : 'Start timer'}
      >
        {isRunning ? (
          <Pause className="w-8 h-8 fill-current" />
        ) : (
          <Play className="w-8 h-8 fill-current translate-x-0.5" />
        )}
      </button>

      {/* Right: Skip / Next Interval Button */}
      <button
        onClick={onSkip}
        title="Skip to next interval"
        className="flex items-center justify-center w-14 h-14 rounded-full bg-md-surface-container-high hover:bg-md-surface-container-highest text-md-on-surface-variant hover:text-md-on-surface transition-all duration-200 active:scale-95 shadow-xs"
        aria-label="Skip to next interval"
      >
        <SkipForward className="w-6 h-6" />
      </button>
    </div>
  );
};
