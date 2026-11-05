import { CompletedSession } from '../../types/session';
import { toDateKey, WEEKDAY_NAMES } from '../dates';
import { formatDurationHoursMins } from '../formatters';
import { InsightContext, RawInsight } from './types';

/**
 * Generates core focus insights (Categories 1–5):
 * 1. Precision Peak Focus Window (Golden Hours)
 * 2. Break Cadence & Fatigue Detection
 * 3. Day-of-Week Powerhouse & Distribution
 * 4. Consistency Streaks & Milestones
 * 5. Context Switching vs. Deep Dive Mode
 */
export function generateCoreFocusInsights(
  ctx: InsightContext,
  insights: { push: (stat: RawInsight) => void }
): void {
  const {
    sessions,
    allSessions,
    periodType,
    totalFocusSeconds,
    activeFocusDates,
    activeFocusDays,
    dateFocusMap,
    resolveValidTagId,
  } = ctx;

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
      daySessions.sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
      );

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
        const pctAbove = Math.round(
          ((highestAvgWeekdaySec - avgActiveDaySec) / avgActiveDaySec) * 100
        );
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
}

/**
 * Generates tag balance, momentum, daily summary, and fallback insights (Categories 12–16):
 * 12. Tag Dominance
 * 13. Tag Diversity
 * 14. Focus Momentum
 * 15. Daily Summary
 * 16. Fallback / Empty State
 */
export function generateSummaryAndTagInsights(
  ctx: InsightContext,
  insights: { push: (stat: RawInsight) => void; readonly length: number }
): void {
  const {
    sessions,
    coffeeCups,
    periodType,
    totalFocusSeconds,
    activeFocusDays,
    resolveValidTagId,
    getTagName,
  } = ctx;

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
      tagTotals.set(
        tid,
        (tagTotals.get(tid) || 0) + (s.durationSeconds > 0 ? s.durationSeconds : 0)
      );
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
        description:
          'Ready to channel that caffeine into your first Pomodoro session of the day?',
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
        description:
          'Pair your coffee breaks with focused Pomodoro intervals to unlock correlation insights!',
        iconName: 'coffee',
        score: 50,
      });
    }
  }
}
