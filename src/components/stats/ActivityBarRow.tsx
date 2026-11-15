import React from 'react';
import { clsx } from 'clsx';
import { formatDurationHoursMins } from '../../utils/formatters';

interface ActivityBarRowProps {
  label: React.ReactNode;
  subLabel?: React.ReactNode;
  badge?: React.ReactNode;
  totalSeconds: number;
  sessionCount?: number;
  maxSeconds: number;
  isHighlighted?: boolean;
  minWidthPct?: number;
  secondaryText?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export const ActivityBarRow: React.FC<ActivityBarRowProps> = ({
  label,
  subLabel,
  badge,
  totalSeconds,
  sessionCount = 0,
  maxSeconds,
  isHighlighted = false,
  minWidthPct = 8,
  secondaryText,
  onClick,
  className,
}) => {
  const widthPct = maxSeconds > 0 ? Math.min(100, Math.round((totalSeconds / maxSeconds) * 100)) : 0;
  const hasHours = totalSeconds > 0;

  return (
    <div
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 p-3 rounded-2xl transition-all',
        isHighlighted
          ? 'bg-md-primary/5 border border-md-primary/20'
          : 'bg-md-surface-container/60 hover:bg-md-surface-container',
        onClick && 'cursor-pointer',
        className
      )}
    >
      <div className="w-16 sm:w-28 shrink-0 flex flex-col min-w-0">
        <span className={clsx('text-xs font-bold truncate', isHighlighted ? 'text-md-primary' : 'text-md-on-surface')}>
          {label} {subLabel && <span className="font-normal text-md-outline">{subLabel}</span>}
        </span>
        {badge}
      </div>

      <div className="flex-1 min-w-[35%] h-7 bg-md-surface-container-high rounded-xl overflow-hidden flex items-center p-1">
        <div
          className={clsx(
            'h-full rounded-lg transition-all duration-500 ease-out',
            hasHours ? 'bg-md-primary' : 'bg-transparent'
          )}
          style={{ width: `${Math.max(hasHours ? minWidthPct : 0, widthPct)}%` }}
        />
      </div>

      <div className="w-16 sm:w-28 shrink-0 text-right flex flex-col items-end min-w-0">
        <span
          className={clsx(
            'text-xs font-bold tabular-nums',
            hasHours ? 'text-md-on-surface' : 'text-md-outline'
          )}
        >
          {hasHours ? formatDurationHoursMins(totalSeconds) : '0m'}
        </span>
        {secondaryText !== undefined ? (
          secondaryText
        ) : sessionCount > 0 ? (
          <span className="text-[10px] text-md-on-surface-variant truncate max-w-full">
            <span className="hidden sm:inline">{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}</span>
            <span className="sm:hidden">{sessionCount} ses</span>
          </span>
        ) : null}
      </div>
    </div>
  );
};
