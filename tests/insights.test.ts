import { describe, it, expect } from 'vitest';
import { generatePeriodInsights } from '../src/utils/insights';
import { CompletedSession } from '../src/types/session';
import { CoffeeCup } from '../src/types/coffee';
import { Tag } from '../src/types/tag';

const testTags: Tag[] = [
  { id: 'tag-code', name: 'Coding', color: '#3B82F6', isArchived: false },
  { id: 'tag-write', name: 'Writing', color: '#10B981', isArchived: false },
  { id: 'tag-admin', name: 'Admin', color: '#F59E0B', isArchived: false },
];

describe('generatePeriodInsights', () => {
  it('returns empty state when no sessions and no coffee cups exist', () => {
    const insights = generatePeriodInsights({
      sessions: [],
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 0,
      totalCoffeeCups: 0,
    });

    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0].type).toBe('empty-state');
    expect(insights[0].headline).toContain('No activity logged');
  });

  it('generates a daily summary for day view', () => {
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: '2026-11-03T10:30:00.000Z',
      },
    ];
    const coffee: CoffeeCup[] = [
      {
        id: 'c1',
        date: '2026-11-03',
        tagId: 'tag-code',
        createdAt: '2026-11-03T09:00:00.000Z',
      },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'day',
      totalFocusSeconds: 1500,
      totalCoffeeCups: 1,
    });

    const daySummary = insights.find((i) => i.type === 'daily-summary');
    expect(daySummary).toBeDefined();
    expect(daySummary?.headline).toContain('1 Pomodoro');
    expect(daySummary?.headline).toContain('1 cup');
  });

  it('detects precision peak focus window (e.g. 09:00–11:30)', () => {
    // 3 sessions concentrated between 09:00 and 11:30
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800, // 30m, 09:00 - 09:30
        completedAt: '2026-11-03T09:30:00.000Z',
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800, // 30m, 09:45 - 10:15
        completedAt: '2026-11-03T10:15:00.000Z',
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800, // 30m, 10:30 - 11:00
        completedAt: '2026-11-03T11:00:00.000Z',
      },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 5400,
      totalCoffeeCups: 0,
    });

    const peakWindow = insights.find((i) => i.type === 'peak-focus-window');
    expect(peakWindow).toBeDefined();
    expect(peakWindow?.badge).toBe('Peak Flow Window');
    expect(peakWindow?.headline).toContain('Your peak focus window is');
    expect(peakWindow?.description).toContain('deep work');
  });

  it('detects tag-coffee affinity using day and tag correlations', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: 'tag-code', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'c2', date: '2026-11-02', tagId: 'tag-code', createdAt: '2026-11-02T00:00:00.000Z' },
      { id: 'c3', date: '2026-11-03', tagId: 'tag-write', createdAt: '2026-11-03T00:00:00.000Z' },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 3600, completedAt: '2026-11-01T10:00:00.000Z' },
      { id: 's2', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 3600, completedAt: '2026-11-02T10:00:00.000Z' },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 7200,
      totalCoffeeCups: 3,
    });

    const affinity = insights.find((i) => i.type === 'tag-coffee-affinity');
    expect(affinity).toBeDefined();
    expect(affinity?.badge).toBe('Caffeine Affinity');
    expect(affinity?.headline).toContain('% of coffee was logged for Coding');
  });

  it('detects daily coffee ritual when logged on majority of active focus days', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: '2026-11-02T00:00:00.000Z' },
      { id: 'c3', date: '2026-11-03', tagId: null, createdAt: '2026-11-03T00:00:00.000Z' },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1500, completedAt: '2026-11-01T10:00:00.000Z' },
      { id: 's2', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1500, completedAt: '2026-11-02T10:00:00.000Z' },
      { id: 's3', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1500, completedAt: '2026-11-03T10:00:00.000Z' },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 4500,
      totalCoffeeCups: 3,
    });

    const ritualInsight = insights.find((i) => i.type === 'coffee-ritual');
    expect(ritualInsight).toBeDefined();
    expect(ritualInsight?.badge).toBe('Daily Ritual');
    expect(ritualInsight?.headline).toContain('Coffee Ritual: Logged on 100% of focus days');
  });

  it('detects break fatigue after 3 consecutive sessions without a break', () => {
    // Day 1: 3 consecutive sessions without break, then stops (total 3500s)
    // Day 2: 3 sessions spaced with breaks (total 6000s)
    const allSessions: CompletedSession[] = [
      // Day 1: unbroken marathon
      {
        id: 'd1-s1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: '2026-11-01T09:25:00.000Z',
      },
      {
        id: 'd1-s2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1200,
        completedAt: '2026-11-01T09:47:00.000Z',
      },
      {
        id: 'd1-s3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 800,
        completedAt: '2026-11-01T10:02:00.000Z',
      },

      // Day 2: balanced with breaks
      {
        id: 'd2-s1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: '2026-11-02T09:30:00.000Z',
      },
      {
        id: 'd2-b1',
        tagId: null,
        sessionType: 'SHORT_BREAK',
        durationSeconds: 300,
        completedAt: '2026-11-02T09:35:00.000Z',
      },
      {
        id: 'd2-s2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: '2026-11-02T10:05:00.000Z',
      },
      {
        id: 'd2-b2',
        tagId: null,
        sessionType: 'LONG_BREAK',
        durationSeconds: 900,
        completedAt: '2026-11-02T10:20:00.000Z',
      },
      {
        id: 'd2-s3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: '2026-11-02T10:50:00.000Z',
      },
    ];

    const workSessions = allSessions.filter((s) => s.sessionType === 'WORK');

    const insights = generatePeriodInsights({
      sessions: workSessions,
      allSessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: workSessions.reduce((acc, s) => acc + s.durationSeconds, 0),
      totalCoffeeCups: 0,
    });

    const fatigueInsight = insights.find((i) => i.type === 'break-fatigue');
    expect(fatigueInsight).toBeDefined();
    expect(fatigueInsight?.badge).toBe('Pacing Alert');
    expect(fatigueInsight?.headline).toContain('Focus drops after 3 consecutive sessions');
  });

  it('detects powerhouse day of the week', () => {
    // 4 sessions across Monday, Tuesday, Wednesday. Tuesday has significantly more focus.
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: '2026-11-02T10:00:00.000Z', // Monday
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 3600,
        completedAt: '2026-11-03T10:00:00.000Z', // Tuesday
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 3600,
        completedAt: '2026-11-03T15:00:00.000Z', // Tuesday (total 7200s)
      },
      {
        id: 's4',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: '2026-11-04T10:00:00.000Z', // Wednesday
      },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 13800,
      totalCoffeeCups: 0,
    });

    const powerhouse = insights.find((i) => i.type === 'powerhouse-day');
    expect(powerhouse).toBeDefined();
    expect(powerhouse?.badge).toBe('Productivity Rhythm');
    expect(powerhouse?.headline).toContain('Tuesday is your Powerhouse Day');
  });

  it('detects 3-day consistency streak and 10+ hours milestone', () => {
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400, // 4 hours
        completedAt: '2026-11-01T10:00:00.000Z',
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400, // 4 hours
        completedAt: '2026-11-02T10:00:00.000Z',
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400, // 4 hours (total 12 hours)
        completedAt: '2026-11-03T10:00:00.000Z',
      },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 43200,
      totalCoffeeCups: 0,
    });

    const streakInsight = insights.find((i) => i.type === 'focus-streak');
    expect(streakInsight).toBeDefined();
    expect(streakInsight?.headline).toContain('3-day daily focus streak');

    const milestoneInsight = insights.find((i) => i.type === 'milestone');
    expect(milestoneInsight).toBeDefined();
    expect(milestoneInsight?.headline).toContain('Surpassed 10 hours of deep work');
  });

  it('detects deep dive mode when single-tag days have higher focus than multi-tag days', () => {
    const sessions: CompletedSession[] = [
      // Day 1: Single tag (Coding), 7200s
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 3600,
        completedAt: '2026-11-01T09:00:00.000Z',
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 3600,
        completedAt: '2026-11-01T14:00:00.000Z',
      },

      // Day 2: Multi tags (Coding, Writing, Admin), 3000s
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1000,
        completedAt: '2026-11-02T09:00:00.000Z',
      },
      {
        id: 's4',
        tagId: 'tag-write',
        sessionType: 'WORK',
        durationSeconds: 1000,
        completedAt: '2026-11-02T11:00:00.000Z',
      },
      {
        id: 's5',
        tagId: 'tag-admin',
        sessionType: 'WORK',
        durationSeconds: 1000,
        completedAt: '2026-11-02T14:00:00.000Z',
      },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 10200,
      totalCoffeeCups: 0,
    });

    const deepDive = insights.find((i) => i.type === 'context-switching');
    expect(deepDive).toBeDefined();
    expect(deepDive?.badge).toBe('Deep Dive Mode');
    expect(deepDive?.headline).toContain('Deep Dive Mode: +');
  });

  it('detects coffee productivity boost on coffee days vs zero-coffee days', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: '2026-11-02T00:00:00.000Z' },
    ];

    const sessions: CompletedSession[] = [
      // Day 1 (coffee): 3600s
      { id: 's1', tagId: null, sessionType: 'WORK', durationSeconds: 3600, completedAt: '2026-11-01T10:00:00.000Z' },
      // Day 2 (coffee): 3600s
      { id: 's2', tagId: null, sessionType: 'WORK', durationSeconds: 3600, completedAt: '2026-11-02T10:00:00.000Z' },
      // Day 3 (zero coffee): 1200s
      { id: 's3', tagId: null, sessionType: 'WORK', durationSeconds: 1200, completedAt: '2026-11-03T10:00:00.000Z' },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 8400,
      totalCoffeeCups: 2,
    });

    const boost = insights.find((i) => i.type === 'coffee-productivity-boost');
    expect(boost).toBeDefined();
    expect(boost?.badge).toBe('Productivity Correlation');
    expect(boost?.headline).toContain('more focus on coffee days');
  });

  it('detects coffee sweet spot (1-2 cups vs 3+ cups daily)', () => {
    const coffee: CoffeeCup[] = [
      // Day 1: 1 cup, 4000s
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: '2026-11-01T00:00:00.000Z' },
      // Day 2: 2 cups, 4500s
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: '2026-11-02T00:00:00.000Z' },
      { id: 'c3', date: '2026-11-02', tagId: null, createdAt: '2026-11-02T00:00:00.000Z' },
      // Day 3: 3 cups, 2000s
      { id: 'c4', date: '2026-11-03', tagId: null, createdAt: '2026-11-03T00:00:00.000Z' },
      { id: 'c5', date: '2026-11-03', tagId: null, createdAt: '2026-11-03T00:00:00.000Z' },
      { id: 'c6', date: '2026-11-03', tagId: null, createdAt: '2026-11-03T00:00:00.000Z' },
      // Day 4: 0 cups
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: null, sessionType: 'WORK', durationSeconds: 4000, completedAt: '2026-11-01T10:00:00.000Z' },
      { id: 's2', tagId: null, sessionType: 'WORK', durationSeconds: 4500, completedAt: '2026-11-02T10:00:00.000Z' },
      { id: 's3', tagId: null, sessionType: 'WORK', durationSeconds: 2000, completedAt: '2026-11-03T10:00:00.000Z' },
      { id: 's4', tagId: null, sessionType: 'WORK', durationSeconds: 1500, completedAt: '2026-11-04T10:00:00.000Z' },
    ];

    const insights = generatePeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 12000,
      totalCoffeeCups: 6,
    });

    const sweetSpot = insights.find((i) => i.type === 'coffee-sweet-spot');
    expect(sweetSpot).toBeDefined();
    expect(sweetSpot?.badge).toBe('Caffeine Sweet Spot');
    expect(sweetSpot?.headline).toContain('1–2 cups yielded your highest daily focus');
  });
});
