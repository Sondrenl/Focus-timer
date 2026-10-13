import React from 'react';
import { clsx } from 'clsx';
import { SessionType } from '../../types/timer';

interface CycleIndicatorProps {
  currentCycle: number;
  maxCycles: number;
  sessionType: SessionType;
}

export const CycleIndicator: React.FC<CycleIndicatorProps> = ({
  currentCycle,
  maxCycles,
  sessionType,
}) => {
  const cycles = Array.from({ length: maxCycles }, (_, i) => i + 1);

  return (
    <div className="flex items-center gap-2 py-2 select-none" aria-label="Cycle progress">
      {cycles.map((num) => {
        // In long break, all previous focus sessions and short breaks are completely finished!
        const isLongBreak = sessionType === 'LONG_BREAK';

        // Focus session state
        const isFocusCurrent = !isLongBreak && num === currentCycle && sessionType === 'WORK';
        const isFocusDone =
          isLongBreak ||
          num < currentCycle ||
          (num === currentCycle && sessionType === 'SHORT_BREAK');

        // Short break between focus sessions
        const isShortBreak = num < maxCycles;
        const isBreakCurrent =
          !isLongBreak && isShortBreak && num === currentCycle && sessionType === 'SHORT_BREAK';
        const isBreakDone = isShortBreak && (isLongBreak || num < currentCycle);

        // Final long break after the last focus session
        const isFinalCycle = num === maxCycles;
        const isLongBreakCurrent = isFinalCycle && isLongBreak;

        return (
          <React.Fragment key={`cycle-step-${num}`}>
            {/* Focus Session Milestone Dot / Pill */}
            <div
              className={clsx(
                'transition-all duration-300 rounded-full',
                isFocusCurrent
                  ? 'w-7 h-2.5 bg-md-primary shadow-xs'
                  : isFocusDone
                  ? 'w-2.5 h-2.5 bg-md-primary/80'
                  : 'w-2.5 h-2.5 bg-md-outline-variant/60'
              )}
              title={`Focus Session ${num} of ${maxCycles}${isFocusDone ? ' (Completed)' : isFocusCurrent ? ' (Active)' : ''}`}
            />

            {/* In-between Break Dot */}
            {isShortBreak && (
              <div
                className={clsx(
                  'transition-all duration-300 rounded-full',
                  isBreakCurrent
                    ? 'w-4 h-2 bg-[#00897B] shadow-xs ring-2 ring-[#00897B]/20'
                    : isBreakDone
                    ? 'w-1.5 h-1.5 bg-md-primary/60'
                    : 'w-1.5 h-1.5 bg-md-outline-variant/40'
                )}
                title={`Short Break ${num}${isBreakDone ? ' (Completed)' : isBreakCurrent ? ' (Active)' : ''}`}
              />
            )}

            {/* Long Break Dot concluding the cycle */}
            {isFinalCycle && (
              <div
                className={clsx(
                  'transition-all duration-300 rounded-full',
                  isLongBreakCurrent
                    ? 'w-4 h-2 bg-[#7D5260] shadow-xs ring-2 ring-[#7D5260]/20'
                    : 'w-1.5 h-1.5 bg-md-outline-variant/40'
                )}
                title={`Long Break${isLongBreakCurrent ? ' (Active)' : ''}`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
