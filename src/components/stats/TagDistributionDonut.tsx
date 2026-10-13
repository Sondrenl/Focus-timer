import React, { useState } from 'react';
import { TagStat } from '../../hooks/useStatistics';

interface TagDistributionDonutProps {
  distribution: TagStat[];
  totalFocusHours: number;
}

export const TagDistributionDonut: React.FC<TagDistributionDonutProps> = ({
  distribution,
  totalFocusHours,
}) => {
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);

  const radius = 86;
  const strokeWidth = 24;
  const center = 100;
  const circumference = 2 * Math.PI * radius;

  // Filter out tags with 0 seconds in this period
  const activeSlices = distribution.filter((item) => item.totalSeconds > 0);

  // Calculate cumulative offsets
  let accumulatedPercent = 0;
  const slicesWithOffsets = activeSlices.map((item) => {
    const strokeDasharray = `${(item.percentage / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -((accumulatedPercent / 100) * circumference);
    accumulatedPercent += item.percentage;
    return {
      ...item,
      strokeDasharray,
      strokeDashoffset,
    };
  });

  const hoveredItem = activeSlices.find((item) => item.tagId === hoveredTagId);

  return (
    <div className="flex flex-col md:flex-row items-center justify-around gap-6 py-2">
      {/* 1. SVG Donut Diagram */}
      <div className="relative w-56 h-56 shrink-0 flex items-center justify-center select-none">
        <svg
          viewBox={`0 0 ${center * 2} ${center * 2}`}
          className="w-full h-full transform -rotate-90 drop-shadow-xs"
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

          {/* Slices */}
          {slicesWithOffsets.map((slice) => {
            const isHovered = hoveredTagId === slice.tagId;
            return (
              <circle
                key={slice.tagId}
                cx={center}
                cy={center}
                r={radius}
                fill="transparent"
                stroke={slice.color}
                strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={slice.strokeDasharray}
                strokeDashoffset={slice.strokeDashoffset}
                className="transition-all duration-200 cursor-pointer"
                onMouseEnter={() => setHoveredTagId(slice.tagId)}
                onMouseLeave={() => setHoveredTagId(null)}
              />
            );
          })}
        </svg>

        {/* Center Label in Donut Hole */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
          {hoveredItem ? (
            <>
              <span className="text-xl font-extrabold text-md-on-surface tracking-tight truncate max-w-[120px]">
                {hoveredItem.percentage}%
              </span>
              <span className="text-xs font-semibold text-md-on-surface-variant truncate max-w-[120px] mt-0.5">
                {hoveredItem.name}
              </span>
              <span className="text-[10px] text-md-outline">
                {hoveredItem.hours} hrs
              </span>
            </>
          ) : (
            <>
              <span className="text-2xl font-extrabold text-md-on-surface tracking-tight">
                {totalFocusHours}
                <span className="text-xs font-semibold text-md-on-surface-variant ml-0.5">hrs</span>
              </span>
              <span className="text-xs font-medium text-md-on-surface-variant mt-0.5">
                Total Focus
              </span>
              <span className="text-[10px] text-md-outline">
                {activeSlices.length} tag{activeSlices.length === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 2. Legend & Tag Details List */}
      <div className="flex-1 w-full flex flex-col gap-2.5 max-h-60 overflow-y-auto pr-1">
        {activeSlices.map((item) => {
          const isHovered = hoveredTagId === item.tagId;
          return (
            <div
              key={item.tagId}
              onMouseEnter={() => setHoveredTagId(item.tagId)}
              onMouseLeave={() => setHoveredTagId(null)}
              className={`flex items-center justify-between p-2 rounded-2xl transition-all cursor-pointer ${
                isHovered
                  ? 'bg-md-surface-container-high shadow-xs scale-101'
                  : 'hover:bg-md-surface-container'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs transition-transform"
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
                  {item.hours}h ({item.sessionCount})
                </span>
                <span
                  className="w-10 text-right font-extrabold"
                  style={{ color: item.color }}
                >
                  {item.percentage}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
