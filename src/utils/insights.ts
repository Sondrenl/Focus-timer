import { CompletedSession } from '../types/session';
import { CoffeeCup } from '../types/coffee';
import { Tag } from '../types/tag';
import { toDateKey } from './dates';
import { formatDurationHoursMins } from './formatters';

export type InsightType =
  | 'tag-coffee-affinity'
  | 'coffee-productivity-boost'
  | 'coffee-productivity-dip'
  | 'coffee-sweet-spot'
  | 'fuel-efficiency'
  | 'clean-energy'
  | 'time-of-day-focus'
  | 'tag-dominance'
  | 'tag-diversity'
  | 'focus-momentum'
  | 'daily-summary'
  | 'empty-state';

export interface InterestingStat {
  id: string;
  type: InsightType;
  badge: string;
  headline: string;
  description: string;
  iconName: 'coffee' | 'zap' | 'sparkles' | 'target' | 'clock' | 'flame' | 'trending-up' | 'layers';
  score: number; // Higher score = more relevant/interesting
}

interface GenerateInsightsParams {
  sessions: CompletedSession[];
  coffeeCups: CoffeeCup[];
  tags: Tag[];
  periodType: string;
  totalFocusSeconds: number;
  totalCoffeeCups: number;
}

/**
 * Generates an array of ranked, interesting statistics by cross-referencing
 * focus sessions, caffeine intake, tags, and temporal rhythms for the selected period.
 */
export function generatePeriodInsights({
  sessions,
  coffeeCups,
  tags,
  periodType,
  totalFocusSeconds,
  totalCoffeeCups: _totalCoffeeCups,
}: GenerateInsightsParams): InterestingStat[] {
  const insights: InterestingStat[] = [];
  const tagMap = new Map<string, Tag>();
  tags.forEach((t) => tagMap.set(t.id, t));

  const getTagName = (tagId: string | null | undefined): string => {
    if (!tagId) return 'Unassigned';
    return tagMap.get(tagId)?.name || 'Unknown Tag';
  };

  // Group data by date
  const dateFocusMap = new Map<string, { seconds: number; count: number }>();
  const dateCoffeeMap = new Map<string, number>();

  sessions.forEach((s) => {
    if (!s.completedAt) return;
    const key = toDateKey(s.completedAt);
    const curr = dateFocusMap.get(key) || { seconds: 0, count: 0 };
    curr.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
    curr.count += 1;
    dateFocusMap.set(key, curr);
  });

  coffeeCups.forEach((c) => {
    if (!c.date) return;
    dateCoffeeMap.set(c.date, (dateCoffeeMap.get(c.date) || 0) + 1);
  });

  const allActiveDates = Array.from(new Set([...dateFocusMap.keys(), ...dateCoffeeMap.keys()]));

  // -------------------------------------------------------------
  // 1. Tag & Coffee Affinity (Did user drink most coffee during a specific tag?)
  // -------------------------------------------------------------
  if (coffeeCups.length >= 2) {
    const coffeeTagCounts = new Map<string | null, number>();
    coffeeCups.forEach((c) => {
      const tid = c.tagId || null;
      coffeeTagCounts.set(tid, (coffeeTagCounts.get(tid) || 0) + 1);
    });

    let topCoffeeTagId: string | null = null;
    let topCoffeeCount = 0;
    coffeeTagCounts.forEach((count, tid) => {
      if (count > topCoffeeCount) {
        topCoffeeCount = count;
        topCoffeeTagId = tid;
      }
    });

    if (topCoffeeTagId !== null && topCoffeeCount >= 2) {
      const pct = Math.round((topCoffeeCount / coffeeCups.length) * 100);
      const tagName = getTagName(topCoffeeTagId);

      // Check how much focus time was logged on that tag
      const tagFocusSec = sessions
        .filter((s) => (s.tagId || null) === topCoffeeTagId)
        .reduce((acc, s) => acc + (s.durationSeconds > 0 ? s.durationSeconds : 0), 0);

      const focusNote =
        tagFocusSec > 0
          ? ` across ${formatDurationHoursMins(tagFocusSec)} of focused work`
          : '';

      insights.push({
        id: 'tag-coffee-affinity',
        type: 'tag-coffee-affinity',
        badge: 'Caffeine Affinity',
        headline: `${pct}% of coffee was logged for ${tagName}`,
        description: `You drank ${topCoffeeCount} of your ${coffeeCups.length} cups while working on ${tagName}${focusNote}.`,
        iconName: 'coffee',
        score: 95,
      });
    }
  }

  // -------------------------------------------------------------
  // 2. Coffee & Productivity Correlation (Focus time with vs without coffee)
  // -------------------------------------------------------------
  if (allActiveDates.length >= 3 && sessions.length >= 3 && coffeeCups.length >= 2) {
    let coffeeDaysTotalSec = 0;
    let coffeeDaysCount = 0;
    let zeroCoffeeDaysTotalSec = 0;
    let zeroCoffeeDaysCount = 0;

    allActiveDates.forEach((dateKey) => {
      const cups = dateCoffeeMap.get(dateKey) || 0;
      const focus = dateFocusMap.get(dateKey);
      const focusSec = focus ? focus.seconds : 0;

      if (cups > 0 && focusSec > 0) {
        coffeeDaysTotalSec += focusSec;
        coffeeDaysCount += 1;
      } else if (cups === 0 && focusSec > 0) {
        zeroCoffeeDaysTotalSec += focusSec;
        zeroCoffeeDaysCount += 1;
      }
    });

    if (coffeeDaysCount >= 1 && zeroCoffeeDaysCount >= 1) {
      const avgCoffeeDaySec = coffeeDaysTotalSec / coffeeDaysCount;
      const avgZeroCoffeeDaySec = zeroCoffeeDaysTotalSec / zeroCoffeeDaysCount;

      if (avgCoffeeDaySec > 0 && avgZeroCoffeeDaySec > 0) {
        const diffRatio = (avgCoffeeDaySec - avgZeroCoffeeDaySec) / avgZeroCoffeeDaySec;
        const pctDiff = Math.abs(Math.round(diffRatio * 100));

        if (diffRatio >= 0.15 && pctDiff <= 400) {
          insights.push({
            id: 'coffee-productivity-boost',
            type: 'coffee-productivity-boost',
            badge: 'Productivity Correlation',
            headline: `+${pctDiff}% more focus on coffee days`,
            description: `You averaged ${formatDurationHoursMins(Math.round(avgCoffeeDaySec))} of focus on days with coffee, compared to ${formatDurationHoursMins(Math.round(avgZeroCoffeeDaySec))} on zero-coffee days.`,
            iconName: 'trending-up',
            score: 98,
          });
        } else if (diffRatio <= -0.15) {
          insights.push({
            id: 'coffee-productivity-dip',
            type: 'coffee-productivity-dip',
            badge: 'Productivity Pattern',
            headline: `${pctDiff}% higher focus on caffeine-free days`,
            description: `You averaged ${formatDurationHoursMins(Math.round(avgZeroCoffeeDaySec))} on zero-coffee days vs ${formatDurationHoursMins(Math.round(avgCoffeeDaySec))} on coffee days.`,
            iconName: 'zap',
            score: 94,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 3. Coffee Sweet Spot (1-2 cups vs 3+ cups)
  // -------------------------------------------------------------
  if (allActiveDates.length >= 4 && coffeeCups.length >= 4) {
    const bucketModerate: number[] = []; // 1-2 cups
    const bucketHeavy: number[] = [];    // 3+ cups

    allActiveDates.forEach((dateKey) => {
      const cups = dateCoffeeMap.get(dateKey) || 0;
      const focus = dateFocusMap.get(dateKey);
      if (!focus || focus.seconds === 0) return;

      if (cups >= 1 && cups <= 2) {
        bucketModerate.push(focus.seconds);
      } else if (cups >= 3) {
        bucketHeavy.push(focus.seconds);
      }
    });

    if (bucketModerate.length >= 2 && bucketHeavy.length >= 1) {
      const avgMod = bucketModerate.reduce((a, b) => a + b, 0) / bucketModerate.length;
      const avgHeavy = bucketHeavy.reduce((a, b) => a + b, 0) / bucketHeavy.length;

      if (avgMod > avgHeavy * 1.15) {
        insights.push({
          id: 'coffee-sweet-spot',
          type: 'coffee-sweet-spot',
          badge: 'Caffeine Sweet Spot',
          headline: '1–2 cups yielded your highest daily focus',
          description: `Moderate caffeine days averaged ${formatDurationHoursMins(Math.round(avgMod))} of focus, outperforming days with 3+ cups (${formatDurationHoursMins(Math.round(avgHeavy))}).`,
          iconName: 'target',
          score: 91,
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Focus Fuel Efficiency (Ratio of Pomodoros per cup)
  // -------------------------------------------------------------
  if (sessions.length >= 3 && coffeeCups.length >= 1) {
    const ratio = Number((sessions.length / coffeeCups.length).toFixed(1));
    if (ratio >= 1.5) {
      insights.push({
        id: 'fuel-efficiency',
        type: 'fuel-efficiency',
        badge: 'Fuel Efficiency',
        headline: `${ratio} Pomodoros per cup of coffee`,
        description: `You powered through ${sessions.length} focus sessions on ${coffeeCups.length} ${coffeeCups.length === 1 ? 'cup' : 'cups'}, averaging one cup every ${formatDurationHoursMins(Math.round(totalFocusSeconds / coffeeCups.length))}.`,
        iconName: 'zap',
        score: 86,
      });
    }
  }

  // -------------------------------------------------------------
  // 5. Clean Energy (Tag with deep focus and ZERO coffee)
  // -------------------------------------------------------------
  if (coffeeCups.length >= 2) {
    const tagFocusSecondsMap = new Map<string, number>();
    sessions.forEach((s) => {
      if (!s.tagId) return;
      tagFocusSecondsMap.set(s.tagId, (tagFocusSecondsMap.get(s.tagId) || 0) + s.durationSeconds);
    });

    const coffeeTagSet = new Set(coffeeCups.map((c) => c.tagId).filter(Boolean));

    let topCleanTagId: string | null = null;
    let topCleanSeconds = 0;

    tagFocusSecondsMap.forEach((sec, tid) => {
      if (!coffeeTagSet.has(tid) && sec > topCleanSeconds) {
        topCleanSeconds = sec;
        topCleanTagId = tid;
      }
    });

    if (topCleanTagId && topCleanSeconds >= 1800) { // at least 30 minutes
      const tagName = getTagName(topCleanTagId);
      insights.push({
        id: 'clean-energy',
        type: 'clean-energy',
        badge: 'Clean Energy',
        headline: `100% caffeine-free focus on ${tagName}`,
        description: `You logged ${formatDurationHoursMins(topCleanSeconds)} of deep work on ${tagName} without logging a single cup of coffee!`,
        iconName: 'sparkles',
        score: 88,
      });
    }
  }

  // -------------------------------------------------------------
  // 6. Time of Day Rhythm (Morning / Afternoon / Evening / Night)
  // -------------------------------------------------------------
  if (sessions.length >= 3) {
    const timeBuckets = {
      morning: 0,   // 05:00 - 11:59
      afternoon: 0, // 12:00 - 16:59
      evening: 0,   // 17:00 - 21:59
      night: 0,     // 22:00 - 04:59
    };

    sessions.forEach((s) => {
      const h = new Date(s.completedAt).getHours();
      const sec = s.durationSeconds > 0 ? s.durationSeconds : 0;
      if (h >= 5 && h < 12) timeBuckets.morning += sec;
      else if (h >= 12 && h < 17) timeBuckets.afternoon += sec;
      else if (h >= 17 && h < 22) timeBuckets.evening += sec;
      else timeBuckets.night += sec;
    });

    const totalSec = totalFocusSeconds || 1;
    const entries = [
      { name: 'morning', label: 'Morning Dynamo', timeRange: 'before noon (05:00–12:00)', sec: timeBuckets.morning },
      { name: 'afternoon', label: 'Afternoon Focus', timeRange: 'the afternoon (12:00–17:00)', sec: timeBuckets.afternoon },
      { name: 'evening', label: 'Evening Surge', timeRange: 'the evening (17:00–22:00)', sec: timeBuckets.evening },
      { name: 'night', label: 'Night Owl', timeRange: 'late night (22:00–05:00)', sec: timeBuckets.night },
    ];

    entries.sort((a, b) => b.sec - a.sec);
    const top = entries[0];
    const topPct = Math.round((top.sec / totalSec) * 100);

    if (topPct >= 50 && top.sec >= 1800) {
      insights.push({
        id: 'time-of-day-focus',
        type: 'time-of-day-focus',
        badge: 'Focus Rhythm',
        headline: `${top.label}: ${topPct}% of focus ${top.timeRange.startsWith('before') ? top.timeRange : 'in ' + top.timeRange}`,
        description: `You logged ${formatDurationHoursMins(top.sec)} of your focus time during this window.`,
        iconName: 'clock',
        score: 83,
      });
    }
  }

  // -------------------------------------------------------------
  // 7. Tag Dominance (Single tag dominating >= 55% of focus)
  // -------------------------------------------------------------
  if (sessions.length >= 2 && totalFocusSeconds >= 3600) {
    const tagTotals = new Map<string, { sec: number; count: number }>();
    sessions.forEach((s) => {
      const tid = s.tagId || 'unassigned';
      const cur = tagTotals.get(tid) || { sec: 0, count: 0 };
      cur.sec += s.durationSeconds > 0 ? s.durationSeconds : 0;
      cur.count += 1;
      tagTotals.set(tid, cur);
    });

    let topTid = '';
    let topSec = 0;
    let topCount = 0;
    tagTotals.forEach((data, tid) => {
      if (data.sec > topSec) {
        topSec = data.sec;
        topCount = data.count;
        topTid = tid;
      }
    });

    const share = Math.round((topSec / totalFocusSeconds) * 100);
    if (share >= 55) {
      const tagName = getTagName(topTid === 'unassigned' ? null : topTid);
      insights.push({
        id: 'tag-dominance',
        type: 'tag-dominance',
        badge: 'Core Focus',
        headline: `${tagName} dominated ${share}% of focus time`,
        description: `You dedicated ${formatDurationHoursMins(topSec)} across ${topCount} sessions entirely to ${tagName}.`,
        iconName: 'target',
        score: 80,
      });
    }
  }

  // -------------------------------------------------------------
  // 8. Tag Diversity (Balanced focus across 3+ tags)
  // -------------------------------------------------------------
  if (sessions.length >= 4 && totalFocusSeconds >= 3600) {
    const tagTotals = new Map<string, number>();
    sessions.forEach((s) => {
      const tid = s.tagId || 'unassigned';
      tagTotals.set(tid, (tagTotals.get(tid) || 0) + (s.durationSeconds > 0 ? s.durationSeconds : 0));
    });

    const activeTagsCount = tagTotals.size;
    const maxTagSec = Math.max(...Array.from(tagTotals.values()));
    const maxShare = totalFocusSeconds > 0 ? maxTagSec / totalFocusSeconds : 0;

    if (activeTagsCount >= 3 && maxShare <= 0.45) {
      insights.push({
        id: 'tag-diversity',
        type: 'tag-diversity',
        badge: 'Balanced Workflow',
        headline: `Evenly balanced across ${activeTagsCount} different tags`,
        description: `No single tag took more than ${Math.round(maxShare * 100)}% of your time, maintaining healthy task variety.`,
        iconName: 'layers',
        score: 78,
      });
    }
  }

  // -------------------------------------------------------------
  // 9. Focus Momentum (High session velocity)
  // -------------------------------------------------------------
  const activeFocusDays = Array.from(dateFocusMap.keys()).length;
  if (activeFocusDays >= 2 && sessions.length >= 4) {
    const avgSessionsPerDay = (sessions.length / activeFocusDays).toFixed(1);
    const avgSecPerDay = Math.round(totalFocusSeconds / activeFocusDays);

    insights.push({
      id: 'focus-momentum',
      type: 'focus-momentum',
      badge: 'Focus Momentum',
      headline: `Averaging ${avgSessionsPerDay} Pomodoros per active day`,
      description: `Across ${activeFocusDays} active days, you achieved ${formatDurationHoursMins(avgSecPerDay)} of focused work per day.`,
      iconName: 'flame',
      score: 76,
    });
  }

  // -------------------------------------------------------------
  // 10. Daily Summary (For single day view)
  // -------------------------------------------------------------
  if (periodType === 'day' && (sessions.length > 0 || coffeeCups.length > 0)) {
    if (sessions.length > 0 && coffeeCups.length > 0) {
      insights.push({
        id: 'daily-summary',
        type: 'daily-summary',
        badge: 'Day Summary',
        headline: `${sessions.length} Pomodoros fueled by ${coffeeCups.length} ${coffeeCups.length === 1 ? 'cup' : 'cups'} of coffee`,
        description: `You logged ${formatDurationHoursMins(totalFocusSeconds)} of deep work today. Great rhythm!`,
        iconName: 'sparkles',
        score: 99, // Priority for single day
      });
    } else if (sessions.length > 0) {
      insights.push({
        id: 'daily-summary',
        type: 'daily-summary',
        badge: 'Day Summary',
        headline: `${sessions.length} Pomodoros completed (${formatDurationHoursMins(totalFocusSeconds)} focus)`,
        description: 'Solid progress logged today without any coffee. Keep the momentum going!',
        iconName: 'sparkles',
        score: 99,
      });
    } else if (coffeeCups.length > 0) {
      insights.push({
        id: 'daily-summary',
        type: 'daily-summary',
        badge: 'Day Summary',
        headline: `${coffeeCups.length} ${coffeeCups.length === 1 ? 'cup' : 'cups'} of coffee logged today`,
        description: 'Ready to channel that caffeine into your first Pomodoro session of the day?',
        iconName: 'coffee',
        score: 99,
      });
    }
  }

  // -------------------------------------------------------------
  // 11. Fallback / Empty State
  // -------------------------------------------------------------
  if (insights.length === 0) {
    if (sessions.length === 0 && coffeeCups.length === 0) {
      insights.push({
        id: 'empty-state',
        type: 'empty-state',
        badge: 'Smart Insights',
        headline: 'No activity logged for this period',
        description: 'Complete a session or log a cup of coffee to see insights.',
        iconName: 'sparkles',
        score: 10,
      });
    } else if (sessions.length > 0) {
      insights.push({
        id: 'first-session-streak',
        type: 'focus-momentum',
        badge: 'Focus Progress',
        headline: `${sessions.length} Pomodoro ${sessions.length === 1 ? 'session' : 'sessions'} logged`,
        description: `Total focus time of ${formatDurationHoursMins(totalFocusSeconds)} in this time period.`,
        iconName: 'sparkles',
        score: 50,
      });
    } else if (coffeeCups.length > 0) {
      insights.push({
        id: 'first-coffee-cups',
        type: 'daily-summary',
        badge: 'Coffee Tracker',
        headline: `${coffeeCups.length} ${coffeeCups.length === 1 ? 'cup' : 'cups'} of coffee logged`,
        description: 'Pair your coffee breaks with focused Pomodoro intervals to unlock correlation insights!',
        iconName: 'coffee',
        score: 50,
      });
    }
  }

  // Sort insights by score descending
  return insights.sort((a, b) => b.score - a.score);
}
