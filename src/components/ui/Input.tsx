import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  className,
  id,
  ...props
}) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="flex flex-col gap-1 w-full text-left">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-md-on-surface-variant px-1">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={twMerge(
          clsx(
            'w-full px-4 py-3 sm:py-2.5 rounded-2xl bg-md-surface-container-high border border-transparent',
            'text-base sm:text-sm text-md-on-surface placeholder:text-md-outline transition-all duration-150',
            'focus:outline-none focus:border-md-primary focus:bg-md-surface-container-highest',
            error && 'border-md-error focus:border-md-error bg-md-error-container/20',
            className
          )
        )}
        {...props}
      />
      {error && <span className="text-xs text-md-error px-1">{error}</span>}
      {helperText && !error && <span className="text-xs text-md-outline px-1">{helperText}</span>}
    </div>
  );
};
