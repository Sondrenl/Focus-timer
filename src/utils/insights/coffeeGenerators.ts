import { toDateKey } from '../dates';
import { formatDurationHoursMins } from '../formatters';
import { InsightContext, RawInsight } from './types';

/**
 * Generates caffeine habit and coffee-focus synergy insights (Categories 6–11):
 * 6. Tag & Coffee Affinity (Tagged Coffee)
 * 7. Coffee vs. Zero-Coffee Days (Daily Focus Comparison)
 * 8. Coffee Sweet Spot (1–2 cups/day vs 3+ cups/day)
 * 9. Daily Coffee Ritual (Presence across active focus days)
 * 10. Focus Fuel Efficiency (Ratio of Pomodoros per cup)
 * 11. Clean Energy (Tag with deep focus and ZERO coffee)
 */
export function generateCoffeeInsights(
  ctx: InsightContext,
  insights: { push: (stat: RawInsight) => void }
): void {
  const {
    sessions,
    coffeeCups,
    totalFocusSeconds,
    dateFocusMap,
    dateCoffeeMap,
    activeFocusDates,
    allActiveDates,
    activeFocusDays,
    resolveValidTagId,
    getTagName,
  } = ctx;

  // -------------------------------------------------------------
  // 6. Tag & Coffee Affinity (Tagged Coffee)
  // Which project/tag receives the highest share of logged coffee?
  // -------------------------------------------------------------
  if (coffeeCups.length >= 2) {
    const coffeeTagCounts = new Map<string, number>();
    coffeeCups.forEach((c) => {
      const validTid = resolveValidTagId(c.tagId);
      if (!validTid) return;
      coffeeTagCounts.set(validTid, (coffeeTagCounts.get(validTid) || 0) + 1);
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
      if (pct >= 35) {
        const tagName = getTagName(topCoffeeTagId);

        const tagFocusSec = sessions
          .filter((s) => resolveValidTagId(s.tagId) === topCoffeeTagId)
          .reduce((acc, s) => acc + (s.durationSeconds > 0 ? s.durationSeconds : 0), 0);

        const focusNote =
          tagFocusSec > 0 ? ` across ${formatDurationHoursMins(tagFocusSec)} of focused work` : '';

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
  }

  // -------------------------------------------------------------
  // 7. Coffee vs. Zero-Coffee Days (Daily Focus Comparison)
  // Compares total focus time on days with coffee vs zero-coffee days.
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
        if (avgCoffeeDaySec >= avgZeroCoffeeDaySec * 1.15) {
          const boostPct = Math.round(
            ((avgCoffeeDaySec - avgZeroCoffeeDaySec) / avgZeroCoffeeDaySec) * 100
          );
          if (boostPct <= 400) {
            insights.push({
              id: 'coffee-productivity-boost',
              type: 'coffee-productivity-boost',
              badge: 'Productivity Correlation',
              headline: `+${boostPct}% more focus on coffee days`,
              description: `You averaged ${formatDurationHoursMins(Math.round(avgCoffeeDaySec))} of focus on days with coffee, compared to ${formatDurationHoursMins(Math.round(avgZeroCoffeeDaySec))} on zero-coffee days.`,
              iconName: 'trending-up',
              score: 96,
            });
          }
        } else if (avgZeroCoffeeDaySec >= avgCoffeeDaySec * 1.15) {
          const dipPct = Math.round(
            ((avgZeroCoffeeDaySec - avgCoffeeDaySec) / avgCoffeeDaySec) * 100
          );
          if (dipPct <= 400) {
            insights.push({
              id: 'coffee-productivity-dip',
              type: 'coffee-productivity-dip',
              badge: 'Productivity Pattern',
              headline: `${dipPct}% higher focus on caffeine-free days`,
              description: `You averaged ${formatDurationHoursMins(Math.round(avgZeroCoffeeDaySec))} on zero-coffee days vs ${formatDurationHoursMins(Math.round(avgCoffeeDaySec))} on coffee days.`,
              iconName: 'zap',
              score: 94,
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 8. Coffee Sweet Spot (1–2 cups/day vs 3+ cups/day)
  // Evaluates daily coffee count tiers against daily focus output.
  // -------------------------------------------------------------
  if (allActiveDates.length >= 4 && coffeeCups.length >= 4) {
    const bucketModerate: number[] = []; // 1-2 cups
    const bucketHeavy: number[] = []; // 3+ cups

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
          score: 95,
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 9. Daily Coffee Ritual (Presence across active focus days)
  // -------------------------------------------------------------
  if (activeFocusDays >= 3 && coffeeCups.length >= 2) {
    let coffeeFocusDaysCount = 0;
    activeFocusDates.forEach((dateKey) => {
      if ((dateCoffeeMap.get(dateKey) || 0) > 0) {
        coffeeFocusDaysCount += 1;
      }
    });

    const ritualRate = coffeeFocusDaysCount / activeFocusDays;
    if (ritualRate >= 0.7) {
      const pct = Math.round(ritualRate * 100);
      insights.push({
        id: 'coffee-ritual',
        type: 'coffee-ritual',
        badge: 'Daily Ritual',
        headline: `Coffee Ritual: Logged on ${pct}% of focus days`,
        description: `Caffeine is a steady companion in your routine, present on ${coffeeFocusDaysCount} of your ${activeFocusDays} active deep work days.`,
        iconName: 'coffee',
        score: 91,
      });
    }
  }

  // -------------------------------------------------------------
  // 10. Focus Fuel Efficiency (Ratio of Pomodoros per cup)
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
  // 11. Clean Energy (Tag with deep focus and ZERO coffee)
  // -------------------------------------------------------------
  if (coffeeCups.length >= 2) {
    const tagFocusSecondsMap = new Map<string, number>();
    const tagDatesMap = new Map<string, Set<string>>();
    sessions.forEach((s) => {
      const validTid = resolveValidTagId(s.tagId);
      if (!validTid || !s.completedAt || s.durationSeconds <= 0) return;
      tagFocusSecondsMap.set(validTid, (tagFocusSecondsMap.get(validTid) || 0) + s.durationSeconds);
      const dates = tagDatesMap.get(validTid) || new Set<string>();
      dates.add(toDateKey(s.completedAt));
      tagDatesMap.set(validTid, dates);
    });

    const coffeeTagSet = new Set(
      coffeeCups.map((c) => resolveValidTagId(c.tagId)).filter((tid): tid is string => Boolean(tid))
    );
    const untaggedCoffeeDates = new Set(
      coffeeCups.filter((c) => !resolveValidTagId(c.tagId) && c.date).map((c) => c.date)
    );

    let topCleanTagId: string | null = null;
    let topCleanSeconds = 0;

    tagFocusSecondsMap.forEach((sec, tid) => {
      if (coffeeTagSet.has(tid)) return;
      const datesWorked = tagDatesMap.get(tid);
      const hadUntaggedCoffeeOnWorkDay =
        datesWorked && Array.from(datesWorked).some((d) => untaggedCoffeeDates.has(d));
      if (hadUntaggedCoffeeOnWorkDay) return;

      if (sec > topCleanSeconds) {
        topCleanSeconds = sec;
        topCleanTagId = tid;
      }
    });

    if (topCleanTagId && topCleanSeconds >= 1800) {
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
}
