import { describe, it, expect } from 'vitest';
import {
  generatePeriodInsights,
  generateAllPeriodInsights,
  selectTieredInsight,
  INSIGHT_TIERS,
} from '../src/utils/insights';
import { CompletedSession } from '../src/types/session';
import { CoffeeCup } from '../src/types/coffee';
import { Tag } from '../src/types/tag';

const testTags: Tag[] = [
  { id: 'tag-code', name: 'Coding', color: '#3B82F6', isArchived: false },
  { id: 'tag-write', name: 'Writing', color: '#10B981', isArchived: false },
  { id: 'tag-admin', name: 'Admin', color: '#F59E0B', isArchived: false },
];

describe('generatePeriodInsights & tiered insight selection', () => {
  it('returns empty state (Tier 3) when no sessions and no coffee cups exist', () => {
    const insights = generatePeriodInsights({
      sessions: [],
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 0,
      totalCoffeeCups: 0,
    });

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('empty-state');
    expect(insights[0].tier).toBe(3);
    expect(insights[0].headline).toContain('No activity logged');
    expect(insights[0].description).toBe('Complete a session or log a cup of coffee to view insights');
  });

  it('generates a daily summary (Tier 3) for day view when no higher-tier insights apply', () => {
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

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('daily-summary');
    expect(insights[0].tier).toBe(3);
    expect(insights[0].headline).toContain('1 Pomodoro');
    expect(insights[0].headline).toContain('1 cup');
  });

  it('detects precision peak focus window (Tier 1)', () => {
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: '2026-11-03T09:30:00.000Z',
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: '2026-11-03T10:15:00.000Z',
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
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

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('peak-focus-window');
    expect(insights[0].tier).toBe(1);
    expect(insights[0].badge).toBe('Peak Flow Window');
    expect(insights[0].headline).toContain('Your peak focus window is');
  });

  it('detects tag-coffee affinity (Tier 1) using day and tag correlations', () => {
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

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('tag-coffee-affinity');
    expect(insights[0].tier).toBe(1);
    expect(insights[0].badge).toBe('Caffeine Affinity');
    expect(insights[0].headline).toContain('% of coffee was logged for Coding');
  });

  it('detects daily coffee ritual (Tier 3) when logged on majority of active focus days', () => {
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

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 4500,
      totalCoffeeCups: 3,
    });

    const ritualInsight = allInsights.find((i) => i.type === 'coffee-ritual');
    expect(ritualInsight).toBeDefined();
    expect(ritualInsight?.tier).toBe(3);
    expect(ritualInsight?.badge).toBe('Daily Ritual');
    expect(ritualInsight?.headline).toContain('Coffee Ritual: Logged on 100% of focus days');
  });

  it('detects break fatigue (Tier 1) after 3 consecutive sessions without a break', () => {
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

    const allInsights = generateAllPeriodInsights({
      sessions: workSessions,
      allSessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: workSessions.reduce((acc, s) => acc + s.durationSeconds, 0),
      totalCoffeeCups: 0,
    });

    const fatigueInsight = allInsights.find((i) => i.type === 'break-fatigue');
    expect(fatigueInsight).toBeDefined();
    expect(fatigueInsight?.tier).toBe(1);
    expect(fatigueInsight?.badge).toBe('Pacing Alert');
    expect(fatigueInsight?.headline).toContain('Focus drops after 3 consecutive sessions');
  });

  it('detects powerhouse day of the week (Tier 2)', () => {
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

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 13800,
      totalCoffeeCups: 0,
    });

    const powerhouse = allInsights.find((i) => i.type === 'powerhouse-day');
    expect(powerhouse).toBeDefined();
    expect(powerhouse?.tier).toBe(2);
    expect(powerhouse?.badge).toBe('Productivity Rhythm');
    expect(powerhouse?.headline).toContain('Tuesday is your Powerhouse Day');
  });

  it('detects 3-day consistency streak (Tier 2) and 10+ hours milestone (Tier 3)', () => {
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400,
        completedAt: '2026-11-01T10:00:00.000Z',
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400,
        completedAt: '2026-11-02T10:00:00.000Z',
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400,
        completedAt: '2026-11-03T10:00:00.000Z',
      },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 43200,
      totalCoffeeCups: 0,
    });

    const streakInsight = allInsights.find((i) => i.type === 'focus-streak');
    expect(streakInsight).toBeDefined();
    expect(streakInsight?.tier).toBe(2);
    expect(streakInsight?.headline).toContain('3-day daily focus streak');

    const milestoneInsight = allInsights.find((i) => i.type === 'milestone');
    expect(milestoneInsight).toBeDefined();
    expect(milestoneInsight?.tier).toBe(3);
    expect(milestoneInsight?.headline).toContain('Surpassed 10 hours of deep work');
  });

  it('detects deep dive mode (Tier 1) when single-tag days have higher focus than multi-tag days', () => {
    const sessions: CompletedSession[] = [
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

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 10200,
      totalCoffeeCups: 0,
    });

    const deepDive = allInsights.find((i) => i.type === 'context-switching');
    expect(deepDive).toBeDefined();
    expect(deepDive?.tier).toBe(1);
    expect(deepDive?.badge).toBe('Deep Dive Mode');
    expect(deepDive?.headline).toContain('Deep Dive Mode: +');
  });

  it('detects coffee productivity boost (Tier 1) on coffee days vs zero-coffee days', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: '2026-11-02T00:00:00.000Z' },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: null, sessionType: 'WORK', durationSeconds: 3600, completedAt: '2026-11-01T10:00:00.000Z' },
      { id: 's2', tagId: null, sessionType: 'WORK', durationSeconds: 3600, completedAt: '2026-11-02T10:00:00.000Z' },
      { id: 's3', tagId: null, sessionType: 'WORK', durationSeconds: 1200, completedAt: '2026-11-03T10:00:00.000Z' },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 8400,
      totalCoffeeCups: 2,
    });

    const boost = allInsights.find((i) => i.type === 'coffee-productivity-boost');
    expect(boost).toBeDefined();
    expect(boost?.tier).toBe(1);
    expect(boost?.badge).toBe('Productivity Correlation');
    expect(boost?.headline).toContain('more focus on coffee days');
  });

  it('detects coffee sweet spot (Tier 1) and selects randomly among available Tier 1 insights', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: '2026-11-02T00:00:00.000Z' },
      { id: 'c3', date: '2026-11-02', tagId: null, createdAt: '2026-11-02T00:00:00.000Z' },
      { id: 'c4', date: '2026-11-03', tagId: null, createdAt: '2026-11-03T00:00:00.000Z' },
      { id: 'c5', date: '2026-11-03', tagId: null, createdAt: '2026-11-03T00:00:00.000Z' },
      { id: 'c6', date: '2026-11-03', tagId: null, createdAt: '2026-11-03T00:00:00.000Z' },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: null, sessionType: 'WORK', durationSeconds: 4000, completedAt: '2026-11-01T10:00:00.000Z' },
      { id: 's2', tagId: null, sessionType: 'WORK', durationSeconds: 4500, completedAt: '2026-11-02T10:00:00.000Z' },
      { id: 's3', tagId: null, sessionType: 'WORK', durationSeconds: 2000, completedAt: '2026-11-03T10:00:00.000Z' },
      { id: 's4', tagId: null, sessionType: 'WORK', durationSeconds: 1500, completedAt: '2026-11-04T10:00:00.000Z' },
    ];

    const params = {
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 12000,
      totalCoffeeCups: 6,
    };

    const allInsights = generateAllPeriodInsights(params);
    const sweetSpot = allInsights.find((i) => i.type === 'coffee-sweet-spot');
    expect(sweetSpot).toBeDefined();
    expect(sweetSpot?.tier).toBe(1);
    expect(sweetSpot?.badge).toBe('Caffeine Sweet Spot');

    // Verify generatePeriodInsights only returns 1 insight and always picks from Tier 1
    const firstPick = generatePeriodInsights(params, () => 0.0);
    const lastPick = generatePeriodInsights(params, () => 0.99);

    expect(firstPick).toHaveLength(1);
    expect(lastPick).toHaveLength(1);
    expect(firstPick[0].tier).toBe(1);
    expect(lastPick[0].tier).toBe(1);
    expect(firstPick[0].id).not.toBe(lastPick[0].id);
  });

  it('strictly prioritizes Tier 1 -> Tier 2 -> Tier 3 and picks randomly within the winning tier', () => {
    const tier2A = {
      id: 't2-a',
      type: 'marathon-streak' as const,
      tier: INSIGHT_TIERS['marathon-streak'],
      badge: 'Deep Flow State',
      headline: 'Marathon Flow',
      description: 'Desc',
      iconName: 'flame' as const,
      score: 87,
    };
    const tier2B = {
      id: 't2-b',
      type: 'clean-energy' as const,
      tier: INSIGHT_TIERS['clean-energy'],
      badge: 'Clean Energy',
      headline: 'Clean Energy',
      description: 'Desc',
      iconName: 'sparkles' as const,
      score: 88,
    };
    const tier3A = {
      id: 't3-a',
      type: 'daily-summary' as const,
      tier: INSIGHT_TIERS['daily-summary'],
      badge: 'Day Summary',
      headline: 'Daily Summary',
      description: 'Desc',
      iconName: 'sparkles' as const,
      score: 99,
    };

    // Even though tier3A has score 99, Tier 2 insights must win when no Tier 1 is present
    const pickedFirst = selectTieredInsight([tier3A, tier2A, tier2B], () => 0.1);
    const pickedSecond = selectTieredInsight([tier3A, tier2A, tier2B], () => 0.8);

    expect(pickedFirst?.id).toBe('t2-a');
    expect(pickedSecond?.id).toBe('t2-b');

    // When only Tier 3 is present, picks from Tier 3
    const pickedTier3 = selectTieredInsight([tier3A], () => 0.5);
    expect(pickedTier3?.id).toBe('t3-a');
  });
});

