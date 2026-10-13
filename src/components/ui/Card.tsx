import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'elevated' | 'filled' | 'outlined';
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  variant = 'filled',
  className,
  children,
  ...props
}) => {
  const baseStyles = 'rounded-3xl transition-all duration-200 overflow-hidden';

  const variants = {
    elevated: 'bg-md-surface-container-low shadow-elevation-1 hover:shadow-elevation-2',
    filled: 'bg-md-surface-container hover:bg-md-surface-container-high',
    outlined: 'bg-md-surface border border-md-outline-variant',
  };

  return (
    <div
      className={twMerge(clsx(baseStyles, variants[variant], className))}
      {...props}
    >
      {children}
    </div>
  );
};
