import { describe, it, expect } from 'vitest';
import {
  computeNextInterval,
  computePreviousInterval,
  getDurationForType,
} from '../src/utils/timerTransitions';
import { UserSettings } from '../src/types/settings';

const mockSettings: UserSettings = {
  workDurationMinutes: 25,
  shortBreakDurationMinutes: 5,
  longBreakDurationMinutes: 20,
  longBreakInterval: 4,
  autoStartBreaks: true,
  autoStartPomodoros: false,
  soundVolume: 0.8,
  soundEnabled: true,
  notificationsEnabled: true,
};

describe('Timer State Machine - Interval Transitions', () => {
  it('correctly calculates durations in seconds based on settings', () => {
    expect(getDurationForType('WORK', mockSettings)).toBe(25 * 60);
    expect(getDurationForType('SHORT_BREAK', mockSettings)).toBe(5 * 60);
    expect(getDurationForType('LONG_BREAK', mockSettings)).toBe(20 * 60);
  });

  it('transitions from WORK to SHORT_BREAK for cycles 1, 2, and 3', () => {
    const cycle1 = computeNextInterval('WORK', 1, mockSettings);
    expect(cycle1.nextType).toBe('SHORT_BREAK');
    expect(cycle1.nextCycle).toBe(1);
    expect(cycle1.nextDuration).toBe(5 * 60);
    expect(cycle1.shouldAutoStart).toBe(true); // autoStartBreaks is true

    const cycle2 = computeNextInterval('WORK', 2, mockSettings);
    expect(cycle2.nextType).toBe('SHORT_BREAK');
    expect(cycle2.nextCycle).toBe(2);

    const cycle3 = computeNextInterval('WORK', 3, mockSettings);
    expect(cycle3.nextType).toBe('SHORT_BREAK');
    expect(cycle3.nextCycle).toBe(3);
  });

  it('transitions from WORK to LONG_BREAK on reaching longBreakInterval (cycle 4)', () => {
    const cycle4 = computeNextInterval('WORK', 4, mockSettings);
    expect(cycle4.nextType).toBe('LONG_BREAK');
    expect(cycle4.nextCycle).toBe(4);
    expect(cycle4.nextDuration).toBe(20 * 60);
    expect(cycle4.shouldAutoStart).toBe(true);
  });

  it('increments cycle count when SHORT_BREAK finishes', () => {
    const fromBreak1 = computeNextInterval('SHORT_BREAK', 1, mockSettings);
    expect(fromBreak1.nextType).toBe('WORK');
    expect(fromBreak1.nextCycle).toBe(2);
    expect(fromBreak1.nextDuration).toBe(25 * 60);
    expect(fromBreak1.shouldAutoStart).toBe(false); // autoStartPomodoros is false

    const fromBreak2 = computeNextInterval('SHORT_BREAK', 2, mockSettings);
    expect(fromBreak2.nextType).toBe('WORK');
    expect(fromBreak2.nextCycle).toBe(3);
  });

  it('resets cycle count back to 1 when LONG_BREAK finishes', () => {
    const fromLongBreak = computeNextInterval('LONG_BREAK', 4, mockSettings);
    expect(fromLongBreak.nextType).toBe('WORK');
    expect(fromLongBreak.nextCycle).toBe(1);
    expect(fromLongBreak.nextDuration).toBe(25 * 60);
    expect(fromLongBreak.shouldAutoStart).toBe(false);
  });

  it('honors autoStartPomodoros setting when enabled', () => {
    const autoSettings: UserSettings = {
      ...mockSettings,
      autoStartPomodoros: true,
      autoStartBreaks: false,
    };

    const fromShortBreak = computeNextInterval('SHORT_BREAK', 2, autoSettings);
    expect(fromShortBreak.shouldAutoStart).toBe(true);

    const fromWork = computeNextInterval('WORK', 2, autoSettings);
    expect(fromWork.shouldAutoStart).toBe(false);
  });

  describe('computePreviousInterval', () => {
    it('transitions from WORK (cycle 1) to LONG_BREAK (cycle longBreakInterval)', () => {
      const prev = computePreviousInterval('WORK', 1, mockSettings);
      expect(prev.previousType).toBe('LONG_BREAK');
      expect(prev.previousCycle).toBe(4); // mockSettings.longBreakInterval = 4
      expect(prev.previousDuration).toBe(20 * 60);
    });

    it('transitions from WORK (cycle N > 1) to SHORT_BREAK (cycle N - 1)', () => {
      const prevCycle2 = computePreviousInterval('WORK', 2, mockSettings);
      expect(prevCycle2.previousType).toBe('SHORT_BREAK');
      expect(prevCycle2.previousCycle).toBe(1);
      expect(prevCycle2.previousDuration).toBe(5 * 60);

      const prevCycle4 = computePreviousInterval('WORK', 4, mockSettings);
      expect(prevCycle4.previousType).toBe('SHORT_BREAK');
      expect(prevCycle4.previousCycle).toBe(3);
      expect(prevCycle4.previousDuration).toBe(5 * 60);
    });

    it('transitions from SHORT_BREAK (cycle N) to WORK (cycle N)', () => {
      const prevBreak1 = computePreviousInterval('SHORT_BREAK', 1, mockSettings);
      expect(prevBreak1.previousType).toBe('WORK');
      expect(prevBreak1.previousCycle).toBe(1);
      expect(prevBreak1.previousDuration).toBe(25 * 60);

      const prevBreak3 = computePreviousInterval('SHORT_BREAK', 3, mockSettings);
      expect(prevBreak3.previousType).toBe('WORK');
      expect(prevBreak3.previousCycle).toBe(3);
      expect(prevBreak3.previousDuration).toBe(25 * 60);
    });

    it('transitions from LONG_BREAK (cycle N) to WORK (cycle N)', () => {
      const prevLongBreak = computePreviousInterval('LONG_BREAK', 4, mockSettings);
      expect(prevLongBreak.previousType).toBe('WORK');
      expect(prevLongBreak.previousCycle).toBe(4);
      expect(prevLongBreak.previousDuration).toBe(25 * 60);
    });
  });
});

