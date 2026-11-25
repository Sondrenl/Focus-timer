import React, { useEffect } from 'react';
import { TagSelector } from './TagSelector';
import { TimerDisplay } from './TimerDisplay';
import { TimerControls } from './TimerControls';
import { CycleIndicator } from './CycleIndicator';
import { useTimer } from '../../context/TimerContext';

interface TimerWorkspaceProps {
  isActiveView?: boolean;
}

export type TimerShortcutAction = 'toggle' | 'previous' | 'skip' | 'reset' | null;

export interface TimerShortcutKeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as Partial<HTMLElement>;
  const tagName = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName) || Boolean(el.isContentEditable);
}

function isKeyboardFocusedInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as Partial<HTMLElement>;
  const tagName = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  const isButtonOrLink =
    tagName === 'BUTTON' ||
    (tagName === 'A' && typeof el.hasAttribute === 'function' && el.hasAttribute('href'));
  const interactiveEl = isButtonOrLink
    ? el
    : typeof el.closest === 'function'
      ? el.closest('button, a[href]')
      : null;
  if (!interactiveEl || typeof interactiveEl.matches !== 'function') {
    return false;
  }
  if (
    typeof interactiveEl.getAttribute === 'function' &&
    interactiveEl.getAttribute('aria-current') === 'page'
  ) {
    return false;
  }
  try {
    return interactiveEl.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function shouldBlurActiveElementForTimerShortcuts(
  activeElement: EventTarget | null,
  hasOpenOverlay: boolean
): boolean {
  if (hasOpenOverlay) return false;
  if (!activeElement || typeof activeElement !== 'object') return false;
  if (isEditableShortcutTarget(activeElement)) return false;

  const el = activeElement as Partial<HTMLElement>;
  const tagName = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (!tagName || tagName === 'BODY' || tagName === 'HTML') {
    return false;
  }

  return typeof el.blur === 'function';
}

export function resolveTimerShortcutAction(
  e: TimerShortcutKeyEventLike,
  hasOpenOverlay: boolean
): TimerShortcutAction {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return null;
  }

  if (isEditableShortcutTarget(e.target)) {
    return null;
  }

  if (hasOpenOverlay) {
    return null;
  }

  if (e.code === 'Space') {
    if (isKeyboardFocusedInteractiveTarget(e.target)) {
      return null;
    }
    return 'toggle';
  }
  if (e.key === 'ArrowLeft') {
    return 'previous';
  }
  if (e.key === 'ArrowRight') {
    return 'skip';
  }
  if (e.key === 'r' || e.key === 'R') {
    return 'reset';
  }

  return null;
}

export const TimerWorkspace: React.FC<TimerWorkspaceProps> = ({ isActiveView = true }) => {
  const {
    sessionType,
    status,
    remainingSeconds,
    totalSeconds,
    currentCycle,
    maxCycles,
    toggleStartPause,
    resetTimer,
    skipInterval,
    previousInterval,
  } = useTimer();

  // Clear stale non-editable focus (e.g. sidebar logo or previously clicked buttons)
  // when entering the Timer view or switching browser tabs so Space works immediately.
  useEffect(() => {
    if (!isActiveView) return;

    const clearStaleFocus = () => {
      const hasOpenOverlay = Boolean(
        document.querySelector('[role="dialog"], [role="listbox"]')
      );
      const activeElement = document.activeElement;
      if (shouldBlurActiveElementForTimerShortcuts(activeElement, hasOpenOverlay)) {
        (activeElement as HTMLElement).blur();
      }
    };

    clearStaleFocus();

    window.addEventListener('focus', clearStaleFocus);
    document.addEventListener('visibilitychange', clearStaleFocus);
    return () => {
      window.removeEventListener('focus', clearStaleFocus);
      document.removeEventListener('visibilitychange', clearStaleFocus);
    };
  }, [isActiveView]);

  // Keyboard shortcut listener (Space = Toggle, ArrowLeft = Back, ArrowRight = Skip, R = Reset)
  // Only active when the Timer tab is actively displayed to the user
  useEffect(() => {
    if (!isActiveView) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const hasOpenOverlay = Boolean(
        document.querySelector('[role="dialog"], [role="listbox"]')
      );
      const action = resolveTimerShortcutAction(e, hasOpenOverlay);
      if (!action) return;

      if (action === 'toggle') {
        e.preventDefault();
        toggleStartPause();
      } else if (action === 'previous') {
        e.preventDefault();
        previousInterval();
      } else if (action === 'skip') {
        e.preventDefault();
        skipInterval();
      } else if (action === 'reset') {
        resetTimer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActiveView, toggleStartPause, resetTimer, skipInterval, previousInterval]);

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center justify-center py-6 px-4">
      {/* Top Tag Selector */}
      <div className="w-full flex flex-col items-center mb-6">
        <TagSelector />
      </div>

      {/* Central Timer Elements (no box/card container) */}
      <div className="w-full flex flex-col items-center">
        <CycleIndicator
          currentCycle={currentCycle}
          maxCycles={maxCycles}
          sessionType={sessionType}
        />

        <TimerDisplay
          remainingSeconds={remainingSeconds}
          totalSeconds={totalSeconds}
          sessionType={sessionType}
          status={status}
        />

        <TimerControls
          status={status}
          onToggleStartPause={toggleStartPause}
          onReset={resetTimer}
          onSkip={skipInterval}
          onPrevious={previousInterval}
        />
      </div>

      {/* Helpful keyboard cues (hidden on mobile devices) */}
      <div className="hidden sm:flex items-center gap-4 text-[11px] text-md-outline mt-8 select-none font-mono">
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">Space</kbd> Start/Pause</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">←</kbd> Back</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">→</kbd> Skip</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/40">R</kbd> Reset</span>
      </div>
    </div>
  );
};
