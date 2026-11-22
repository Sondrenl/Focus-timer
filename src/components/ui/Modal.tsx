import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  dismissible?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  dismissible = true,
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const prevIsOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  // Capture previously focused element synchronously during render (before commit)
  // because child `autoFocus` runs during commitMount before useEffect executes.
  if (isOpen && !prevIsOpenRef.current) {
    previouslyFocusedRef.current =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  prevIsOpenRef.current = isOpen;

  useEffect(() => {
    if (!isOpen) return;

    const dialogEl = dialogRef.current;
    if (dialogEl && !dialogEl.contains(document.activeElement)) {
      const focusable = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.getAttribute('aria-hidden') !== 'true');
      (focusable[0] ?? dialogEl).focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissibleRef.current) {
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.getAttribute('aria-hidden') !== 'true');

        if (focusable.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (!prevIsOpenRef.current || !dialogRef.current?.isConnected) {
        const prev = previouslyFocusedRef.current;
        previouslyFocusedRef.current = null;
        if (prev && prev.isConnected) {
          prev.focus();
        }
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start md:items-center justify-center pt-3 px-3 pb-4 md:p-4 overflow-y-auto"
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Scrim / Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />

      {/* M3 Dialog Container - anchored near top on mobile so virtual keyboards never cover lower half, centered on desktop */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md bg-md-surface-container-high rounded-3xl p-4 md:p-6 shadow-elevation-3 z-10 max-h-[calc(100dvh-1.5rem)] md:max-h-none overflow-y-auto md:overflow-visible animate-in fade-in zoom-in-95 duration-150 focus:outline-none"
      >
        <div className="flex items-center justify-between pb-2.5 md:pb-3 mb-3 border-b border-md-outline-variant/30">
          <h2 id={titleId} className="text-lg md:text-xl font-bold text-md-on-surface">{title}</h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="w-10 h-10 md:w-auto md:h-auto md:p-1.5 flex items-center justify-center rounded-full text-md-on-surface-variant hover:bg-md-surface-variant transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
};
