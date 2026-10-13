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
  const dots = Array.from({ length: maxCycles }, (_, i) => i + 1);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        {dots.map((num) => {
          const isDone = num < currentCycle;
          const isCurrent = num === currentCycle;

          return (
            <div
              key={num}
              className={clsx(
                'transition-all duration-300 rounded-full',
                isCurrent && sessionType === 'WORK'
                  ? 'w-7 h-2.5 bg-md-primary shadow-xs'
                  : isDone
                  ? 'w-2.5 h-2.5 bg-md-primary/70'
                  : 'w-2.5 h-2.5 bg-md-outline-variant'
              )}
              title={`Session ${num} of ${maxCycles}`}
            />
          );
        })}
      </div>
      <span className="text-xs font-medium text-md-on-surface-variant">
        {sessionType === 'WORK'
          ? `Cycle Session ${currentCycle} of ${maxCycles}`
          : sessionType === 'SHORT_BREAK'
          ? `Short Rest (${currentCycle} of ${maxCycles} finished)`
          : `Long Rest (Cycle Complete!)`}
      </span>
    </div>
  );
};
