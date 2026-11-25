import { describe, it, expect } from 'vitest';
import {
  resolveTimerShortcutAction,
  shouldBlurActiveElementForTimerShortcuts,
} from '../src/components/timer/TimerWorkspace';

function createMockElement(opts: {
  tagName: string;
  focusVisible?: boolean;
  ariaCurrent?: string | null;
  isContentEditable?: boolean;
  hasHref?: boolean;
  blur?: () => void;
}) {
  return {
    tagName: opts.tagName,
    isContentEditable: Boolean(opts.isContentEditable),
    hasAttribute: (attr: string) => attr === 'href' && Boolean(opts.hasHref),
    getAttribute: (attr: string) => (attr === 'aria-current' ? (opts.ariaCurrent ?? null) : null),
    matches: (selector: string) => selector === ':focus-visible' && Boolean(opts.focusVisible),
    closest: () => null,
    blur: opts.blur ?? (() => {}),
  } as unknown as HTMLElement;
}

describe('Timer Keyboard Shortcuts & Focus Handling', () => {
  describe('resolveTimerShortcutAction', () => {
    const bodyTarget = createMockElement({ tagName: 'BODY' });

    it('resolves Space, ArrowLeft, ArrowRight, and R when no overlay or editable target is active', () => {
      expect(resolveTimerShortcutAction({ key: ' ', code: 'Space', target: bodyTarget }, false)).toBe('toggle');
      expect(resolveTimerShortcutAction({ key: 'ArrowLeft', target: bodyTarget }, false)).toBe('previous');
      expect(resolveTimerShortcutAction({ key: 'ArrowRight', target: bodyTarget }, false)).toBe('skip');
      expect(resolveTimerShortcutAction({ key: 'r', target: bodyTarget }, false)).toBe('reset');
      expect(resolveTimerShortcutAction({ key: 'R', target: bodyTarget }, false)).toBe('reset');
    });

    it('ignores shortcuts when modifier keys are pressed or an overlay is open', () => {
      expect(
        resolveTimerShortcutAction({ key: ' ', code: 'Space', ctrlKey: true, target: bodyTarget }, false)
      ).toBeNull();
      expect(
        resolveTimerShortcutAction({ key: ' ', code: 'Space', metaKey: true, target: bodyTarget }, false)
      ).toBeNull();
      expect(
        resolveTimerShortcutAction({ key: ' ', code: 'Space', altKey: true, target: bodyTarget }, false)
      ).toBeNull();
      expect(
        resolveTimerShortcutAction({ key: ' ', code: 'Space', target: bodyTarget }, true)
      ).toBeNull();
    });

    it('ignores shortcuts when focus is in an editable element', () => {
      const inputEl = createMockElement({ tagName: 'INPUT' });
      const textareaEl = createMockElement({ tagName: 'TEXTAREA' });
      const selectEl = createMockElement({ tagName: 'SELECT' });
      const editableDiv = createMockElement({ tagName: 'DIV', isContentEditable: true });

      for (const target of [inputEl, textareaEl, selectEl, editableDiv]) {
        expect(resolveTimerShortcutAction({ key: ' ', code: 'Space', target }, false)).toBeNull();
        expect(resolveTimerShortcutAction({ key: 'r', target }, false)).toBeNull();
      }
    });

    it('allows Space to toggle the timer on a mouse-focused button (:focus-visible is false)', () => {
      const clickedButton = createMockElement({ tagName: 'BUTTON', focusVisible: false });
      expect(
        resolveTimerShortcutAction({ key: ' ', code: 'Space', target: clickedButton }, false)
      ).toBe('toggle');
    });

    it('defers Space to an intentionally keyboard-focused interactive button (:focus-visible is true)', () => {
      const coffeeNavButton = createMockElement({ tagName: 'BUTTON', focusVisible: true });
      expect(
        resolveTimerShortcutAction({ key: ' ', code: 'Space', target: coffeeNavButton }, false)
      ).toBeNull();
    });

    it('allows Space to toggle the timer even if the active Timer home logo button (aria-current="page") has :focus-visible', () => {
      const activeLogoButton = createMockElement({
        tagName: 'BUTTON',
        focusVisible: true,
        ariaCurrent: 'page',
      });
      expect(
        resolveTimerShortcutAction({ key: ' ', code: 'Space', target: activeLogoButton }, false)
      ).toBe('toggle');
    });
  });

  describe('shouldBlurActiveElementForTimerShortcuts', () => {
    it('returns true for stale non-editable focused buttons (such as the sidebar logo) when no overlay is open', () => {
      const logoButton = createMockElement({ tagName: 'BUTTON', focusVisible: true, ariaCurrent: 'page' });
      const resetButton = createMockElement({ tagName: 'BUTTON', focusVisible: false });

      expect(shouldBlurActiveElementForTimerShortcuts(logoButton, false)).toBe(true);
      expect(shouldBlurActiveElementForTimerShortcuts(resetButton, false)).toBe(true);
    });

    it('returns false when a modal or listbox overlay is open', () => {
      const modalButton = createMockElement({ tagName: 'BUTTON', focusVisible: true });
      expect(shouldBlurActiveElementForTimerShortcuts(modalButton, true)).toBe(false);
    });

    it('returns false for editable elements so user input focus is preserved', () => {
      expect(shouldBlurActiveElementForTimerShortcuts(createMockElement({ tagName: 'INPUT' }), false)).toBe(false);
      expect(shouldBlurActiveElementForTimerShortcuts(createMockElement({ tagName: 'TEXTAREA' }), false)).toBe(false);
      expect(shouldBlurActiveElementForTimerShortcuts(createMockElement({ tagName: 'SELECT' }), false)).toBe(false);
      expect(
        shouldBlurActiveElementForTimerShortcuts(
          createMockElement({ tagName: 'DIV', isContentEditable: true }),
          false
        )
      ).toBe(false);
    });

    it('returns false for BODY, HTML, or null', () => {
      expect(shouldBlurActiveElementForTimerShortcuts(null, false)).toBe(false);
      expect(shouldBlurActiveElementForTimerShortcuts(createMockElement({ tagName: 'BODY' }), false)).toBe(false);
      expect(shouldBlurActiveElementForTimerShortcuts(createMockElement({ tagName: 'HTML' }), false)).toBe(false);
    });
  });
});
