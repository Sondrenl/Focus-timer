import React from 'react';

interface EggTimerIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Custom SVG icon representing a classic Pomodoro tomato with stem and calyx
 */
export const EggTimerIcon: React.FC<EggTimerIconProps> = ({
  className = 'w-6 h-6',
  ...props
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      {/* Plump organic tomato body */}
      <path
        d="M12 5.5C8.8 4 3.5 5.8 3.2 12.2C3 18.2 7.2 21.5 12 21.5C16.8 21.5 21 18.2 20.8 12.2C20.5 5.8 15.2 4 12 5.5Z"
        fill="currentColor"
      />

      {/* Curved tomato stem */}
      <path
        d="M12 6C12 3.8 12.8 2 14.8 1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* Calyx leaves radiating across the top dip */}
      <path
        d="M12 6L14 3.8L12.5 5.8L16 4.8L13 6.8L14.8 8.5L12 7.2L9.2 8.5L11 6.8L8 4.8L11.5 5.8L10 3.8L12 6Z"
        fill="currentColor"
      />
    </svg>
  );
};
