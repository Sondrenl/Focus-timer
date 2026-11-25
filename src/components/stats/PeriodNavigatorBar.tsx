import React from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { TimePeriodType } from '../../hooks/useStatistics';
import { clsx } from 'clsx';

const PERIOD_OPTIONS: { type: TimePeriodType; label: string }[] = [
  { type: 'day', label: 'Day' },
  { type: 'week', label: 'Week' },
  { type: 'month', label: 'Month' },
  { type: 'year', label: 'Year' },
  { type: 'all', label: 'All Time' },
  { type: 'custom', label: 'Custom' },
];

interface PeriodNavigatorBarProps {
  periodType: TimePeriodType;
  setPeriodType: (type: TimePeriodType) => void;
  periodLabel: string;
  isCurrentPeriod: boolean;
  canGoNext: boolean;
  goToPrev: () => void;
  goToNext: () => void;
  goToToday: () => void;
  onOpenCalendarModal: () => void;
}

export const PeriodNavigatorBar: React.FC<PeriodNavigatorBarProps> = ({
  periodType,
  setPeriodType,
  periodLabel,
  isCurrentPeriod,
  canGoNext,
  goToPrev,
  goToNext,
  goToToday,
  onOpenCalendarModal,
}) => {
  const handleSelectPeriod = (type: TimePeriodType) => {
    setPeriodType(type);
    if (type === 'custom') {
      onOpenCalendarModal();
    }
  };

  return (
    <>
      {/* Desktop Layout (lg and up) */}
      <div className="hidden lg:flex flex-row items-center justify-between gap-4 p-4 rounded-3xl bg-md-surface-container-low border border-md-outline-variant/30 shadow-xs">
        <div className="inline-flex shrink-0 p-1 bg-md-surface-container rounded-2xl border border-md-outline-variant/30">
          {PERIOD_OPTIONS.map((opt) => {
            const isActive = periodType === opt.type;
            return (
              <button
                key={opt.type}
                onClick={() => handleSelectPeriod(opt.type)}
                className={clsx(
                  'px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 select-none whitespace-nowrap',
                  isActive
                    ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                    : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high'
                )}
              >
                {opt.type === 'custom' ? (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    Custom
                  </span>
                ) : (
                  opt.label
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-nowrap items-center justify-end gap-2 min-w-0">
          {periodType === 'custom' ? (
            <button
              type="button"
              onClick={onOpenCalendarModal}
              className="px-3.5 py-1.5 min-h-[34px] rounded-xl text-xs font-bold text-md-primary bg-md-primary/10 hover:bg-md-primary/15 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
            >
              <CalendarDays className="w-4 h-4 shrink-0" />
              <span>Pick Dates</span>
            </button>
          ) : (
            <button
              onClick={goToToday}
              disabled={isCurrentPeriod || periodType === 'all'}
              className={clsx(
                'px-3 py-1.5 min-h-[34px] rounded-xl text-xs font-bold text-md-primary hover:bg-md-primary/10 transition-colors flex items-center shrink-0 whitespace-nowrap',
                (isCurrentPeriod || periodType === 'all') && 'opacity-0 pointer-events-none select-none'
              )}
            >
              Today
            </button>
          )}

          <div className="flex flex-nowrap items-center gap-1 bg-md-surface-container rounded-2xl p-1 border border-md-outline-variant/30 min-h-[36px] min-w-0">
            {periodType !== 'all' && periodType !== 'custom' ? (
              <button
                onClick={goToPrev}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high transition-colors shrink-0"
                title="Previous period"
                aria-label="Previous period"
              >
                <ChevronLeft className="w-4.5 h-4.5" />
              </button>
            ) : (
              <div className="w-8 h-8 shrink-0 invisible pointer-events-none" />
            )}

            <button
              type="button"
              onClick={() => {
                if (periodType === 'custom') {
                  onOpenCalendarModal();
                }
              }}
              className={clsx(
                'px-3 py-1 text-xs font-bold text-md-on-surface whitespace-nowrap min-w-[70px] text-center truncate',
                periodType === 'custom' &&
                  'hover:text-md-primary underline decoration-dotted underline-offset-4 cursor-pointer'
              )}
            >
              {periodLabel}
            </button>

            {periodType !== 'all' && periodType !== 'custom' ? (
              <button
                onClick={goToNext}
                disabled={!canGoNext}
                className={clsx(
                  'w-8 h-8 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high transition-colors shrink-0',
                  !canGoNext && 'opacity-30 cursor-not-allowed pointer-events-none'
                )}
                title="Next period"
                aria-label="Next period"
              >
                <ChevronRight className="w-4.5 h-4.5" />
              </button>
            ) : (
              <div className="w-8 h-8 shrink-0 invisible pointer-events-none" />
            )}
          </div>
        </div>
      </div>

      {/* Mobile & Tablet Layout (< lg - 3x2 grid & full-width adaptive navigator) */}
      <div className="flex lg:hidden flex-col gap-3.5 p-4 rounded-3xl bg-md-surface-container-low border border-md-outline-variant/30 shadow-xs w-full min-w-0">
        <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-md-surface-container rounded-2xl border border-md-outline-variant/30 w-full">
          {PERIOD_OPTIONS.map((opt) => {
            const isActive = periodType === opt.type;
            return (
              <button
                type="button"
                key={opt.type}
                onClick={() => handleSelectPeriod(opt.type)}
                className={clsx(
                  'min-h-[44px] px-2 sm:px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 select-none flex items-center justify-center gap-1.5 active:scale-95 whitespace-nowrap',
                  isActive
                    ? 'bg-md-primary-container text-md-on-primary-container shadow-xs font-bold'
                    : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high'
                )}
              >
                {opt.type === 'custom' ? (
                  <>
                    <CalendarDays className="w-4 h-4 shrink-0" />
                    <span>Custom</span>
                  </>
                ) : (
                  opt.label
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-nowrap items-center gap-2 w-full min-w-0">
          <div className="flex flex-nowrap items-center justify-between flex-1 min-w-0 bg-md-surface-container rounded-2xl p-1 sm:p-1.5 border border-md-outline-variant/30 min-h-[48px]">
            {periodType !== 'all' && periodType !== 'custom' ? (
              <button
                type="button"
                onClick={goToPrev}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high active:scale-95 transition-all shrink-0"
                title="Previous period"
                aria-label="Previous period"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-10 h-10 shrink-0 invisible pointer-events-none" />
            )}

            <button
              type="button"
              onClick={() => {
                if (periodType === 'custom') {
                  onOpenCalendarModal();
                }
              }}
              className={clsx(
                'px-2 py-1.5 text-xs sm:text-sm font-bold text-md-on-surface text-center truncate min-w-0 flex-1 whitespace-nowrap',
                periodType === 'custom' &&
                  'hover:text-md-primary underline decoration-dotted underline-offset-4 cursor-pointer'
              )}
            >
              {periodLabel}
            </button>

            {periodType !== 'all' && periodType !== 'custom' ? (
              <button
                type="button"
                onClick={goToNext}
                disabled={!canGoNext}
                className={clsx(
                  'w-10 h-10 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high active:scale-95 transition-all shrink-0',
                  !canGoNext && 'opacity-30 cursor-not-allowed pointer-events-none'
                )}
                title="Next period"
                aria-label="Next period"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-10 h-10 shrink-0 invisible pointer-events-none" />
            )}
          </div>

          {periodType === 'custom' ? (
            <button
              type="button"
              onClick={onOpenCalendarModal}
              className="min-h-[48px] px-3.5 py-2.5 rounded-2xl text-xs font-bold text-md-primary bg-md-primary/10 hover:bg-md-primary/15 active:scale-95 transition-all flex items-center gap-1.5 shrink-0 whitespace-nowrap"
            >
              <CalendarDays className="w-4 h-4 shrink-0" />
              <span>Pick</span>
            </button>
          ) : (
            !isCurrentPeriod &&
            periodType !== 'all' && (
              <button
                type="button"
                onClick={goToToday}
                className="min-h-[48px] px-3.5 py-2.5 rounded-2xl text-xs font-bold text-md-primary bg-md-primary/10 hover:bg-md-primary/15 active:scale-95 transition-all shrink-0 whitespace-nowrap"
              >
                Today
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
};
