import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'filled',
  size = 'md',
  className,
  children,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none select-none';

  const variants = {
    filled: 'bg-md-primary text-md-on-primary hover:bg-[#584192] shadow-sm hover:shadow active:shadow-none',
    tonal: 'bg-md-secondary-container text-md-on-secondary-container hover:bg-[#ded3ee]',
    outlined: 'border border-md-outline text-md-primary hover:bg-md-primary/5 active:bg-md-primary/10',
    text: 'text-md-primary hover:bg-md-primary/10 active:bg-md-primary/15',
    elevated: 'bg-md-surface-container-low text-md-primary shadow-elevation-1 hover:shadow-elevation-2 active:shadow-elevation-1',
  };

  const sizes = {
    sm: 'min-h-[42px] md:min-h-0 text-xs px-4 py-2 md:px-3 md:py-1.5 rounded-full gap-1.5',
    md: 'min-h-[46px] md:min-h-0 text-sm px-5 py-2.5 rounded-full gap-2',
    lg: 'min-h-[52px] md:min-h-0 text-base px-7 py-3.5 rounded-full gap-2.5 font-semibold',
    icon: 'min-w-[46px] min-h-[46px] md:min-w-0 md:min-h-0 p-3 rounded-full',
  };

  return (
    <button
      className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
      {...props}
    >
      {children}
    </button>
  );
};
