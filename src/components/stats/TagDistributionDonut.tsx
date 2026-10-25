import React, { useState } from 'react';
import { TagStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';

interface TagDistributionDonutProps {
  distribution: TagStat[];
  totalFocusSeconds: number;
}

export const TagDistributionDonut: React.FC<TagDistributionDonutProps> = ({
  distribution,
  totalFocusSeconds,
}) => {
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);

  const radius = 86;
  const strokeWidth = 24;
  const center = 100;
  const circumference = 2 * Math.PI * radius;
  const innerRadius = radius - strokeWidth / 2; // radius of the hole inside the donut

  // Filter out tags with 0 seconds in this period
  const activeSlices = distribution.filter((item) => item.totalSeconds > 0);

  // Calculate cumulative offsets using exact total seconds ratio to guarantee 0 gaps
  let accumulatedRatio = 0;
  const slicesWithOffsets = activeSlices.map((item, index) => {
    const ratio = totalFocusSeconds > 0 ? item.totalSeconds / totalFocusSeconds : 0;
    // Add tiny 0.4px overlap when there are multiple slices to prevent subpixel retina anti-aliasing gaps
    const sliceLength = ratio * circumference + (activeSlices.length > 1 ? 0.4 : 0);
    const strokeDasharray = `${sliceLength} ${circumference}`;
    const strokeDashoffset = -(accumulatedRatio * circumference);
    accumulatedRatio += ratio;

    return {
      ...item,
      strokeDasharray,
      strokeDashoffset,
      isLast: index === activeSlices.length - 1,
    };
  });

  const hoveredItem = activeSlices.find((item) => item.tagId === hoveredTagId);
  const hoveredSlice = slicesWithOffsets.find((item) => item.tagId === hoveredTagId);

  return (
    <div className="flex flex-col md:flex-row items-center justify-around gap-6 py-2">
      {/* 1. SVG Donut Diagram */}
      <div className="relative w-56 h-56 shrink-0 flex items-center justify-center select-none">
        <svg
          viewBox={`0 0 ${center * 2} ${center * 2}`}
          className="w-full h-full transform -rotate-90 drop-shadow-xs"
          onMouseLeave={() => setHoveredTagId(null)}
        >
          {/* Base Background Track Ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="#EDE7DC"
            strokeWidth={strokeWidth}
            className="opacity-40"
          />

          {/* Stable Base Slices - Rock solid hit-targets without resizing jitter */}
          {slicesWithOffsets.map((slice) => {
            const isHovered = hoveredTagId === slice.tagId;
            const isAnyHovered = Boolean(hoveredTagId);

            return (
              <circle
                key={slice.tagId}
                cx={center}
                cy={center}
                r={radius}
                fill="transparent"
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={slice.strokeDasharray}
                strokeDashoffset={slice.strokeDashoffset}
                strokeLinecap="butt"
                onMouseEnter={() => setHoveredTagId(slice.tagId)}
                className="cursor-pointer transition-opacity duration-200"
                style={{
                  opacity: isAnyHovered ? (isHovered ? 1 : 0.4) : 1,
                }}
              />
            );
          })}

          {/* Active Highlight Overlay (pointer-events-none so it never interferes with cursor hit testing) */}
          {hoveredSlice && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={hoveredSlice.color}
              strokeWidth={strokeWidth + 4}
              strokeDasharray={hoveredSlice.strokeDasharray}
              strokeDashoffset={hoveredSlice.strokeDashoffset}
              strokeLinecap="butt"
              className="pointer-events-none drop-shadow-md transition-all duration-150"
            />
          )}

          {/* Inner hole hit target to cleanly reset hover when entering the center */}
          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            fill="transparent"
            onMouseEnter={() => setHoveredTagId(null)}
            className="cursor-default"
          />
        </svg>

        {/* Center Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4 transition-all duration-150">
          {hoveredItem ? (
            <div className="flex flex-col items-center justify-center animate-in fade-in duration-150">
              <span className="text-xl font-extrabold text-md-on-surface tracking-tight truncate max-w-[120px]">
                {hoveredItem.percentage === 0 && hoveredItem.totalSeconds > 0
                  ? '<1%'
                  : `${hoveredItem.percentage}%`}
              </span>
              <span className="text-xs font-semibold text-md-on-surface-variant truncate max-w-[120px] mt-0.5">
                {hoveredItem.name}
              </span>
              <span className="text-[10px] text-md-outline">
                {formatDurationHoursMins(hoveredItem.totalSeconds)}
              </span>
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
          const isHovered = hoveredTagId === item.tagId;
          const isAnyHovered = Boolean(hoveredTagId);

          return (
            <div
              key={item.tagId}
              onMouseEnter={() => setHoveredTagId(item.tagId)}
              className={`flex items-center justify-between p-2 rounded-2xl transition-all duration-150 cursor-pointer ${
                isHovered
                  ? 'bg-md-surface-container-high shadow-xs'
                  : isAnyHovered
                  ? 'opacity-60 hover:opacity-100 hover:bg-md-surface-container'
                  : 'hover:bg-md-surface-container'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs transition-transform duration-150"
                  style={{
                    backgroundColor: item.color,
                    transform: isHovered ? 'scale(1.2)' : 'scale(1)',
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
