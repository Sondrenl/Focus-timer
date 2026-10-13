import React from 'react';

interface EggTimerIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Custom SVG icon representing a classic mechanical egg / kitchen timer
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
      {/* Top winding knob */}
      <path d="M10 2.5h4" />
      <path d="M12 2.5v1.5" />

      {/* Egg timer body: upper rotating dome */}
      <path d="M12 4C7.8 4 5 7.8 5 12.5h14C19 7.8 16.2 4 12 4z" />

      {/* Egg timer body: lower base */}
      <path d="M5 12.5c0 4.5 3.2 8.5 7 8.5s7-4 7-8.5H5z" />

      {/* Dial separation line */}
      <line x1="5" y1="12.5" x2="19" y2="12.5" />

      {/* Calibration tick marks on the rotating dial */}
      <line x1="12" y1="10.5" x2="12" y2="14.5" />
      <line x1="8.5" y1="12.5" x2="8.5" y2="15" />
      <line x1="15.5" y1="12.5" x2="15.5" y2="15" />
    </svg>
  );
};
