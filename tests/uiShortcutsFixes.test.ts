import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { resolveTimerShortcutAction } from '../src/components/timer/TimerWorkspace';
import { resolveCoffeeShortcutAction } from '../src/components/coffee/CoffeeWorkspace';
import { ProfileSummaryCard } from '../src/components/profile/ProfileSummaryCard';
import { computeDayTimeRangeBreakdown } from '../src/utils/stats/dayTimeRanges';
import {
  filterPeriodSessions,
  computeActivityBars,
  computeProductiveMetric,
  getEffectiveSessionDate,
} from '../src/utils/stats/focusStats';
import { computePeriodBounds } from '../src/utils/stats/periodBounds';
import { CompletedSession } from '../src/types/session';
import { StatSession } from '../src/utils/stats/types';

function makeMockElement(opts: {
  tagName: string;
  focusVisible?: boolean;
  hasHref?: boolean;
  isContentEditable?: boolean;
}): EventTarget {
  const el = {
    tagName: opts.tagName,
    isContentEditable: Boolean(opts.isContentEditable),
    hasAttribute: (attr: string) => attr === 'href' && Boolean(opts.hasHref),
    matches: (selector: string) => selector === ':focus-visible' && Boolean(opts.focusVisible),
    closest: (selector: string) => {
      if (selector.includes('button') && opts.tagName.toUpperCase() === 'BUTTON') return el;
      if (selector.includes('a[href]') && opts.tagName.toUpperCase() === 'A' && opts.hasHref) {
        return el;
      }
      return null;
    },
  };
  return el as unknown as EventTarget;
}

function localIso(
  year: number,
  month1Based: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
  ms = 0
): string {
  return new Date(year, month1Based - 1, day, hour, minute, second, ms).toISOString();
}

describe('TimerWorkspace keyboard shortcut resolution', () => {
  it('allows Space, ArrowLeft, ArrowRight, and R after mouse-clicking a button', () => {
    const clickedButton = makeMockElement({ tagName: 'BUTTON', focusVisible: false });

    expect(
      resolveTimerShortcutAction({ key: ' ', code: 'Space', target: clickedButton }, false)
    ).toBe('toggle');
    expect(
      resolveTimerShortcutAction({ key: 'ArrowLeft', code: 'ArrowLeft', target: clickedButton }, false)
    ).toBe('previous');
    expect(
      resolveTimerShortcutAction({ key: 'ArrowRight', code: 'ArrowRight', target: clickedButton }, false)
    ).toBe('skip');
    expect(
      resolveTimerShortcutAction({ key: 'r', code: 'KeyR', target: clickedButton }, false)
    ).toBe('reset');
    expect(
      resolveTimerShortcutAction({ key: 'R', code: 'KeyR', target: clickedButton }, false)
    ).toBe('reset');
  });

  it('defers Space to native activation only when a button or link is keyboard-focused (:focus-visible)', () => {
    const keyboardFocusedButton = makeMockElement({ tagName: 'BUTTON', focusVisible: true });
    const keyboardFocusedLink = makeMockElement({
      tagName: 'A',
      hasHref: true,
      focusVisible: true,
    });
    const clickedLink = makeMockElement({
      tagName: 'A',
      hasHref: true,
      focusVisible: false,
    });

    expect(
      resolveTimerShortcutAction({ key: ' ', code: 'Space', target: keyboardFocusedButton }, false)
    ).toBeNull();
    expect(
      resolveTimerShortcutAction({ key: ' ', code: 'Space', target: keyboardFocusedLink }, false)
    ).toBeNull();
    expect(
      resolveTimerShortcutAction({ key: ' ', code: 'Space', target: clickedLink }, false)
    ).toBe('toggle');

    // Non-Space shortcuts still work even when a button is keyboard-focused
    expect(
      resolveTimerShortcutAction(
        { key: 'ArrowLeft', code: 'ArrowLeft', target: keyboardFocusedButton },
        false
      )
    ).toBe('previous');
    expect(
      resolveTimerShortcutAction(
        { key: 'ArrowRight', code: 'ArrowRight', target: keyboardFocusedButton },
        false
      )
    ).toBe('skip');
    expect(
      resolveTimerShortcutAction({ key: 'r', code: 'KeyR', target: keyboardFocusedButton }, false)
    ).toBe('reset');
  });

  it('still blocks shortcuts in editable targets, with modifier keys, or when overlays are open', () => {
    const input = makeMockElement({ tagName: 'INPUT' });
    const textarea = makeMockElement({ tagName: 'TEXTAREA' });
    const select = makeMockElement({ tagName: 'SELECT' });
    const editable = makeMockElement({ tagName: 'DIV', isContentEditable: true });
    const body = makeMockElement({ tagName: 'BODY' });

    for (const target of [input, textarea, select, editable]) {
      expect(resolveTimerShortcutAction({ key: ' ', code: 'Space', target }, false)).toBeNull();
      expect(resolveTimerShortcutAction({ key: 'r', code: 'KeyR', target }, false)).toBeNull();
    }

    expect(
      resolveTimerShortcutAction({ key: 'r', code: 'KeyR', metaKey: true, target: body }, false)
    ).toBeNull();
    expect(
      resolveTimerShortcutAction({ key: 'r', code: 'KeyR', ctrlKey: true, target: body }, false)
    ).toBeNull();
    expect(
      resolveTimerShortcutAction(
        { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, target: body },
        false
      )
    ).toBeNull();
    expect(
      resolveTimerShortcutAction({ key: ' ', code: 'Space', target: body }, true)
    ).toBeNull();
  });
});

describe('CoffeeWorkspace keyboard shortcut resolution', () => {
  it('allows +, =, and - even when a button retains focus after clicking controls', () => {
    const clickedButton = makeMockElement({ tagName: 'BUTTON', focusVisible: false });
    const keyboardButton = makeMockElement({ tagName: 'BUTTON', focusVisible: true });

    for (const target of [clickedButton, keyboardButton]) {
      expect(resolveCoffeeShortcutAction({ key: '+', target }, false)).toBe('add');
      expect(resolveCoffeeShortcutAction({ key: '=', target }, false)).toBe('add');
      expect(resolveCoffeeShortcutAction({ key: '-', target }, false)).toBe('remove');
    }
  });

  it('blocks shortcuts in inputs, with modifier keys, or when an overlay is open', () => {
    const input = makeMockElement({ tagName: 'INPUT' });
    const textarea = makeMockElement({ tagName: 'TEXTAREA' });
    const select = makeMockElement({ tagName: 'SELECT' });
    const editable = makeMockElement({ tagName: 'DIV', isContentEditable: true });
    const body = makeMockElement({ tagName: 'BODY' });

    for (const target of [input, textarea, select, editable]) {
      expect(resolveCoffeeShortcutAction({ key: '+', target }, false)).toBeNull();
      expect(resolveCoffeeShortcutAction({ key: '-', target }, false)).toBeNull();
    }

    expect(resolveCoffeeShortcutAction({ key: '+', ctrlKey: true, target: body }, false)).toBeNull();
    expect(resolveCoffeeShortcutAction({ key: '-', metaKey: true, target: body }, false)).toBeNull();
    expect(resolveCoffeeShortcutAction({ key: '=', altKey: true, target: body }, false)).toBeNull();
    expect(resolveCoffeeShortcutAction({ key: '+', target: body }, true)).toBeNull();
  });
});

describe('ProfileSummaryCard fallbacks', () => {
  it('displays the 120m fallback daily goal when profile.dailyGoalMinutes is 0', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProfileSummaryCard, {
        profile: {
          displayName: 'Test User',
          avatarEmoji: '👨‍👩‍👧‍👦',
          dailyGoalMinutes: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        updateProfile: async () => {},
        sessions: [],
        tags: [],
        isAuthenticated: false,
      })
    );

    expect(html).toContain('0m / 120m (0%)');
    expect(html).not.toContain('0m / 0m');
    expect(html).toContain('👨‍👩‍👧‍👦');
  });
});

describe('Exact-midnight (00:00:00.000) focus session attribution', () => {
  it('attributes 23:35–00:00:00.000 session to Night in computeDayTimeRangeBreakdown instead of 0s', () => {
    const sessions: CompletedSession[] = [
      {
        id: 'midnight-exact-1',
        tagId: null,
        sessionType: 'WORK',
        durationSeconds: 25 * 60,
        completedAt: localIso(2026, 11, 15, 0, 0, 0, 0),
      },
    ];

    const result = computeDayTimeRangeBreakdown(sessions);
    const byId = Object.fromEntries(result.map((r) => [r.id, r.totalSeconds]));

    expect(byId.night).toBe(25 * 60);
    expect(byId.evening).toBe(0);
    expect(byId.morning).toBe(0);
    expect(byId.midday).toBe(0);
    expect(byId.afternoon).toBe(0);
  });

  it('splits a long session ending at exact midnight (21:30–00:00:00.000) across Evening and Night of Day D-1', () => {
    const sessions: CompletedSession[] = [
      {
        id: 'midnight-exact-long',
        tagId: null,
        sessionType: 'WORK',
        durationSeconds: 150 * 60, // 21:30–22:00 Evening (30m) + 22:00–24:00 Night (120m)
        completedAt: localIso(2026, 11, 15, 0, 0, 0, 0),
      },
    ];

    const result = computeDayTimeRangeBreakdown(sessions);
    const byId = Object.fromEntries(result.map((r) => [r.id, r.totalSeconds]));

    expect(byId.evening).toBe(30 * 60);
    expect(byId.night).toBe(120 * 60);
  });

  it('shifts effective date to Day D-1 for exact midnight with positive duration, but not for 00:00:00.001', () => {
    const exactMidnight = getEffectiveSessionDate(localIso(2026, 11, 15, 0, 0, 0, 0), 1500);
    expect(exactMidnight?.getFullYear()).toBe(2026);
    expect(exactMidnight?.getMonth()).toBe(10);
    expect(exactMidnight?.getDate()).toBe(14);
    expect(exactMidnight?.getHours()).toBe(23);

    const oneMsPastMidnight = getEffectiveSessionDate(localIso(2026, 11, 15, 0, 0, 0, 1), 1500);
    expect(oneMsPastMidnight?.getDate()).toBe(15);
    expect(oneMsPastMidnight?.getHours()).toBe(0);
  });

  it('keeps filterPeriodSessions, day/week activity bars, and peak metric consistent for exact-midnight sessions', () => {
    // Sunday Nov 15, 2026 23:35 -> Monday Nov 16, 2026 00:00:00.000
    const session: StatSession = {
      id: 'week-boundary-midnight',
      sessionType: 'WORK',
      durationSeconds: 1500,
      completedAt: localIso(2026, 11, 16, 0, 0, 0, 0),
    };

    const refSunNov15 = new Date(2026, 10, 15, 12, 0, 0);
    const weekBounds = computePeriodBounds('week', refSunNov15, {
      start: '2026-11-09',
      end: '2026-11-15',
    });

    const filteredWeek = filterPeriodSessions(
      [session],
      weekBounds.startDate,
      weekBounds.endDate,
      true
    );
    expect(filteredWeek.filteredSessions).toHaveLength(1);

    const weekBars = computeActivityBars(
      filteredWeek.filteredSessions,
      'week',
      refSunNov15,
      weekBounds.startDate,
      weekBounds.sanitizedCustomRange
    );
    const sundayBar = weekBars.find((b) => b.key === '2026-11-15');
    expect(sundayBar?.totalSeconds).toBe(1500);
    expect(sundayBar?.sessionCount).toBe(1);

    const dayBars = computeActivityBars(
      filteredWeek.filteredSessions,
      'day',
      refSunNov15,
      new Date(2026, 10, 15, 0, 0, 0, 0),
      { start: '2026-11-15', end: '2026-11-15' }
    );
    const peak = computeProductiveMetric(
      filteredWeek.filteredSessions,
      dayBars,
      'day',
      refSunNov15,
      false
    );
    expect(peak.hasData).toBe(true);
    expect(peak.value).toBe('23:00 – 00:00');
    expect(peak.subtext).toBe('25m focused');
  });
});
