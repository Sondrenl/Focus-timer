import { describe, it, expect } from 'vitest';
import { computeDayTimeRangeBreakdown } from '../src/utils/stats/dayTimeRanges';
import { CompletedSession } from '../src/types/session';

function makeWorkSession(id: string, localIsoCompletedAt: string, durationMinutes: number): CompletedSession {
  return {
    id,
    tagId: null,
    sessionType: 'WORK',
    durationSeconds: durationMinutes * 60,
    completedAt: new Date(localIsoCompletedAt).toISOString(),
  };
}

describe('computeDayTimeRangeBreakdown', () => {
  it('splits a session spanning 09:50 to 10:15 into 10m Morning and 15m Midday', () => {
    const sessions = [makeWorkSession('s1', '2026-11-15T10:15:00', 25)];
    const result = computeDayTimeRangeBreakdown(sessions);

    const byId = Object.fromEntries(result.map((r) => [r.id, r.totalSeconds]));
    expect(byId.morning).toBe(10 * 60);
    expect(byId.midday).toBe(15 * 60);
    expect(byId.afternoon).toBe(0);
    expect(byId.evening).toBe(0);
    expect(byId.night).toBe(0);
  });

  it('splits sessions across Midday/Afternoon, Afternoon/Evening, Evening/Night, and Night/Morning boundaries', () => {
    const sessions = [
      makeWorkSession('s1', '2026-11-15T14:15:00', 25), // 13:50–14:15 -> 10m Midday, 15m Afternoon
      makeWorkSession('s2', '2026-11-15T18:20:00', 30), // 17:50–18:20 -> 10m Afternoon, 20m Evening
      makeWorkSession('s3', '2026-11-15T22:15:00', 25), // 21:50–22:15 -> 10m Evening, 15m Night
      makeWorkSession('s4', '2026-11-15T06:15:00', 25), // 05:50–06:15 -> 10m Night, 15m Morning
    ];
    const result = computeDayTimeRangeBreakdown(sessions);
    const byId = Object.fromEntries(result.map((r) => [r.id, r.totalSeconds]));

    expect(byId.morning).toBe(15 * 60);
    expect(byId.midday).toBe(10 * 60);
    expect(byId.afternoon).toBe(25 * 60);
    expect(byId.evening).toBe(30 * 60);
    expect(byId.night).toBe(25 * 60);
  });

  it('attributes a session crossing midnight (23:50 to 00:15) entirely to Night', () => {
    const sessions = [makeWorkSession('s1', '2026-11-15T00:15:00', 25)];
    const result = computeDayTimeRangeBreakdown(sessions);
    const byId = Object.fromEntries(result.map((r) => [r.id, r.totalSeconds]));

    expect(byId.night).toBe(25 * 60);
    expect(byId.morning).toBe(0);
    expect(byId.midday).toBe(0);
    expect(byId.afternoon).toBe(0);
    expect(byId.evening).toBe(0);
  });

  it('splits a long session spanning multiple ranges accurately', () => {
    // 09:45 to 14:15 = 4h 30m (15m Morning, 4h Midday, 15m Afternoon)
    const sessions = [makeWorkSession('s1', '2026-11-15T14:15:00', 270)];
    const result = computeDayTimeRangeBreakdown(sessions);
    const byId = Object.fromEntries(result.map((r) => [r.id, r.totalSeconds]));

    expect(byId.morning).toBe(15 * 60);
    expect(byId.midday).toBe(240 * 60);
    expect(byId.afternoon).toBe(15 * 60);
  });

  it('ignores break sessions and zero-duration sessions', () => {
    const sessions: CompletedSession[] = [
      {
        id: 'b1',
        tagId: null,
        sessionType: 'SHORT_BREAK',
        durationSeconds: 300,
        completedAt: new Date('2026-11-15T10:15:00').toISOString(),
      },
      makeWorkSession('z1', '2026-11-15T10:15:00', 0),
    ];
    const result = computeDayTimeRangeBreakdown(sessions);
    const total = result.reduce((acc, r) => acc + r.totalSeconds, 0);
    expect(total).toBe(0);
  });
});
