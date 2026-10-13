import React from 'react';
import { SessionType, TimerStatus } from '../../types/timer';
import { formatTime } from '../../utils/formatters';
import { useApp } from '../../context/AppContext';

interface TimerDisplayProps {
  remainingSeconds: number;
  totalSeconds: number;
  sessionType: SessionType;
  status: TimerStatus;
}

export const TimerDisplay: React.FC<TimerDisplayProps> = ({
  remainingSeconds,
  totalSeconds,
  sessionType,
  status,
}) => {
  const { activeTagId, activeTags } = useApp();
  const currentTag = activeTags.find((t) => t.id === activeTagId);
  const tagColor = currentTag ? currentTag.color : '#6750A4';

  // SVG circular progress calculation
  const radius = 135;
  const stroke = 10;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;

  const fraction = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const strokeDashoffset = circumference - fraction * circumference;

  const sessionMeta = {
    WORK: {
      label: 'Focus',
      color: tagColor,
      bgRing: `${tagColor}26`, // 15% opacity pastel background track
    },
    SHORT_BREAK: {
      label: 'Short Break',
      color: '#00897B', // Teal Pastel
      bgRing: '#B2DFDB',
    },
    LONG_BREAK: {
      label: 'Long Break',
      color: '#7D5260', // Tertiary Mauve
      bgRing: '#FFD8E4',
    },
  }[sessionType];

  return (
    <div className="relative flex flex-col items-center justify-center my-4 select-none">
      {/* Circular Progress Gauge */}
      <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
        <svg
          height="100%"
          width="100%"
          viewBox={`0 0 ${radius * 2} ${radius * 2}`}
          className="transform -rotate-90 drop-shadow-sm"
        >
          {/* Background Track Ring */}
          <circle
            stroke={sessionMeta.bgRing}
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          {/* Animated Foreground Progress Arc */}
          <circle
            stroke={sessionMeta.color}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${circumference} ${circumference}`}
            style={{
              strokeDashoffset,
              transition: status === 'RUNNING' ? 'stroke-dashoffset 0.4s linear' : 'stroke-dashoffset 0.3s ease',
            }}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
        </svg>

        {/* Central Display Stack */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {/* Status Badge */}
          <div
            className="px-3.5 py-1 rounded-full text-xs font-semibold mb-2 shadow-xs transition-colors tracking-wide"
            style={{
              backgroundColor: sessionMeta.bgRing,
              color: sessionMeta.color,
            }}
          >
            {sessionMeta.label}
          </div>

          {/* Large Monospace/Digital Timer Digits */}
          <div className="text-5xl md:text-6xl font-extrabold text-md-on-surface tracking-tighter tabular-nums font-mono drop-shadow-xs">
            {formatTime(remainingSeconds)}
          </div>
        </div>
      </div>
    </div>
  );
};
