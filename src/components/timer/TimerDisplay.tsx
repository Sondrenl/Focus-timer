import React, { useEffect, useRef, useMemo } from 'react';
import { SessionType, TimerStatus } from '../../types/timer';
import { formatTime } from '../../utils/formatters';
import { useApp } from '../../context/AppContext';
import { useTimer } from '../../hooks/useTimer';

interface TimerDisplayProps {
  remainingSeconds: number;
  totalSeconds: number;
  sessionType: SessionType;
  status: TimerStatus;
}

// Generate organic undulating ring path with very subtle, gentle wave amplitude (1.4px and 0.7px)
function getWavyPath(center: number, radius: number, phase: number, samples = 140) {
  let path = '';
  let length = 0;
  let prevX = 0;
  let prevY = 0;

  for (let i = 0; i <= samples; i++) {
    const alpha = (i / samples) * 2 * Math.PI; // 0 to 2pi clockwise starting at 12 o'clock
    // Integer wave harmonics (4 and 2) guarantee seamless 360-degree closure at all phases
    const r = radius + 1.4 * Math.sin(4 * alpha - phase) + 0.7 * Math.cos(2 * alpha + phase * 0.7);
    const x = center + r * Math.sin(alpha);
    const y = center - r * Math.cos(alpha);

    if (i === 0) {
      path += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
    } else {
      path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      length += Math.hypot(x - prevX, y - prevY);
    }
    prevX = x;
    prevY = y;
  }
  return { path, length };
}

export const TimerDisplay: React.FC<TimerDisplayProps> = ({
  remainingSeconds,
  totalSeconds,
  sessionType,
  status,
}) => {
  const { activeTagId, activeTags } = useApp();
  const { targetEndTime } = useTimer();

  const currentTag = activeTags.find((t) => t.id === activeTagId);
  const tagColor = currentTag ? currentTag.color : '#6750A4';

  const sessionMeta = {
    WORK: {
      label: 'Focus',
      color: tagColor,
      bgRing: `${tagColor}22`, // Subtle pastel background track
    },
    SHORT_BREAK: {
      label: 'Short Break',
      color: '#00897B',
      bgRing: '#B2DFDB',
    },
    LONG_BREAK: {
      label: 'Long Break',
      color: '#7D5260',
      bgRing: '#FFD8E4',
    },
  }[sessionType];

  const stroke = 11;
  const viewBoxSize = 280;
  const center = viewBoxSize / 2;
  const baseRadius = 122;

  // Refs for direct DOM animation (60fps smooth with zero React re-render overhead)
  const trackPathRef = useRef<SVGPathElement>(null);
  const progressPathRef = useRef<SVGPathElement>(null);
  const phaseRef = useRef<number>(0);

  const targetEndTimeRef = useRef<number | null>(targetEndTime);
  targetEndTimeRef.current = targetEndTime;

  const totalSecondsRef = useRef<number>(totalSeconds);
  totalSecondsRef.current = totalSeconds;

  const remainingSecondsRef = useRef<number>(remainingSeconds);
  remainingSecondsRef.current = remainingSeconds;

  // Initial resting path
  const initial = useMemo(() => getWavyPath(center, baseRadius, 0), [center, baseRadius]);

  const initialFraction = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;

  // Continuous millisecond-smooth progress and calm wave animation
  useEffect(() => {
    if (status !== 'RUNNING') {
      // When paused or idle, render exact static fraction position
      if (progressPathRef.current) {
        const len = initial.length;
        const frac = totalSecondsRef.current > 0 ? remainingSecondsRef.current / totalSecondsRef.current : 0;
        progressPathRef.current.style.strokeDasharray = `${len} ${len}`;
        progressPathRef.current.style.strokeDashoffset = `${len - frac * len}`;
      }
      return;
    }

    let animationFrameId: number;
    let lastTime = performance.now();
    // Calibrated very slow, peaceful wave speed (~28s per full wave rotation)
    const waveSpeed = 0.22;

    const animate = (currentTime: number) => {
      const delta = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      phaseRef.current = (phaseRef.current + waveSpeed * delta) % (Math.PI * 20);

      const { path, length } = getWavyPath(center, baseRadius, phaseRef.current);

      // Continuous sub-second progress calculation down to the millisecond
      let currentFraction = 0;
      if (targetEndTimeRef.current !== null && totalSecondsRef.current > 0) {
        const remainingMs = Math.max(0, targetEndTimeRef.current - Date.now());
        currentFraction = remainingMs / (totalSecondsRef.current * 1000);
      } else if (totalSecondsRef.current > 0) {
        currentFraction = remainingSecondsRef.current / totalSecondsRef.current;
      }

      if (trackPathRef.current) {
        trackPathRef.current.setAttribute('d', path);
      }
      if (progressPathRef.current) {
        progressPathRef.current.setAttribute('d', path);
        progressPathRef.current.style.strokeDasharray = `${length} ${length}`;
        progressPathRef.current.style.strokeDashoffset = `${length - currentFraction * length}`;
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [status, center, baseRadius, initial.length]);

  return (
    <div className="relative flex flex-col items-center justify-center my-4 select-none">
      {/* Organic Living Progress Gauge (Clean background, smooth continuous countdown) */}
      <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
        <svg
          height="100%"
          width="100%"
          viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
          className="drop-shadow-xs overflow-visible"
        >
          {/* Background Wavy Track Ring */}
          <path
            ref={trackPathRef}
            d={initial.path}
            stroke={sessionMeta.bgRing}
            fill="transparent"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Animated Living Progress Arc (Continuous, non-stepping countdown) */}
          <path
            ref={progressPathRef}
            d={initial.path}
            stroke={sessionMeta.color}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${initial.length} ${initial.length}`}
            style={{
              strokeDashoffset: initial.length - initialFraction * initial.length,
            }}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Central Display Stack */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10 pointer-events-none">
          {/* Status Badge */}
          <div
            className="px-3.5 py-1 rounded-full text-xs font-semibold mb-2 shadow-xs transition-colors tracking-wide pointer-events-auto"
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
