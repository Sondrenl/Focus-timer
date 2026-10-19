import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center pt-3 px-3 pb-4 md:p-4 overflow-y-auto">
      {/* Scrim / Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* M3 Dialog Container - anchored near top on mobile so virtual keyboards never cover lower half, centered on desktop */}
      <div className="relative w-full max-w-md bg-md-surface-container-high rounded-3xl p-4 md:p-6 shadow-elevation-3 z-10 max-h-[calc(100dvh-1.5rem)] md:max-h-none overflow-y-auto md:overflow-visible animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-2.5 md:pb-3 mb-3 border-b border-md-outline-variant/30">
          <h2 className="text-lg md:text-xl font-bold text-md-on-surface">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-10 h-10 md:w-auto md:h-auto md:p-1.5 flex items-center justify-center rounded-full text-md-on-surface-variant hover:bg-md-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
};
