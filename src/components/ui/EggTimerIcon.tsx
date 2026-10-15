import React from 'react';

interface EggTimerIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Custom SVG line-art icon representing a mechanical Pomodoro tomato timer
 */
export const EggTimerIcon: React.FC<EggTimerIconProps> = ({
  className = 'w-6 h-6',
  ...props
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Tomato timer stem */}
      <path d="M12 6.2C12 4.2 13 2.8 15.2 2.2" />

      {/* Tomato calyx leaves in line style */}
      <path d="M12 6.5L8.5 4.5" />
      <path d="M12 6.5L15.5 4.5" />
      <path d="M12 6.5L6.5 6.8" />
      <path d="M12 6.5L17.5 6.8" />

      {/* Tomato timer upper body (rotatable dome) with organic tomato curve */}
      <path d="M3.8 13C3.5 9 6.8 6.5 10 6.5C11 6.5 11.5 6.8 12 7C12.5 6.8 13 6.5 14 6.5C17.2 6.5 20.5 9 20.2 13" />

      {/* Tomato timer lower base */}
      <path d="M3.8 13C3.5 17.5 7.2 20.5 12 20.5C16.8 20.5 20.5 17.5 20.2 13" />

      {/* Mechanical dial seam line */}
      <line x1="3.8" y1="13" x2="20.2" y2="13" />

      {/* Calibration tick marks on the rotating dial */}
      <line x1="12" y1="11" x2="12" y2="15" />
      <line x1="8" y1="13" x2="8" y2="15.5" />
      <line x1="16" y1="13" x2="16" y2="15.5" />
    </svg>
  );
};
