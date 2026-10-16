import { AuthService } from '../../services/auth/AuthService';
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

/**
 * Generate circular ring path with dynamic morphing factor:
 * - morphFactor = 0: Mathematically perfect circle (when paused / idle)
 * - morphFactor = 1: Organic undulating wave with odd harmonics (when running)
 * 
 * Uses odd harmonic frequencies (3-wave and 5-wave) instead of 4-wave to completely prevent
 * 4-corner squaring, ensuring the donut maintains its round circular form while feeling
 * fluid, living, and gently alive.
 */
function getWavyPath(
  center: number,
  radius: number,
  phase: number,
  morphFactor: number = 0,
  samples = 160
) {
  let path = '';
  let length = 0;
  let prevX = 0;
  let prevY = 0;

  // Gentle, uniform radial breathing that preserves circular integrity
  const breath = morphFactor * 0.9 * Math.sin(phase * 0.6);
  // Odd harmonic undulations (3-lobe and 5-lobe): prevents 4-corner squaring
  const amp1 = morphFactor * 1.5; // Primary gentle 3-point liquid undulation
  const amp2 = morphFactor * 0.7; // Secondary 5-point micro-ripple for organic life

  for (let i = 0; i <= samples; i++) {
    const alpha = (i / samples) * 2 * Math.PI; // 0 to 2pi clockwise starting at 12 o'clock
    // Using odd frequencies (3 * alpha and 5 * alpha) guarantees no 90-degree corner flattening
    const r = radius + breath + amp1 * Math.sin(3 * alpha - phase) + amp2 * Math.sin(5 * alpha + phase * 1.2);
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
  const morphRef = useRef<number>(status === 'RUNNING' ? 1 : 0);

  const targetEndTimeRef = useRef<number | null>(targetEndTime);
  targetEndTimeRef.current = targetEndTime;

  const totalSecondsRef = useRef<number>(totalSeconds);
  totalSecondsRef.current = totalSeconds;

  const remainingSecondsRef = useRef<number>(remainingSeconds);
  remainingSecondsRef.current = remainingSeconds;

  // Initial resting path: morphFactor = 0 (perfect geometric circle)
  const initial = useMemo(() => getWavyPath(center, baseRadius, 0, 0), [center, baseRadius]);

  const initialFraction = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;

  // Smooth morphing transition and continuous countdown animation
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    const waveSpeed = 0.45; // ~14s per revolution when fully active

    const animate = (currentTime: number) => {
      const delta = Math.min(0.1, (currentTime - lastTime) / 1000);
      lastTime = currentTime;

      const targetMorph = status === 'RUNNING' ? 1 : 0;
      // Gentle exponential easing between 0 (circle) and 1 (wave) in ~1.2s
      morphRef.current += (targetMorph - morphRef.current) * Math.min(1, 2.2 * delta);

      // Advance wave phase while active or transitioning
      if (status === 'RUNNING' || morphRef.current > 0.005) {
        phaseRef.current = (phaseRef.current + waveSpeed * delta) % (Math.PI * 20);
      }

      // Settle cleanly at exactly 0 (pristine circle) when paused/idle
      if (status !== 'RUNNING' && Math.abs(morphRef.current - targetMorph) < 0.003) {
        morphRef.current = 0;
      }

      const { path, length } = getWavyPath(center, baseRadius, phaseRef.current, morphRef.current);

      // Continuous sub-second progress calculation down to the millisecond
      let currentFraction = 0;
      if (status === 'RUNNING' && targetEndTimeRef.current !== null && totalSecondsRef.current > 0) {
        const remainingMs = Math.max(0, targetEndTimeRef.current - AuthService.getInstance().getServerNow());
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

      // Continue animating while running OR while smoothly transitioning back to circle
      if (status === 'RUNNING' || morphRef.current > 0.001) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [status, center, baseRadius]);

  return (
    <div className="relative flex flex-col items-center justify-center my-4 select-none">
      {/* Dynamic Progress Gauge (Perfect circle when paused, blooms alive when running) */}
      <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
        <svg
          height="100%"
          width="100%"
          viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
          className="drop-shadow-xs overflow-visible"
        >
          {/* Background Track Ring */}
          <path
            ref={trackPathRef}
            d={initial.path}
            stroke={sessionMeta.bgRing}
            fill="transparent"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Animated Progress Arc */}
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

        {/* Central Display Stack: Timer digits centered precisely in the middle of the ring */}
        <div className="absolute inset-0 flex items-center justify-center text-center z-10 pointer-events-none">
          <div className="relative flex flex-col items-center justify-center">
            {/* Status Badge floating above the timer without displacing its center */}
            <div
              className="absolute bottom-full mb-2.5 px-3.5 py-1 rounded-full text-xs font-semibold shadow-xs transition-colors tracking-wide pointer-events-auto whitespace-nowrap"
              style={{
                backgroundColor: sessionMeta.bgRing,
                color: sessionMeta.color,
              }}
            >
              {sessionMeta.label}
            </div>

            {/* Large Monospace/Digital Timer Digits: dead center in the ring */}
            <div className="text-5xl md:text-6xl font-extrabold text-md-on-surface tracking-tighter tabular-nums font-mono drop-shadow-xs leading-none">
              {formatTime(remainingSeconds)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
