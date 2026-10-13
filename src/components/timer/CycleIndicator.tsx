import React, { useRef, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { SessionType } from '../../types/timer';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const activeDotRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const cycles = Array.from({ length: maxCycles }, (_, i) => i + 1);

  // Check scroll bounds to display subtle edge fade cues
  const updateScrollCues = () => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollWidth - scrollLeft - clientWidth > 6);
  };

  useEffect(() => {
    updateScrollCues();
    window.addEventListener('resize', updateScrollCues);
    return () => window.removeEventListener('resize', updateScrollCues);
  }, [maxCycles]);

  // Center active cycle dot whenever the cycle progresses
  useEffect(() => {
    if (activeDotRef.current && containerRef.current) {
      activeDotRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
      // Allow scroll animation to finish before updating indicators
      setTimeout(updateScrollCues, 350);
    }
  }, [currentCycle, sessionType]);

  return (
    <div className="relative w-full max-w-[280px] sm:max-w-[340px] flex items-center justify-center py-2 select-none">
      {/* Subtle Left Side Fade Cue */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-md-background via-md-background/90 to-transparent pointer-events-none flex items-center justify-start z-10 pl-0.5 animate-in fade-in duration-200">
          <ChevronLeft className="w-3.5 h-3.5 text-md-outline/60" />
        </div>
      )}

      {/* Carousel Track */}
      <div
        ref={containerRef}
        onScroll={updateScrollCues}
        className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth px-6 py-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {cycles.map((num) => {
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
                ref={isFocusCurrent ? activeDotRef : null}
                className={clsx(
                  'transition-all duration-300 rounded-full shrink-0',
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
                  ref={isBreakCurrent ? activeDotRef : null}
                  className={clsx(
                    'transition-all duration-300 rounded-full shrink-0',
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
                  ref={isLongBreakCurrent ? activeDotRef : null}
                  className={clsx(
                    'transition-all duration-300 rounded-full shrink-0',
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

      {/* Subtle Right Side Fade Cue */}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-md-background via-md-background/90 to-transparent pointer-events-none flex items-center justify-end z-10 pr-0.5 animate-in fade-in duration-200">
          <ChevronRight className="w-3.5 h-3.5 text-md-outline/60" />
        </div>
      )}
    </div>
  );
};
