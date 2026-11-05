import { CompletedSession } from '../types/session';
import { CoffeeCup } from '../types/coffee';
import { Tag } from '../types/tag';
import { toDateKey, WEEKDAY_NAMES } from './dates';
import { formatDurationHoursMins } from './formatters';

export type InsightType =
  | 'peak-focus-window'
  | 'break-fatigue'
  | 'break-cadence'
  | 'marathon-streak'
  | 'powerhouse-day'
  | 'weekend-focus'
  | 'workweek-boundaries'
  | 'focus-streak'
  | 'milestone'
  | 'context-switching'
  | 'tag-coffee-affinity'
  | 'coffee-productivity-boost'
  | 'coffee-productivity-dip'
  | 'coffee-sweet-spot'
  | 'coffee-ritual'
  | 'fuel-efficiency'
  | 'clean-energy'
  | 'tag-dominance'
  | 'tag-diversity'
  | 'focus-momentum'
  | 'daily-summary'
  | 'empty-state';

export type InsightTier = 1 | 2 | 3;

export const INSIGHT_TIERS: Record<InsightType, InsightTier> = {
  // Tier 1: Deep Correlations & Behavioral Discoveries (Most Interesting)
  'peak-focus-window': 1,
  'break-fatigue': 1,
  'context-switching': 1,
  'coffee-sweet-spot': 1,
  'coffee-productivity-boost': 1,
  'coffee-productivity-dip': 1,
  'tag-coffee-affinity': 1,

  // Tier 2: Rhythms, Habits & Stamina Patterns (Moderately Interesting)
  'marathon-streak': 2,
  'clean-energy': 2,
  'powerhouse-day': 2,
  'weekend-focus': 2,
  'workweek-boundaries': 2,
  'break-cadence': 2,
  'focus-streak': 2,
  'tag-diversity': 2,

  // Tier 3: Descriptive Summaries, Ratios & Fallbacks (Least Interesting)
  'tag-dominance': 3,
  'coffee-ritual': 3,
  'fuel-efficiency': 3,
  'focus-momentum': 3,
  'milestone': 3,
  'daily-summary': 3,
  'empty-state': 3,
};

export interface InterestingStat {
  id: string;
  type: InsightType;
  tier: InsightTier;
  badge: string;
  headline: string;
  description: string;
  iconName:
    | 'coffee'
    | 'zap'
    | 'sparkles'
    | 'target'
    | 'clock'
    | 'flame'
    | 'trending-up'
    | 'layers'
    | 'calendar'
    | 'award'
    | 'battery-charging';
  score: number; // Higher score = more relevant/interesting within a tier
}

export interface GenerateInsightsParams {
  sessions: CompletedSession[];
  coffeeCups: CoffeeCup[];
  tags: Tag[];
  periodType: string;
  totalFocusSeconds: number;
  totalCoffeeCups: number;
  allSessions?: CompletedSession[];
}

/**
 * Selects a single insight based on tier priority (Tier 1 -> Tier 2 -> Tier 3).
 * When multiple insights are available in the highest available tier, picks one at random.
 */
export function selectTieredInsight(
  insights: InterestingStat[],
  randomFn: () => number = Math.random
): InterestingStat | null {
  if (!insights || insights.length === 0) return null;

  for (const tier of [1, 2, 3] as const) {
    const tierInsights = insights.filter((i) => i.tier === tier);
    if (tierInsights.length > 0) {
      const randomIndex = Math.min(
        tierInsights.length - 1,
        Math.max(0, Math.floor(randomFn() * tierInsights.length))
      );
      return tierInsights[randomIndex];
    }
  }

  return insights[0];
}

/**
 * Generates all matching candidate insights for the selected period, annotated with their tier.
 * NOTE: Coffee intake is strictly tracked by day and tag (no intraday timestamp data is used).
 */
export function generateAllPeriodInsights({
  sessions,
  coffeeCups,
  tags,
  periodType,
  totalFocusSeconds,
  totalCoffeeCups: _totalCoffeeCups,
  allSessions,
}: GenerateInsightsParams): InterestingStat[] {
  const rawInsights: Omit<InterestingStat, 'tier'>[] = [];
  const insights = {
    push: (stat: Omit<InterestingStat, 'tier'>) => {
      rawInsights.push(stat);
    },
    get length() {
      return rawInsights.length;
    },
  };
  const tagMap = new Map<string, Tag>();
  tags.forEach((t) => tagMap.set(t.id, t));

  const resolveValidTagId = (tagId: string | null | undefined): string | null => {
    if (!tagId) return null;
    return tagMap.has(tagId) ? tagId : null;
  };

  const getTagName = (tagId: string | null | undefined): string => {
    const validId = resolveValidTagId(tagId);
    if (!validId) return 'Unassigned';
    return tagMap.get(validId)!.name;
  };

  // Group data strictly by date (YYYY-MM-DD)
  const dateFocusMap = new Map<string, { seconds: number; count: number }>();
  const dateCoffeeMap = new Map<string, number>();

  sessions.forEach((s) => {
    if (!s.completedAt) return;
    const d = new Date(s.completedAt);
    if (isNaN(d.getTime())) return;
    const dur = s.durationSeconds > 0 ? s.durationSeconds : 0;
    if (dur <= 0) return;
    const key = toDateKey(s.completedAt);
    const curr = dateFocusMap.get(key) || { seconds: 0, count: 0 };
    curr.seconds += dur;
    curr.count += 1;
    dateFocusMap.set(key, curr);
  });

  coffeeCups.forEach((c) => {
    if (!c.date) return;
    dateCoffeeMap.set(c.date, (dateCoffeeMap.get(c.date) || 0) + 1);
  });

  const activeFocusDates = Array.from(dateFocusMap.keys()).sort();
  const allActiveDates = Array.from(new Set([...activeFocusDates, ...dateCoffeeMap.keys()])).sort();
  const activeFocusDays = activeFocusDates.length;

  // -------------------------------------------------------------
  // 1. Precision Peak Focus Window (Golden Hours)
  // Evaluates focus session timestamps using a sliding 2.5-hour
  // window to pinpoint exact flow state hours (e.g. 09:00–11:30).
  // -------------------------------------------------------------
  if (sessions.length >= 3 && totalFocusSeconds >= 3600) {
    const slotSeconds = new Array(48).fill(0);

    sessions.forEach((s) => {
      const d = new Date(s.completedAt);
      if (isNaN(d.getTime())) return;
      const durSec = Math.min(86400, Math.max(0, s.durationSeconds));
      if (durSec <= 0) return;

      const endSec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      const startSec = Math.max(0, endSec - durSec);

      for (let k = 0; k < 48; k++) {
        const slotStart = k * 1800;
        const slotEnd = (k + 1) * 1800;
        const overlapStart = Math.max(startSec, slotStart);
        const overlapEnd = Math.min(endSec, slotEnd);
        if (overlapEnd > overlapStart) {
          slotSeconds[k] += overlapEnd - overlapStart;
        }
      }
    });

    // 5 slots = 2.5 hours sliding window
    let bestSlot = -1;
    let maxWindowSec = 0;
    for (let k = 0; k <= 43; k++) {
      let winSec = 0;
      for (let j = 0; j < 5; j++) {
        winSec += slotSeconds[k + j];
      }
      if (winSec > maxWindowSec) {
        maxWindowSec = winSec;
        bestSlot = k;
      }
    }

    if (bestSlot >= 0 && maxWindowSec >= 1800) {
      const clampedWindowSec = Math.min(totalFocusSeconds, Math.round(maxWindowSec));
      const pct = Math.min(100, Math.round((clampedWindowSec / totalFocusSeconds) * 100));
      if (pct >= 28) {
        const startH = Math.floor(bestSlot / 2);
        const startM = (bestSlot % 2) * 30;
        const endSlot = bestSlot + 5;
        const endH = Math.floor(endSlot / 2);
        const endM = (endSlot % 2) * 30;
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timeWindowStr = `${pad(startH)}:${pad(startM)}–${pad(endH)}:${pad(endM)}`;

        insights.push({
          id: 'peak-focus-window',
          type: 'peak-focus-window',
          badge: 'Peak Flow Window',
          headline: `Your peak focus window is ${timeWindowStr}`,
          description: `You concentrated ${formatDurationHoursMins(clampedWindowSec)} (${pct}% of your deep work) during this golden window. Best reserved for your highest-priority tasks.`,
          iconName: 'target',
          score: 97,
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 2. Break Cadence & Fatigue Detection
  // Analyzes session sequences, fatigue after 3+ consecutive sessions without breaks,
  // and marathon flow states.
  // -------------------------------------------------------------
  const sessionPool = allSessions && allSessions.length > 0 ? allSessions : sessions;
  if (sessions.length >= 3) {
    // Group all sessions by date key
    const sessionsByDate = new Map<string, CompletedSession[]>();
    sessionPool.forEach((s) => {
      if (!s.completedAt) return;
      const key = toDateKey(s.completedAt);
      const list = sessionsByDate.get(key) || [];
      list.push(s);
      sessionsByDate.set(key, list);
    });

    let consecutiveUnbrokenWorkDays = 0;
    let brokenWorkDays = 0;
    let unbrokenFocusSecTotal = 0;
    let brokenFocusSecTotal = 0;
    let maxConsecutiveWorkStreak = 0;
    let maxStreakSeconds = 0;

    sessionsByDate.forEach((daySessions) => {
      daySessions.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());

      let currentStreak = 0;
      let currentStreakSec = 0;
      let dayHadLongUnbrokenStreak = false;
      let dayHadBreak = false;
      let dayWorkCount = 0;
      let dayFocusSec = 0;

      for (let i = 0; i < daySessions.length; i++) {
        const s = daySessions[i];
        if (s.sessionType === 'WORK') {
          const dur = s.durationSeconds > 0 ? s.durationSeconds : 0;
          dayFocusSec += dur;
          dayWorkCount += 1;
          currentStreak += 1;
          currentStreakSec += dur;

          if (currentStreak > maxConsecutiveWorkStreak) {
            maxConsecutiveWorkStreak = currentStreak;
            maxStreakSeconds = currentStreakSec;
          } else if (
            currentStreak === maxConsecutiveWorkStreak &&
            currentStreakSec > maxStreakSeconds
          ) {
            maxStreakSeconds = currentStreakSec;
          }

          if (currentStreak >= 3) {
            dayHadLongUnbrokenStreak = true;
          }
        } else {
          // Break logged (SHORT_BREAK or LONG_BREAK)
          dayHadBreak = true;
          currentStreak = 0;
          currentStreakSec = 0;
        }
      }

      if (dayHadLongUnbrokenStreak) {
        consecutiveUnbrokenWorkDays += 1;
        unbrokenFocusSecTotal += dayFocusSec;
      } else if (dayFocusSec > 0 && dayHadBreak && dayWorkCount >= 2) {
        brokenWorkDays += 1;
        brokenFocusSecTotal += dayFocusSec;
      }
    });

    // Case A: Detect fatigue pattern when users stack 3+ sessions without breaks
    if (consecutiveUnbrokenWorkDays >= 1 && brokenWorkDays >= 1) {
      const avgUnbroken = unbrokenFocusSecTotal / consecutiveUnbrokenWorkDays;
      const avgBroken = brokenFocusSecTotal / brokenWorkDays;

      if (avgBroken > avgUnbroken * 1.15) {
        const pctBoost = Math.round(((avgBroken - avgUnbroken) / avgUnbroken) * 100);
        insights.push({
          id: 'break-fatigue',
          type: 'break-fatigue',
          badge: 'Pacing Alert',
          headline: 'Focus drops after 3 consecutive sessions without a break',
          description: `Days with structured breaks yielded +${pctBoost}% more total focus than days with stacked sessions. Taking 5–15m pauses prevents mental fatigue.`,
          iconName: 'battery-charging',
          score: 93,
        });
      }
    }

    // Case B: Marathon Flow State (High stamina uninterrupted flow)
    if (maxConsecutiveWorkStreak >= 3 && maxStreakSeconds >= 4500) {
      insights.push({
        id: 'marathon-streak',
        type: 'marathon-streak',
        badge: 'Deep Flow State',
        headline: `Marathon Flow: ${maxConsecutiveWorkStreak} consecutive Pomodoros`,
        description: `You maintained a continuous run of ${maxConsecutiveWorkStreak} focus sessions (${formatDurationHoursMins(maxStreakSeconds)}) in deep concentration without breaking stride.`,
        iconName: 'flame',
        score: 87,
      });
    }

    // Case C: Sustainable Pomodoro Cadence (Regular breaks routinely taken)
    const breakSessionsCount = sessionPool.filter((s) => s.sessionType !== 'WORK').length;
    if (breakSessionsCount >= 3 && breakSessionsCount / sessions.length >= 0.4) {
      insights.push({
        id: 'break-cadence',
        type: 'break-cadence',
        badge: 'Optimal Cadence',
        headline: 'Consistent cadence with regular recovery breaks',
        description: `You routinely paired work blocks with rest intervals, sustaining clean focus across ${sessions.length} Pomodoro sessions.`,
        iconName: 'sparkles',
        score: 85,
      });
    }
  }

  // -------------------------------------------------------------
  // 3. Day-of-Week Powerhouse & Distribution
  // -------------------------------------------------------------
  if (periodType !== 'day' && activeFocusDays >= 3 && sessions.length >= 4) {
    const weekdaySeconds = new Array(7).fill(0);
    const weekdayDates: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());

    sessions.forEach((s) => {
      const d = new Date(s.completedAt);
      if (isNaN(d.getTime())) return;
      const dur = s.durationSeconds > 0 ? s.durationSeconds : 0;
      if (dur <= 0) return;
      const dayIdx = d.getDay();
      weekdaySeconds[dayIdx] += dur;
      weekdayDates[dayIdx].add(toDateKey(d));
    });

    let bestDayIdx = 1;
    let highestAvgWeekdaySec = -1;
    let activeWeekdaysCount = 0;
    let totalWeekdaySec = 0;

    for (let i = 0; i < 7; i++) {
      const daysForWeekday = weekdayDates[i].size;
      if (daysForWeekday > 0) {
        activeWeekdaysCount += 1;
        totalWeekdaySec += weekdaySeconds[i];
        const avgForWeekday = weekdaySeconds[i] / daysForWeekday;
        if (avgForWeekday > highestAvgWeekdaySec) {
          highestAvgWeekdaySec = avgForWeekday;
          bestDayIdx = i;
        }
      }
    }

    if (activeWeekdaysCount >= 2 && highestAvgWeekdaySec >= 1800) {
      const avgActiveDaySec = totalWeekdaySec / activeFocusDays;
      if (highestAvgWeekdaySec >= avgActiveDaySec * 1.25) {
        const pctAbove = Math.round(((highestAvgWeekdaySec - avgActiveDaySec) / avgActiveDaySec) * 100);
        const bestDayTotalSec = weekdaySeconds[bestDayIdx];
        insights.push({
          id: 'powerhouse-day',
          type: 'powerhouse-day',
          badge: 'Productivity Rhythm',
          headline: `${WEEKDAY_NAMES[bestDayIdx]} is your Powerhouse Day`,
          description: `You logged ${formatDurationHoursMins(bestDayTotalSec)} on ${WEEKDAY_NAMES[bestDayIdx]}s (+${pctAbove}% above your typical active day in this period).`,
          iconName: 'calendar',
          score: 93,
        });
      }
    }

    // Weekend vs Weekday analysis
    const weekendSec = weekdaySeconds[0] + weekdaySeconds[6];
    const weekdaySec = totalWeekdaySec - weekendSec;

    if (totalWeekdaySec >= 7200) {
      const weekendRatio = weekendSec / totalWeekdaySec;
      if (weekendRatio >= 0.3) {
        const pctWeekend = Math.round(weekendRatio * 100);
        insights.push({
          id: 'weekend-focus',
          type: 'weekend-focus',
          badge: 'Weekend Focus',
          headline: `Weekend Warrior: ${pctWeekend}% of focus on weekends`,
          description: `You dedicated ${formatDurationHoursMins(weekendSec)} to deep work on Saturday & Sunday, making great use of quiet periods.`,
          iconName: 'calendar',
          score: 84,
        });
      } else if (weekendRatio <= 0.05 && weekdaySec >= 14400 && activeFocusDays >= 5) {
        insights.push({
          id: 'workweek-boundaries',
          type: 'workweek-boundaries',
          badge: 'Work-Life Rhythm',
          headline: 'Clean Workweek Boundaries: 95%+ focus on weekdays',
          description: `You executed deep work Monday through Friday, reserving weekends completely for rest and recharge.`,
          iconName: 'calendar',
          score: 82,
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Consistency Streaks & Milestones
  // -------------------------------------------------------------
  if (activeFocusDates.length >= 3) {
    let maxStreak = 0;
    let currentStreak = 0;
    let prevTime: number | null = null;

    activeFocusDates.forEach((dateStr) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const curTime = Date.UTC(y, m - 1, d);

      if (prevTime === null) {
        currentStreak = 1;
      } else {
        const diffDays = Math.round((curTime - prevTime) / 86400000);
        if (diffDays === 1) {
          currentStreak += 1;
        } else {
          currentStreak = 1;
        }
      }
      prevTime = curTime;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
      }
    });

    if (maxStreak >= 3) {
      insights.push({
        id: 'focus-streak',
        type: 'focus-streak',
        badge: 'Consistency Streak',
        headline: `${maxStreak}-day daily focus streak!`,
        description: `You maintained steady momentum across ${maxStreak} consecutive days with completed focus sessions.`,
        iconName: 'flame',
        score: 91,
      });
    }
  }

  // Milestones (independent of active date count so intense 1-2 day sprints still qualify)
  if (totalFocusSeconds >= 72000) {
    insights.push({
      id: 'milestone',
      type: 'milestone',
      badge: 'Milestone Achieved',
      headline: 'Major Landmark: 20+ hours of deep work!',
      description: `You logged ${formatDurationHoursMins(totalFocusSeconds)} of focused concentration across ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} in this period.`,
      iconName: 'award',
      score: 90,
    });
  } else if (totalFocusSeconds >= 36000) {
    insights.push({
      id: 'milestone',
      type: 'milestone',
      badge: 'Milestone Achieved',
      headline: 'Milestone: Surpassed 10 hours of deep work!',
      description: `You logged ${formatDurationHoursMins(totalFocusSeconds)} across ${sessions.length} Pomodoro ${sessions.length === 1 ? 'session' : 'sessions'}. Outstanding focus!`,
      iconName: 'award',
      score: 88,
    });
  } else if (sessions.length >= 25) {
    insights.push({
      id: 'milestone',
      type: 'milestone',
      badge: 'Milestone Achieved',
      headline: 'Milestone: 25+ Pomodoros completed!',
      description: `You achieved ${sessions.length} completed sessions (${formatDurationHoursMins(totalFocusSeconds)} total).`,
      iconName: 'award',
      score: 86,
    });
  }

  // -------------------------------------------------------------
  // 5. Context Switching vs. Deep Dive Mode
  // Compares focus output on single-tag days vs multi-tag days
  // -------------------------------------------------------------
  if (sessions.length >= 4 && activeFocusDays >= 2) {
    const dayTagsMap = new Map<string, Set<string>>();
    sessions.forEach((s) => {
      if (!s.completedAt || s.durationSeconds <= 0) return;
      const key = toDateKey(s.completedAt);
      const set = dayTagsMap.get(key) || new Set<string>();
      set.add(resolveValidTagId(s.tagId) || 'unassigned');
      dayTagsMap.set(key, set);
    });

    let singleTagSec = 0;
    let singleTagDays = 0;
    let multiTagSec = 0;
    let multiTagDays = 0;

    dayTagsMap.forEach((tagSet, dateKey) => {
      const focus = dateFocusMap.get(dateKey);
      const sec = focus ? focus.seconds : 0;
      if (sec === 0) return;

      if (tagSet.size === 1 && !tagSet.has('unassigned')) {
        singleTagSec += sec;
        singleTagDays += 1;
      } else if (tagSet.size >= 2) {
        multiTagSec += sec;
        multiTagDays += 1;
      }
    });

    if (singleTagDays >= 1 && multiTagDays >= 1) {
      const singleAvg = singleTagSec / singleTagDays;
      const multiAvg = multiTagSec / multiTagDays;

      if (singleAvg >= multiAvg * 1.25 && singleAvg >= 1800) {
        const pctAdv = Math.round(((singleAvg - multiAvg) / multiAvg) * 100);
        insights.push({
          id: 'context-switching',
          type: 'context-switching',
          badge: 'Deep Dive Mode',
          headline: `Deep Dive Mode: +${pctAdv}% focus on single-topic days`,
          description: `Days dedicated to just one project averaged ${formatDurationHoursMins(Math.round(singleAvg))} vs ${formatDurationHoursMins(Math.round(multiAvg))} when splitting attention across multiple tags.`,
          iconName: 'layers',
          score: 89,
        });
      }
    }
  }

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
          const boostPct = Math.round(((avgCoffeeDaySec - avgZeroCoffeeDaySec) / avgZeroCoffeeDaySec) * 100);
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
          const dipPct = Math.round(((avgZeroCoffeeDaySec - avgCoffeeDaySec) / avgCoffeeDaySec) * 100);
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

  // -------------------------------------------------------------
  // 12. Tag Dominance (Single project tag dominating >= 55% of focus)
  // -------------------------------------------------------------
  if (sessions.length >= 2 && totalFocusSeconds >= 3600) {
    const tagTotals = new Map<string, { sec: number; count: number }>();
    sessions.forEach((s) => {
      const tid = resolveValidTagId(s.tagId);
      if (!tid) return;
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

    const share = Math.min(100, Math.round((topSec / totalFocusSeconds) * 100));
    if (topTid && share >= 55) {
      const tagName = getTagName(topTid);
      insights.push({
        id: 'tag-dominance',
        type: 'tag-dominance',
        badge: 'Core Focus',
        headline: `${tagName} dominated ${share}% of focus time`,
        description: `You dedicated ${formatDurationHoursMins(topSec)} across ${topCount} ${topCount === 1 ? 'session' : 'sessions'} entirely to ${tagName}.`,
        iconName: 'target',
        score: 80,
      });
    }
  }

  // -------------------------------------------------------------
  // 13. Tag Diversity (Balanced focus across 3+ project tags)
  // -------------------------------------------------------------
  if (sessions.length >= 4 && totalFocusSeconds >= 3600) {
    const tagTotals = new Map<string, number>();
    sessions.forEach((s) => {
      const tid = resolveValidTagId(s.tagId);
      if (!tid) return;
      tagTotals.set(tid, (tagTotals.get(tid) || 0) + (s.durationSeconds > 0 ? s.durationSeconds : 0));
    });

    const activeTagsCount = tagTotals.size;
    if (activeTagsCount >= 3) {
      const maxTagSec = Math.max(...Array.from(tagTotals.values()));
      const maxShare = totalFocusSeconds > 0 ? maxTagSec / totalFocusSeconds : 0;

      if (maxShare <= 0.45) {
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
  }

  // -------------------------------------------------------------
  // 14. Focus Momentum (High session velocity)
  // -------------------------------------------------------------
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
  // 15. Daily Summary (For single day view)
  // -------------------------------------------------------------
  if (periodType === 'day' && (sessions.length > 0 || coffeeCups.length > 0)) {
    const pomodoroWord = sessions.length === 1 ? 'Pomodoro' : 'Pomodoros';
    const cupWord = coffeeCups.length === 1 ? 'cup' : 'cups';

    if (sessions.length > 0 && coffeeCups.length > 0) {
      insights.push({
        id: 'daily-summary',
        type: 'daily-summary',
        badge: 'Day Summary',
        headline: `${sessions.length} ${pomodoroWord} fueled by ${coffeeCups.length} ${cupWord} of coffee`,
        description: `You logged ${formatDurationHoursMins(totalFocusSeconds)} of deep work today. Great rhythm!`,
        iconName: 'sparkles',
        score: 99,
      });
    } else if (sessions.length > 0) {
      insights.push({
        id: 'daily-summary',
        type: 'daily-summary',
        badge: 'Day Summary',
        headline: `${sessions.length} ${pomodoroWord} completed (${formatDurationHoursMins(totalFocusSeconds)} focus)`,
        description: 'Solid progress logged today without any coffee. Keep the momentum going!',
        iconName: 'sparkles',
        score: 99,
      });
    } else if (coffeeCups.length > 0) {
      insights.push({
        id: 'daily-summary',
        type: 'daily-summary',
        badge: 'Day Summary',
        headline: `${coffeeCups.length} ${cupWord} of coffee logged today`,
        description: 'Ready to channel that caffeine into your first Pomodoro session of the day?',
        iconName: 'coffee',
        score: 99,
      });
    }
  }

  // -------------------------------------------------------------
  // 16. Fallback / Empty State
  // -------------------------------------------------------------
  if (insights.length === 0) {
    if (sessions.length === 0 && coffeeCups.length === 0) {
      insights.push({
        id: 'empty-state',
        type: 'empty-state',
        badge: 'Smart Insights',
        headline: 'No activity logged for this period',
        description: 'Complete a session or log a cup of coffee to view insights',
        iconName: 'sparkles',
        score: 10,
      });
    } else if (sessions.length > 0) {
      insights.push({
        id: 'first-session-streak',
        type: 'focus-momentum',
        badge: 'Focus Progress',
        headline: `${sessions.length} Pomodoro ${sessions.length === 1 ? 'session' : 'sessions'} logged`,
        description: `Total focus time of ${formatDurationHoursMins(totalFocusSeconds)} in this time period. Continue logging to unlock deeper correlation patterns.`,
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

  const tieredInsights: InterestingStat[] = rawInsights.map((stat) => ({
    ...stat,
    tier: INSIGHT_TIERS[stat.type],
  }));

  // Sort by tier ascending (1 -> 2 -> 3), then score descending
  return tieredInsights.sort((a, b) => a.tier - b.tier || b.score - a.score);
}

/**
 * Generates and selects a single insight for the period based on tier priority:
 * Tier 1 if available, otherwise Tier 2 if available, otherwise Tier 3.
 * Picks a random insight when multiple insights exist in the winning tier.
 */
export function generatePeriodInsights(
  params: GenerateInsightsParams,
  randomFn: () => number = Math.random
): InterestingStat[] {
  const allInsights = generateAllPeriodInsights(params);
  const selected = selectTieredInsight(allInsights, randomFn);
  return selected ? [selected] : [];
}

