import { describe, it, expect } from 'vitest';
import {
  generateAllPeriodInsights,
  selectTieredInsight,
  INSIGHT_TIERS,
} from '../src/utils/insights';
import { CompletedSession } from '../src/types/session';
import { CoffeeCup } from '../src/types/coffee';
import { Tag } from '../src/types/tag';

function localIso(
  year: number,
  month1Based: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0
): string {
  return new Date(year, month1Based - 1, day, hour, minute, second).toISOString();
}

const testTags: Tag[] = [
  {
    id: 'tag-code',
    name: 'Coding',
    color: '#3B82F6',
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'tag-write',
    name: 'Writing',
    color: '#10B981',
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'tag-admin',
    name: 'Admin',
    color: '#F59E0B',
    isArchived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
];

describe('generateAllPeriodInsights & tiered insight selection', () => {
  it('returns empty state (Tier 3) when no sessions and no coffee cups exist', () => {
    const allInsights = generateAllPeriodInsights({
      sessions: [],
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 0,
    });
    const insight = selectTieredInsight(allInsights);

    expect(allInsights).toHaveLength(1);
    expect(insight).not.toBeNull();
    expect(insight!.type).toBe('empty-state');
    expect(insight!.tier).toBe(3);
    expect(insight!.headline).toContain('No activity logged');
    expect(insight!.description).toBe('Complete a session or log a cup of coffee to view insights');
  });

  it('generates a daily summary (Tier 3) for day view when no higher-tier insights apply', () => {
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: localIso(2026, 11, 3, 10, 30),
      },
    ];
    const coffee: CoffeeCup[] = [
      {
        id: 'c1',
        date: '2026-11-03',
        tagId: 'tag-code',
        createdAt: localIso(2026, 11, 3, 9, 0),
      },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'day',
      totalFocusSeconds: 1500,
    });
    const insight = selectTieredInsight(allInsights);

    expect(allInsights).toHaveLength(1);
    expect(insight).not.toBeNull();
    expect(insight!.type).toBe('daily-summary');
    expect(insight!.tier).toBe(3);
    expect(insight!.headline).toContain('1 Pomodoro');
    expect(insight!.headline).toContain('1 cup');
  });

  it('detects precision peak focus window (Tier 1)', () => {
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 3, 9, 30),
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 3, 10, 15),
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 3, 11, 0),
      },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 5400,
    });
    const insight = selectTieredInsight(allInsights);

    expect(insight).not.toBeNull();
    expect(insight!.type).toBe('peak-focus-window');
    expect(insight!.tier).toBe(1);
    expect(insight!.badge).toBe('Peak Flow Window');
    expect(insight!.headline).toContain('Your peak focus window is');
  });

  it('detects precision peak focus window wrapping across midnight (Tier 1)', () => {
    const sessions: CompletedSession[] = [
      {
        id: 's1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 3, 23, 30), // 23:00-23:30
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 4, 0, 15), // 23:45-00:15 (crosses midnight)
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 4, 1, 30), // 01:00-01:30
      },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 5400,
    });

    const peak = allInsights.find((i) => i.type === 'peak-focus-window');
    expect(peak).toBeDefined();
    expect(peak!.tier).toBe(1);
    expect(peak!.headline).toContain('23:00–01:30');
    expect(peak!.description).toContain('100%');
  });

  it('detects tag-coffee affinity (Tier 1) using day and tag correlations', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: 'tag-code', createdAt: localIso(2026, 11, 1, 9, 0) },
      { id: 'c2', date: '2026-11-02', tagId: 'tag-code', createdAt: localIso(2026, 11, 2, 9, 0) },
      { id: 'c3', date: '2026-11-03', tagId: 'tag-write', createdAt: localIso(2026, 11, 3, 9, 0) },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 3600, completedAt: localIso(2026, 11, 1, 10, 0) },
      { id: 's2', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 3600, completedAt: localIso(2026, 11, 2, 10, 0) },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 7200,
    });
    const insight = selectTieredInsight(allInsights);

    expect(insight).not.toBeNull();
    expect(insight!.type).toBe('tag-coffee-affinity');
    expect(insight!.tier).toBe(1);
    expect(insight!.badge).toBe('Caffeine Affinity');
    expect(insight!.headline).toContain('% of coffee was logged for Coding');
  });

  it('detects daily coffee ritual (Tier 3) when logged on majority of active focus days', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: localIso(2026, 11, 1, 9, 0) },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: localIso(2026, 11, 2, 9, 0) },
      { id: 'c3', date: '2026-11-03', tagId: null, createdAt: localIso(2026, 11, 3, 9, 0) },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 1, 10, 0) },
      { id: 's2', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 2, 10, 0) },
      { id: 's3', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 3, 10, 0) },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 4500,
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
        completedAt: localIso(2026, 11, 1, 9, 25),
      },
      {
        id: 'd1-s2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1200,
        completedAt: localIso(2026, 11, 1, 9, 47),
      },
      {
        id: 'd1-s3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 800,
        completedAt: localIso(2026, 11, 1, 10, 2),
      },

      // Day 2: balanced with breaks
      {
        id: 'd2-s1',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 2, 9, 30),
      },
      {
        id: 'd2-b1',
        tagId: null,
        sessionType: 'SHORT_BREAK',
        durationSeconds: 300,
        completedAt: localIso(2026, 11, 2, 9, 35),
      },
      {
        id: 'd2-s2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 2, 10, 5),
      },
      {
        id: 'd2-b2',
        tagId: null,
        sessionType: 'LONG_BREAK',
        durationSeconds: 900,
        completedAt: localIso(2026, 11, 2, 10, 20),
      },
      {
        id: 'd2-s3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 2, 10, 50),
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
        completedAt: localIso(2026, 11, 2, 10, 0), // Monday
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 3600,
        completedAt: localIso(2026, 11, 3, 10, 0), // Tuesday
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 3600,
        completedAt: localIso(2026, 11, 3, 15, 0), // Tuesday (total 7200s)
      },
      {
        id: 's4',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: localIso(2026, 11, 4, 10, 0), // Wednesday
      },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 13800,
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
        completedAt: localIso(2026, 11, 1, 10, 0),
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400,
        completedAt: localIso(2026, 11, 2, 10, 0),
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 14400,
        completedAt: localIso(2026, 11, 3, 10, 0),
      },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 43200,
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
        completedAt: localIso(2026, 11, 1, 9, 0),
      },
      {
        id: 's2',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 3600,
        completedAt: localIso(2026, 11, 1, 14, 0),
      },
      {
        id: 's3',
        tagId: 'tag-code',
        sessionType: 'WORK',
        durationSeconds: 1000,
        completedAt: localIso(2026, 11, 2, 9, 0),
      },
      {
        id: 's4',
        tagId: 'tag-write',
        sessionType: 'WORK',
        durationSeconds: 1000,
        completedAt: localIso(2026, 11, 2, 11, 0),
      },
      {
        id: 's5',
        tagId: 'tag-admin',
        sessionType: 'WORK',
        durationSeconds: 1000,
        completedAt: localIso(2026, 11, 2, 14, 0),
      },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 10200,
    });

    const deepDive = allInsights.find((i) => i.type === 'context-switching');
    expect(deepDive).toBeDefined();
    expect(deepDive?.tier).toBe(1);
    expect(deepDive?.badge).toBe('Deep Dive Mode');
    expect(deepDive?.headline).toContain('Deep Dive Mode: +');
  });

  it('detects coffee productivity boost (Tier 1) on coffee days vs zero-coffee days', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: localIso(2026, 11, 1, 9, 0) },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: localIso(2026, 11, 2, 9, 0) },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: null, sessionType: 'WORK', durationSeconds: 3600, completedAt: localIso(2026, 11, 1, 10, 0) },
      { id: 's2', tagId: null, sessionType: 'WORK', durationSeconds: 3600, completedAt: localIso(2026, 11, 2, 10, 0) },
      { id: 's3', tagId: null, sessionType: 'WORK', durationSeconds: 1200, completedAt: localIso(2026, 11, 3, 10, 0) },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 8400,
    });

    const boost = allInsights.find((i) => i.type === 'coffee-productivity-boost');
    expect(boost).toBeDefined();
    expect(boost?.tier).toBe(1);
    expect(boost?.badge).toBe('Productivity Correlation');
    expect(boost?.headline).toContain('more focus on coffee days');
  });

  it('detects coffee sweet spot (Tier 1) and selects randomly among available Tier 1 insights', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: localIso(2026, 11, 1, 9, 0) },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: localIso(2026, 11, 2, 9, 0) },
      { id: 'c3', date: '2026-11-02', tagId: null, createdAt: localIso(2026, 11, 2, 11, 0) },
      { id: 'c4', date: '2026-11-03', tagId: null, createdAt: localIso(2026, 11, 3, 9, 0) },
      { id: 'c5', date: '2026-11-03', tagId: null, createdAt: localIso(2026, 11, 3, 11, 0) },
      { id: 'c6', date: '2026-11-03', tagId: null, createdAt: localIso(2026, 11, 3, 14, 0) },
    ];

    const sessions: CompletedSession[] = [
      { id: 's1', tagId: null, sessionType: 'WORK', durationSeconds: 4000, completedAt: localIso(2026, 11, 1, 10, 0) },
      { id: 's2', tagId: null, sessionType: 'WORK', durationSeconds: 4500, completedAt: localIso(2026, 11, 2, 10, 0) },
      { id: 's3', tagId: null, sessionType: 'WORK', durationSeconds: 2000, completedAt: localIso(2026, 11, 3, 10, 0) },
      { id: 's4', tagId: null, sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 4, 10, 0) },
    ];

    const params = {
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 12000,
    };

    const allInsights = generateAllPeriodInsights(params);
    const sweetSpot = allInsights.find((i) => i.type === 'coffee-sweet-spot');
    expect(sweetSpot).toBeDefined();
    expect(sweetSpot?.tier).toBe(1);
    expect(sweetSpot?.badge).toBe('Caffeine Sweet Spot');

    // Verify selectTieredInsight picks a single Tier 1 insight when Tier 1 insights exist
    const firstPick = selectTieredInsight(allInsights, () => 0.0);
    const lastPick = selectTieredInsight(allInsights, () => 0.99);

    expect(firstPick).not.toBeNull();
    expect(lastPick).not.toBeNull();
    expect(firstPick!.tier).toBe(1);
    expect(lastPick!.tier).toBe(1);
    expect(firstPick!.id).not.toBe(lastPick!.id);
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

  it('does not trigger focus-streak from coffee-only days', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: localIso(2026, 11, 1, 9, 0) },
      { id: 'c2', date: '2026-11-02', tagId: null, createdAt: localIso(2026, 11, 2, 9, 0) },
      { id: 'c3', date: '2026-11-03', tagId: null, createdAt: localIso(2026, 11, 3, 9, 0) },
    ];
    const sessions: CompletedSession[] = [
      { id: 's1', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 1, 10, 0) },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 1500,
    });

    expect(allInsights.find((i) => i.type === 'focus-streak')).toBeUndefined();
  });

  it('does not trigger break-fatigue when comparison days had zero breaks', () => {
    const sessions: CompletedSession[] = [
      // Day 1: 3 unbroken sessions (total 3000s)
      { id: 's1', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1000, completedAt: localIso(2026, 11, 1, 9, 0) },
      { id: 's2', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1000, completedAt: localIso(2026, 11, 1, 9, 30) },
      { id: 's3', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 1000, completedAt: localIso(2026, 11, 1, 10, 0) },
      // Day 2: 2 sessions, NO breaks (total 5000s)
      { id: 's4', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 2500, completedAt: localIso(2026, 11, 2, 9, 0) },
      { id: 's5', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 2500, completedAt: localIso(2026, 11, 2, 14, 0) },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      allSessions: sessions,
      coffeeCups: [],
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 8000,
    });

    expect(allInsights.find((i) => i.type === 'break-fatigue')).toBeUndefined();
  });

  it('does not claim clean-energy when untagged coffee was logged on the same work day', () => {
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: null, createdAt: localIso(2026, 11, 1, 9, 0) },
      { id: 'c2', date: '2026-11-01', tagId: null, createdAt: localIso(2026, 11, 1, 11, 0) },
    ];
    const sessions: CompletedSession[] = [
      { id: 's1', tagId: 'tag-code', sessionType: 'WORK', durationSeconds: 3600, completedAt: localIso(2026, 11, 1, 10, 0) },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 3600,
    });

    expect(allInsights.find((i) => i.type === 'clean-energy')).toBeUndefined();
  });

  it('normalizes deleted/unknown tagIds and does not generate Unknown Tag or Unassigned tag dominance insights', () => {
    const sessions: CompletedSession[] = [
      { id: 's1', tagId: 'deleted-tag-id', sessionType: 'WORK', durationSeconds: 2400, completedAt: localIso(2026, 11, 1, 9, 0) },
      { id: 's2', tagId: 'deleted-tag-id', sessionType: 'WORK', durationSeconds: 2400, completedAt: localIso(2026, 11, 2, 10, 0) },
      { id: 's3', tagId: null, sessionType: 'WORK', durationSeconds: 2400, completedAt: localIso(2026, 11, 3, 11, 0) },
    ];
    const coffee: CoffeeCup[] = [
      { id: 'c1', date: '2026-11-01', tagId: 'deleted-tag-id', createdAt: localIso(2026, 11, 1, 9, 0) },
      { id: 'c2', date: '2026-11-02', tagId: 'deleted-tag-id', createdAt: localIso(2026, 11, 2, 10, 0) },
    ];

    const allInsights = generateAllPeriodInsights({
      sessions,
      coffeeCups: coffee,
      tags: testTags,
      periodType: 'week',
      totalFocusSeconds: 7200,
    });

    expect(allInsights.find((i) => i.type === 'tag-dominance')).toBeUndefined();
    expect(allInsights.find((i) => i.type === 'tag-coffee-affinity')).toBeUndefined();
    expect(allInsights.find((i) => i.type === 'clean-energy')).toBeUndefined();
    allInsights.forEach((insight) => {
      expect(insight.headline).not.toContain('Unknown Tag');
      expect(insight.description).not.toContain('Unknown Tag');
    });
  });
});
