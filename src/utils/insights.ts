import { CompletedSession } from '../types/session';
import { CoffeeCup } from '../types/coffee';
import { Tag } from '../types/tag';
import { toDateKey, WEEKDAY_NAMES } from './dates';
import { formatDurationHoursMins } from './formatters';

export type InsightType =
  | 'peak-focus-window'
  | 'caffeine-latency'
  | 'afternoon-slump-defense'
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
  score: number; // Higher score = more relevant/interesting
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
 * Generates an array of ranked, deeply analytical insights by cross-referencing
 * focus sessions, caffeine intake timestamps, tags, and temporal rhythms for the selected period.
 */
export function generatePeriodInsights({
  sessions,
  coffeeCups,
  tags,
  periodType,
  totalFocusSeconds,
  totalCoffeeCups: _totalCoffeeCups,
  allSessions,
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

  const allActiveDates = Array.from(new Set([...dateFocusMap.keys(), ...dateCoffeeMap.keys()])).sort();
  const activeFocusDays = Array.from(dateFocusMap.keys()).length;

  // -------------------------------------------------------------
  // 1. Precision Peak Focus Window (Golden Hours)
  // Divides the 24-hour day into 30-minute slots and evaluates a
  // sliding 2.5-hour window to pinpoint exact flow state hours (e.g. 09:00–11:30).
  // -------------------------------------------------------------
  if (sessions.length >= 3 && totalFocusSeconds >= 3600) {
    const slotSeconds = new Array(48).fill(0);

    sessions.forEach((s) => {
      const d = new Date(s.completedAt);
      if (isNaN(d.getTime())) return;
      const endMin = d.getHours() * 60 + d.getMinutes();
      const durMin = Math.max(1, Math.round(s.durationSeconds / 60));
      const startMin = Math.max(0, endMin - durMin);

      for (let k = 0; k < 48; k++) {
        const slotStart = k * 30;
        const slotEnd = (k + 1) * 30;
        const overlapStart = Math.max(startMin, slotStart);
        const overlapEnd = Math.min(endMin, slotEnd);
        if (overlapEnd > overlapStart) {
          slotSeconds[k] += (overlapEnd - overlapStart) * 60;
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
      const pct = Math.round((maxWindowSec / totalFocusSeconds) * 100);
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
          description: `You concentrated ${formatDurationHoursMins(maxWindowSec)} (${pct}% of your deep work) during this golden window. Best reserved for your highest-priority tasks.`,
          iconName: 'target',
          score: 97,
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 2. Caffeine Kick-In Latency (Transition from brew to focus)
  // -------------------------------------------------------------
  if (coffeeCups.length >= 2 && sessions.length >= 2) {
    const latencies: number[] = [];

    coffeeCups.forEach((c) => {
      if (!c.createdAt) return;
      const cTime = new Date(c.createdAt).getTime();
      if (isNaN(cTime)) return;

      // Find first work session starting within -5m to +60m of coffee creation
      let closestLatency: number | null = null;
      sessions.forEach((s) => {
        const sEnd = new Date(s.completedAt).getTime();
        if (isNaN(sEnd)) return;
        const sStart = sEnd - Math.max(0, s.durationSeconds) * 1000;
        const diffMins = Math.round((sStart - cTime) / 60000);

        if (diffMins >= -5 && diffMins <= 60) {
          const lat = Math.max(0, diffMins);
          if (closestLatency === null || lat < closestLatency) {
            closestLatency = lat;
          }
        }
      });

      if (closestLatency !== null) {
        latencies.push(closestLatency);
      }
    });

    if (latencies.length >= 2 && latencies.length / coffeeCups.length >= 0.4) {
      const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      insights.push({
        id: 'caffeine-latency',
        type: 'caffeine-latency',
        badge: 'Caffeine Kick-in',
        headline: `Focus kicks in ~${avgLatency}m after logging coffee`,
        description: `You started a focus session shortly after ${latencies.length} of your coffee cups, transitioning swiftly from your brew into deep work.`,
        iconName: 'zap',
        score: 94,
      });
    }
  }

  // -------------------------------------------------------------
  // 3. Afternoon Slump Defense
  // Detects if coffee is strategically used to overcome the post-lunch dip
  // -------------------------------------------------------------
  if (coffeeCups.length >= 2 && sessions.length >= 2) {
    let afternoonCoffeeCount = 0;
    coffeeCups.forEach((c) => {
      if (!c.createdAt) return;
      const d = new Date(c.createdAt);
      if (isNaN(d.getTime())) return;
      const h = d.getHours();
      const m = d.getMinutes();
      const totalMin = h * 60 + m;
      if (totalMin >= 780 && totalMin <= 1050) {
        // 13:00 to 17:30
        afternoonCoffeeCount += 1;
      }
    });

    if (afternoonCoffeeCount >= 2 && afternoonCoffeeCount / coffeeCups.length >= 0.5) {
      let afternoonFocusSec = 0;
      sessions.forEach((s) => {
        const d = new Date(s.completedAt);
        if (isNaN(d.getTime())) return;
        const h = d.getHours();
        if (h >= 13 && h < 18) {
          afternoonFocusSec += s.durationSeconds > 0 ? s.durationSeconds : 0;
        }
      });

      if (afternoonFocusSec >= 1800) {
        const pctAfternoon = Math.round((afternoonCoffeeCount / coffeeCups.length) * 100);
        insights.push({
          id: 'afternoon-slump-defense',
          type: 'afternoon-slump-defense',
          badge: 'Slump Defense',
          headline: `Afternoon Coffee Shield: ${pctAfternoon}% cups post-lunch`,
          description: `You deployed coffee strategically in the afternoon, fueling ${formatDurationHoursMins(afternoonFocusSec)} of sustained deep work.`,
          iconName: 'coffee',
          score: 89,
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Break Cadence & Fatigue Detection
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
      let dayFocusSec = 0;

      for (let i = 0; i < daySessions.length; i++) {
        const s = daySessions[i];
        if (s.sessionType === 'WORK') {
          dayFocusSec += s.durationSeconds > 0 ? s.durationSeconds : 0;
          currentStreak += 1;
          currentStreakSec += s.durationSeconds > 0 ? s.durationSeconds : 0;

          if (currentStreak > maxConsecutiveWorkStreak) {
            maxConsecutiveWorkStreak = currentStreak;
            maxStreakSeconds = currentStreakSec;
          }

          if (currentStreak >= 3) {
            dayHadLongUnbrokenStreak = true;
          }
        } else {
          // Break logged (SHORT_BREAK or LONG_BREAK)
          currentStreak = 0;
          currentStreakSec = 0;
        }
      }

      if (dayHadLongUnbrokenStreak) {
        consecutiveUnbrokenWorkDays += 1;
        unbrokenFocusSecTotal += dayFocusSec;
      } else if (dayFocusSec > 0) {
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
  // 5. Day-of-Week Powerhouse & Distribution
  // -------------------------------------------------------------
  if (periodType !== 'day' && allActiveDates.length >= 3 && sessions.length >= 4) {
    const weekdaySeconds = new Array(7).fill(0);
    const weekdayCounts = new Array(7).fill(0);

    sessions.forEach((s) => {
      const d = new Date(s.completedAt);
      if (isNaN(d.getTime())) return;
      const dayIdx = d.getDay();
      weekdaySeconds[dayIdx] += s.durationSeconds > 0 ? s.durationSeconds : 0;
      weekdayCounts[dayIdx] += 1;
    });

    let bestDayIdx = 1;
    let highestTotalSec = -1;
    let activeWeekdaysCount = 0;
    let totalWeekdaySec = 0;

    for (let i = 0; i < 7; i++) {
      if (weekdayCounts[i] > 0) {
        activeWeekdaysCount += 1;
        totalWeekdaySec += weekdaySeconds[i];
        if (weekdaySeconds[i] > highestTotalSec) {
          highestTotalSec = weekdaySeconds[i];
          bestDayIdx = i;
        }
      }
    }

    if (activeWeekdaysCount >= 2 && highestTotalSec >= 1800) {
      const avgActiveSec = totalWeekdaySec / activeWeekdaysCount;
      if (highestTotalSec >= avgActiveSec * 1.25) {
        const pctAbove = Math.round(((highestTotalSec - avgActiveSec) / avgActiveSec) * 100);
        insights.push({
          id: 'powerhouse-day',
          type: 'powerhouse-day',
          badge: 'Productivity Rhythm',
          headline: `${WEEKDAY_NAMES[bestDayIdx]} is your Powerhouse Day`,
          description: `You logged ${formatDurationHoursMins(highestTotalSec)} on ${WEEKDAY_NAMES[bestDayIdx]}s (+${pctAbove}% above your typical active day in this period).`,
          iconName: 'calendar',
          score: 93,
        });
      }
    }

    // Weekend vs Weekday analysis
    const weekendSec = weekdaySeconds[0] + weekdaySeconds[6];
    const weekdaySec = totalFocusSeconds - weekendSec;

    if (totalFocusSeconds >= 7200) {
      const weekendRatio = weekendSec / totalFocusSeconds;
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
      } else if (weekendRatio <= 0.05 && weekdaySec >= 14400 && allActiveDates.length >= 5) {
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
  // 6. Consistency Streaks & Milestones
  // -------------------------------------------------------------
  if (allActiveDates.length >= 3) {
    let maxStreak = 0;
    let currentStreak = 0;
    let prevTime: number | null = null;

    allActiveDates.forEach((dateStr) => {
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

    // Milestones
    if (totalFocusSeconds >= 72000) {
      insights.push({
        id: 'milestone',
        type: 'milestone',
        badge: 'Milestone Achieved',
        headline: 'Major Landmark: 20+ hours of deep work!',
        description: `You logged ${formatDurationHoursMins(totalFocusSeconds)} of focused concentration across ${sessions.length} sessions in this period.`,
        iconName: 'award',
        score: 90,
      });
    } else if (totalFocusSeconds >= 36000) {
      insights.push({
        id: 'milestone',
        type: 'milestone',
        badge: 'Milestone Achieved',
        headline: 'Milestone: Surpassed 10 hours of deep work!',
        description: `You logged ${formatDurationHoursMins(totalFocusSeconds)} across ${sessions.length} Pomodoro sessions. Outstanding focus!`,
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
  }

  // -------------------------------------------------------------
  // 7. Context Switching vs. Deep Dive Mode
  // Compares focus output on single-tag days vs multi-tag days
  // -------------------------------------------------------------
  if (sessions.length >= 4 && activeFocusDays >= 2) {
    const dayTagsMap = new Map<string, Set<string>>();
    sessions.forEach((s) => {
      const key = toDateKey(s.completedAt);
      const set = dayTagsMap.get(key) || new Set<string>();
      set.add(s.tagId || 'unassigned');
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

      if (tagSet.size === 1) {
        singleTagSec += sec;
        singleTagDays += 1;
      } else {
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
  // 8. Tag & Coffee Affinity
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

      const tagFocusSec = sessions
        .filter((s) => (s.tagId || null) === topCoffeeTagId)
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

  // -------------------------------------------------------------
  // 9. Coffee & Productivity Correlation (With vs without coffee)
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
            score: 96,
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
  // 10. Coffee Sweet Spot (1–2 cups vs 3+ cups)
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
  // 11. Focus Fuel Efficiency (Ratio of Pomodoros per cup)
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
  // 12. Clean Energy (Tag with deep focus and ZERO coffee)
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
  // 13. Tag Dominance (Single tag dominating >= 55% of focus)
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
  // 14. Tag Diversity (Balanced focus across 3+ tags)
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
  // 15. Focus Momentum (High session velocity)
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
  // 16. Daily Summary (For single day view)
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
        score: 99,
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
  // 17. Fallback / Empty State
  // -------------------------------------------------------------
  if (insights.length === 0) {
    if (sessions.length === 0 && coffeeCups.length === 0) {
      insights.push({
        id: 'empty-state',
        type: 'empty-state',
        badge: 'Smart Insights',
        headline: 'No activity logged for this period',
        description: 'Complete a session or log a cup of coffee to uncover fascinating focus rhythms and caffeine correlations.',
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

  // Sort insights by score descending
  return insights.sort((a, b) => b.score - a.score);
}
