import React, { useMemo } from 'react';
import { clsx } from 'clsx';
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

  const stroke = 11;
  const viewBoxSize = 280;
  const center = viewBoxSize / 2;

  // Generate a continuous, organic wavy ring path
  // Co-prime wave harmonics (frequencies 5 and 3) ensure an asymmetric, natural, non-mechanical curve
  const { pathData, pathLength } = useMemo(() => {
    const baseRadius = 122;
    const amp1 = 3.2; // Primary gentle wave
    const amp2 = 1.6; // Secondary harmonic wave
    const samples = 180;
    const points: { x: number; y: number }[] = [];
    let length = 0;

    for (let i = 0; i <= samples; i++) {
      const alpha = (i / samples) * 2 * Math.PI; // 0 to 2pi clockwise starting at 12 o'clock
      const r = baseRadius + amp1 * Math.sin(5 * alpha) + amp2 * Math.cos(3 * alpha);
      const x = center + r * Math.sin(alpha);
      const y = center - r * Math.cos(alpha);
      points.push({ x, y });

      if (i > 0) {
        const prev = points[i - 1];
        length += Math.hypot(x - prev.x, y - prev.y);
      }
    }

    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');

    return { pathData: d, pathLength: length };
  }, [center]);

  const fraction = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const strokeDashoffset = pathLength - fraction * pathLength;

  return (
    <div className="relative flex flex-col items-center justify-center my-4 select-none">
      {/* Organic Wavy Progress Gauge */}
      <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
        {/* Subtle breathing ambient aura when timer is running */}
        <div
          className={clsx(
            'absolute w-48 h-48 rounded-full blur-3xl pointer-events-none transition-all duration-1000 ease-out',
            status === 'RUNNING' ? 'opacity-25 scale-105 animate-pulse' : 'opacity-10 scale-95'
          )}
          style={{ backgroundColor: sessionMeta.color }}
        />

        <svg
          height="100%"
          width="100%"
          viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
          className="drop-shadow-sm overflow-visible"
        >
          <defs>
            <filter id="organic-soft-glow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow
                dx="0"
                dy="2"
                stdDeviation="3"
                floodColor={sessionMeta.color}
                floodOpacity="0.22"
              />
            </filter>
          </defs>

          {/* Background Wavy Track Ring */}
          <path
            d={pathData}
            stroke={sessionMeta.bgRing}
            fill="transparent"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Animated Foreground Wavy Progress Arc */}
          <path
            d={pathData}
            stroke={sessionMeta.color}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${pathLength} ${pathLength}`}
            style={{
              strokeDashoffset,
              transition: status === 'RUNNING' ? 'stroke-dashoffset 0.4s linear' : 'stroke-dashoffset 0.3s ease',
            }}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={status === 'RUNNING' ? 'url(#organic-soft-glow)' : undefined}
          />
        </svg>

        {/* Central Display Stack */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10">
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
