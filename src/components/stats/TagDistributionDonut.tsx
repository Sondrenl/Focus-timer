import React, { useState } from 'react';
import { TagStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { clsx } from 'clsx';

interface TagDistributionDonutProps {
  distribution: TagStat[];
  totalFocusSeconds: number;
}

export const TagDistributionDonut: React.FC<TagDistributionDonutProps> = ({
  distribution,
  totalFocusSeconds,
}) => {
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  const radius = 86;
  const strokeWidth = 24;
  const center = 100;
  const circumference = 2 * Math.PI * radius;

  // Filter out tags with 0 seconds in this period
  const activeSlices = distribution.filter((item) => item.totalSeconds > 0);

  // Calculate cumulative offsets and angle ratios to guarantee seamless hit-testing
  let accumulatedRatio = 0;
  const slicesWithOffsets = activeSlices.map((item, index) => {
    const ratio = totalFocusSeconds > 0 ? item.totalSeconds / totalFocusSeconds : 0;
    const startRatio = accumulatedRatio;
    const endRatio = index === activeSlices.length - 1 ? 1 : accumulatedRatio + ratio;
    // Tiny 0.4px overlap prevents subpixel retina anti-aliasing gaps between slices
    const sliceLength = ratio * circumference + (activeSlices.length > 1 ? 0.4 : 0);
    const strokeDasharray = `${sliceLength} ${circumference}`;
    const strokeDashoffset = -(accumulatedRatio * circumference);
    accumulatedRatio += ratio;

    return {
      ...item,
      startRatio,
      endRatio,
      strokeDasharray,
      strokeDashoffset,
      isLast: index === activeSlices.length - 1,
    };
  });

  // Effective active item (hovered takes precedence, then pinned/selected)
  const activeTagId = hoveredTagId || selectedTagId;
  const activeItem = activeSlices.find((item) => item.tagId === activeTagId);
  const activeSlice = slicesWithOffsets.find((item) => item.tagId === activeTagId);
  const isPinned = Boolean(selectedTagId && activeTagId === selectedTagId && !hoveredTagId);

  // Geometric angle & distance calculation for 100% reliable SVG hover
  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeSlices.length === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);

    // Scale pixel distance to the 100px radius coordinate space
    const scale = center / (rect.width / 2);
    const svgDist = dist * scale;

    // Donut ring range is [radius - strokeWidth/2, radius + strokeWidth/2] = [74, 98]
    // Add generous padding [68, 104] so cursor doesn't jitter at the boundary
    const innerHoleThreshold = radius - strokeWidth / 2 - 6; // 68px
    const outerBoundaryThreshold = radius + strokeWidth / 2 + 6; // 104px

    if (svgDist < innerHoleThreshold || svgDist > outerBoundaryThreshold) {
      if (hoveredTagId !== null) {
        setHoveredTagId(null);
      }
      return;
    }

    // Angle in degrees [0, 360) clockwise from 12 o'clock
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    const ratio = deg / 360;

    const matched = slicesWithOffsets.find((slice) =>
      slice.isLast
        ? ratio >= slice.startRatio && ratio <= 1.001
        : ratio >= slice.startRatio && ratio < slice.endRatio
    );

    if (matched && matched.tagId !== hoveredTagId) {
      setHoveredTagId(matched.tagId);
    }
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeSlices.length === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);

    const scale = center / (rect.width / 2);
    const svgDist = dist * scale;

    // Clicking the center hole clears pinned selection
    if (svgDist < radius - strokeWidth / 2 - 4) {
      setSelectedTagId(null);
      setHoveredTagId(null);
      return;
    }

    if (svgDist > radius + strokeWidth / 2 + 8) {
      return;
    }

    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    const ratio = deg / 360;

    const matched = slicesWithOffsets.find((slice) =>
      slice.isLast
        ? ratio >= slice.startRatio && ratio <= 1.001
        : ratio >= slice.startRatio && ratio < slice.endRatio
    );

    if (matched) {
      setSelectedTagId((prev) => (prev === matched.tagId ? null : matched.tagId));
    }
  };

  if (activeSlices.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-md-outline">
        No focus time logged for tags in this period.
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row items-center justify-around gap-6 py-2">
      {/* 1. SVG Donut Diagram */}
      <div className="relative w-56 h-56 shrink-0 flex items-center justify-center select-none">
        <svg
          viewBox={`0 0 ${center * 2} ${center * 2}`}
          className="w-full h-full transform -rotate-90 drop-shadow-xs cursor-pointer"
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => setHoveredTagId(null)}
          onClick={handleSvgClick}
        >
          {/* Base Background Track Ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#EDE7DC"
            strokeWidth={strokeWidth}
            className="opacity-40"
          />

          {/* Slices — fill="none" prevents transparent interior overlap */}
          {slicesWithOffsets.map((slice) => {
            const isItemActive = activeTagId === slice.tagId;
            const isAnyActive = Boolean(activeTagId);

            return (
              <circle
                key={slice.tagId}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={slice.strokeDasharray}
                strokeDashoffset={slice.strokeDashoffset}
                strokeLinecap="butt"
                pointerEvents="stroke"
                onMouseEnter={() => setHoveredTagId(slice.tagId)}
                className="transition-opacity duration-150"
                style={{
                  opacity: isAnyActive ? (isItemActive ? 1 : 0.35) : 1,
                }}
              />
            );
          })}

          {/* Active Highlight Overlay (pointer-events none so it never interrupts tracking) */}
          {activeSlice && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={activeSlice.color}
              strokeWidth={strokeWidth + 4}
              strokeDasharray={activeSlice.strokeDasharray}
              strokeDashoffset={activeSlice.strokeDashoffset}
              strokeLinecap="butt"
              pointerEvents="none"
              className="drop-shadow-md transition-all duration-150"
            />
          )}
        </svg>

        {/* Center Text (Always non-interactive so cursor events pass through cleanly) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4 select-none">
          {activeItem ? (
            <div className="flex flex-col items-center justify-center animate-in fade-in duration-150">
              <span className="text-xl font-extrabold text-md-on-surface tracking-tight truncate max-w-[130px]">
                {activeItem.percentage === 0 && activeItem.totalSeconds > 0
                  ? '<1%'
                  : `${activeItem.percentage}%`}
              </span>
              <span className="text-xs font-semibold text-md-on-surface-variant truncate max-w-[130px] mt-0.5">
                {activeItem.name}
              </span>
              <span className="text-[10px] text-md-outline">
                {formatDurationHoursMins(activeItem.totalSeconds)}
              </span>
              {isPinned && (
                <span className="text-[9px] font-bold text-md-primary mt-0.5 tracking-wider uppercase">
                  Pinned
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center animate-in fade-in duration-150">
              <span className="text-xl font-extrabold text-md-on-surface tracking-tight">
                {formatDurationHoursMins(totalFocusSeconds)}
              </span>
              <span className="text-xs font-medium text-md-on-surface-variant mt-0.5">
                Total Focus
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Legend & Tag Details List */}
      <div
        className="flex-1 w-full flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1"
        onMouseLeave={() => setHoveredTagId(null)}
      >
        {activeSlices.map((item) => {
          const isItemActive = activeTagId === item.tagId;
          const isAnyActive = Boolean(activeTagId);

          return (
            <div
              key={item.tagId}
              onMouseEnter={() => setHoveredTagId(item.tagId)}
              onClick={() => setSelectedTagId((prev) => (prev === item.tagId ? null : item.tagId))}
              className={clsx(
                'flex items-center justify-between p-2 rounded-2xl transition-all duration-150 cursor-pointer select-none',
                isItemActive
                  ? 'bg-md-surface-container-high ring-1 ring-md-primary/30 shadow-xs'
                  : isAnyActive
                  ? 'opacity-60 hover:opacity-100 hover:bg-md-surface-container'
                  : 'hover:bg-md-surface-container'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs transition-transform duration-150"
                  style={{
                    backgroundColor: item.color,
                    transform: isItemActive ? 'scale(1.2)' : 'scale(1)',
                  }}
                />
                <span className="text-xs font-bold text-md-on-surface truncate">
                  {item.name}
                </span>
                {item.isArchived && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-md-surface-variant text-md-outline font-medium">
                    Archived
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0 text-xs font-semibold">
                <span className="text-md-on-surface-variant font-medium">
                  {formatDurationHoursMins(item.totalSeconds)} ({item.sessionCount})
                </span>
                <span
                  className="w-10 text-right font-extrabold"
                  style={{ color: item.color }}
                >
                  {item.percentage === 0 && item.totalSeconds > 0 ? '<1%' : `${item.percentage}%`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
