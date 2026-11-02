import React from 'react';
import { Award } from 'lucide-react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';

interface ActivityInspectionCardProps {
  inspectedBar: ActivityBarStat | null;
  peakDay: ActivityBarStat | null;
  formatInspectedDate: (key: string) => string;
  emptyPrompt?: string;
}

export const ActivityInspectionCard: React.FC<ActivityInspectionCardProps> = ({
  inspectedBar,
  peakDay,
  formatInspectedDate,
  emptyPrompt = 'Hover or tap any day to inspect focus duration.',
}) => {
  return (
    <div className="mt-2 p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
      {inspectedBar ? (
        <>
          <div className="font-semibold text-md-on-surface">
            {formatInspectedDate(inspectedBar.key)}
          </div>
          <div className="font-medium text-md-on-surface-variant">
            {inspectedBar.totalSeconds > 0 ? (
              <span>
                <strong className="text-md-primary font-bold">
                  {formatDurationHoursMins(inspectedBar.totalSeconds)}
                </strong>{' '}
                focused across {inspectedBar.sessionCount}{' '}
                {inspectedBar.sessionCount === 1 ? 'session' : 'sessions'}
              </span>
            ) : (
              <span>No focus sessions logged</span>
            )}
          </div>
        </>
      ) : peakDay ? (
        <>
          <div className="font-semibold text-md-on-surface flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>
              Peak Day:{' '}
              <span className="text-md-primary font-bold">
                {formatInspectedDate(peakDay.key)}
              </span>
            </span>
          </div>
          <div className="text-md-on-surface-variant font-medium">
            {formatDurationHoursMins(peakDay.totalSeconds)} focused ({peakDay.sessionCount}{' '}
            {peakDay.sessionCount === 1 ? 'session' : 'sessions'})
          </div>
        </>
      ) : (
        <div className="text-md-outline">{emptyPrompt}</div>
      )}
    </div>
  );
};
