import { Tag } from '../../types/tag';
import { toDateKey, WEEKDAY_NAMES, MONTH_NAMES } from '../dates';
import {
  CoffeePeakMetric,
  CustomDateRange,
  StatCoffeeCup,
  TimePeriodType,
} from './types';

/**
 * Filters coffee cups whose date falls within the period [startDate, endDate].
 */
export function filterPeriodCoffee<T extends StatCoffeeCup>(
  coffeeCups: T[],
  startDate: Date,
  endDate: Date
): T[] {
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  return coffeeCups.filter((cup) => {
    if (!cup || !cup.date) return false;
    return cup.date >= startKey && cup.date <= endKey;
  });
}

/**
 * Computes elapsed days for daily coffee average using UTC date boundaries
 * to prevent DST offset drift.
 */
export function computeCoffeeElapsedDays(
  periodType: TimePeriodType,
  referenceDate: Date,
  startDate: Date,
  endDate: Date,
  sanitizedCustomRange: CustomDateRange,
  todayKey: string,
  filteredCoffee: StatCoffeeCup[]
): number {
  const now = new Date(`${todayKey}T12:00:00`);
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);

  if (periodType === 'day') {
    return 1;
  }

  if (periodType === 'week') {
    if (todayKey >= startKey && todayKey <= endKey) {
      const [sY, sM, sD] = startKey.split('-').map(Number);
      const [tY, tM, tD] = todayKey.split('-').map(Number);
      const diffDays =
        Math.round((Date.UTC(tY, tM - 1, tD) - Date.UTC(sY, sM - 1, sD)) / 86400000) + 1;
      return Math.max(1, Math.min(7, diffDays));
    }
    if (todayKey > endKey) {
      return 7;
    }
    return 1;
  }

  if (periodType === 'month') {
    const daysInMonth = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + 1,
      0
    ).getDate();
    if (
      referenceDate.getFullYear() === now.getFullYear() &&
      referenceDate.getMonth() === now.getMonth()
    ) {
      return Math.max(1, Math.min(daysInMonth, now.getDate()));
    }
    if (
      referenceDate.getFullYear() < now.getFullYear() ||
      (referenceDate.getFullYear() === now.getFullYear() &&
        referenceDate.getMonth() < now.getMonth())
    ) {
      return daysInMonth;
    }
    return 1;
  }

  if (periodType === 'year') {
    const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const totalDaysInYear = isLeap(referenceDate.getFullYear()) ? 366 : 365;
    if (referenceDate.getFullYear() === now.getFullYear()) {
      const startOfYearUtc = Date.UTC(now.getFullYear(), 0, 1);
      const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      const dayOfYear = Math.round((todayUtc - startOfYearUtc) / 86400000) + 1;
      return Math.max(1, Math.min(totalDaysInYear, dayOfYear));
    }
    if (referenceDate.getFullYear() < now.getFullYear()) {
      return totalDaysInYear;
    }
    return 1;
  }

  if (periodType === 'custom') {
    const [sY, sM, sD] = sanitizedCustomRange.start.split('-').map(Number);
    const [eY, eM, eD] = sanitizedCustomRange.end.split('-').map(Number);
    const [tY, tM, tD] = todayKey.split('-').map(Number);
    const sUtc = Date.UTC(sY, sM - 1, sD);
    const eUtc = Date.UTC(eY, eM - 1, eD);
    const todayUtc = Date.UTC(tY, tM - 1, tD);

    const effectiveEndUtc = Math.min(eUtc, todayUtc);
    if (effectiveEndUtc >= sUtc) {
      return Math.max(1, Math.round((effectiveEndUtc - sUtc) / 86400000) + 1);
    }
    return 1;
  }

  // 'all' time: days from earliest coffee cup to today
  if (filteredCoffee.length > 0) {
    const sortedDates = filteredCoffee.map((c) => c.date).sort();
    const firstDateStr = sortedDates[0];
    const [fY, fM, fD] = firstDateStr.split('-').map(Number);
    const [tY, tM, tD] = todayKey.split('-').map(Number);
    const firstUtc = Date.UTC(fY, fM - 1, fD);
    const todayUtc = Date.UTC(tY, tM - 1, tD);
    if (todayUtc >= firstUtc) {
      return Math.max(1, Math.round((todayUtc - firstUtc) / 86400000) + 1);
    }
  }
  return 1;
}

/**
 * Computes the peak coffee metric for the selected time window.
 */
export function computeCoffeePeakMetric(
  filteredCoffee: StatCoffeeCup[],
  periodType: TimePeriodType,
  referenceDate: Date,
  todayKey: string,
  tags: Tag[]
): CoffeePeakMetric {
  const now = new Date(`${todayKey}T12:00:00`);
  const tagMap = new Map<string, Tag>();
  tags.forEach((t) => tagMap.set(t.id, t));

  const dayCupCounts = new Map<string, number>();
  filteredCoffee.forEach((c) => {
    dayCupCounts.set(c.date, (dayCupCounts.get(c.date) || 0) + 1);
  });

  let maxCups = 0;
  let maxDayKey = '';
  dayCupCounts.forEach((cnt, key) => {
    if (cnt > maxCups) {
      maxCups = cnt;
      maxDayKey = key;
    }
  });

  if (periodType === 'all') {
    if (filteredCoffee.length === 0) {
      return {
        title: 'Peak Coffee Day',
        value: 'N/A',
        subtext: 'No coffee logged yet',
        hasData: false,
      };
    }

    const sortedDates = Array.from(dayCupCounts.keys()).sort();
    const earliestDate = new Date(`${sortedDates[0]}T00:00:00.000`);
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const weekdayOccurrences = new Array(7).fill(0);
    const weekdayTotalCups = new Array(7).fill(0);

    const cur = new Date(earliestDate.getTime());
    while (cur <= todayDate) {
      weekdayOccurrences[cur.getDay()] += 1;
      cur.setDate(cur.getDate() + 1);
    }

    dayCupCounts.forEach((count, dKey) => {
      const d = new Date(`${dKey}T00:00:00.000`);
      weekdayTotalCups[d.getDay()] += count;
    });

    let bestWeekday = 1;
    let highestAvgCups = -1;
    for (let i = 0; i < 7; i++) {
      const occ = weekdayOccurrences[i];
      if (occ > 0) {
        const avg = weekdayTotalCups[i] / occ;
        if (avg > highestAvgCups) {
          highestAvgCups = avg;
          bestWeekday = i;
        }
      }
    }

    return {
      title: 'Peak Coffee Day',
      value: highestAvgCups > 0 ? `${WEEKDAY_NAMES[bestWeekday]}s` : 'N/A',
      subtext:
        highestAvgCups > 0
          ? `${highestAvgCups.toFixed(1)} cups avg per ${WEEKDAY_NAMES[bestWeekday].slice(0, 3)}`
          : 'No coffee logged yet',
      hasData: highestAvgCups > 0,
    };
  }

  if (periodType === 'week') {
    if (maxCups > 0) {
      const d = new Date(`${maxDayKey}T00:00:00.000`);
      return {
        title: 'Peak Coffee Day',
        value: WEEKDAY_NAMES[d.getDay()],
        subtext: `${maxCups} ${maxCups === 1 ? 'cup' : 'cups'} logged`,
        hasData: true,
      };
    }
    return {
      title: 'Peak Coffee Day',
      value: 'N/A',
      subtext: 'No coffee logged this week',
      hasData: false,
    };
  }

  if (periodType === 'month') {
    if (maxCups > 0) {
      const d = new Date(`${maxDayKey}T00:00:00.000`);
      return {
        title: 'Peak Coffee Day',
        value: `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`,
        subtext: `${maxCups} ${maxCups === 1 ? 'cup' : 'cups'} logged`,
        hasData: true,
      };
    }
    return {
      title: 'Peak Coffee Day',
      value: 'N/A',
      subtext: 'No coffee logged this month',
      hasData: false,
    };
  }

  if (periodType === 'year') {
    const monthCupCounts = new Array(12).fill(0);
    filteredCoffee.forEach((c) => {
      const m = new Date(`${c.date}T00:00:00.000`).getMonth();
      monthCupCounts[m] += 1;
    });
    let maxMonthIdx = 0;
    let maxMonthCups = 0;
    monthCupCounts.forEach((cnt, idx) => {
      if (cnt > maxMonthCups) {
        maxMonthCups = cnt;
        maxMonthIdx = idx;
      }
    });

    if (maxMonthCups > 0) {
      return {
        title: 'Peak Coffee Month',
        value: MONTH_NAMES[maxMonthIdx],
        subtext: `${maxMonthCups} ${maxMonthCups === 1 ? 'cup' : 'cups'} logged`,
        hasData: true,
      };
    }
    return {
      title: 'Peak Coffee Month',
      value: 'N/A',
      subtext: 'No coffee logged this year',
      hasData: false,
    };
  }

  if (periodType === 'day') {
    const tagCounts = new Map<string | null, number>();
    filteredCoffee.forEach((c) => {
      const validTid = c.tagId && tagMap.has(c.tagId) ? c.tagId : null;
      tagCounts.set(validTid, (tagCounts.get(validTid) || 0) + 1);
    });
    let topTagId: string | null = null;
    let topTagCount = 0;
    tagCounts.forEach((cnt, tid) => {
      if (cnt > topTagCount) {
        topTagCount = cnt;
        topTagId = tid;
      }
    });

    const isCurrentDay = toDateKey(referenceDate) === todayKey;
    if (topTagCount > 0) {
      const found = topTagId ? tagMap.get(topTagId) : undefined;
      const tagName = found ? found.name : 'No Tag';
      return {
        title: isCurrentDay ? 'Top Tag Today' : 'Top Tag For Day',
        value: tagName,
        subtext: `${topTagCount} ${topTagCount === 1 ? 'cup' : 'cups'} logged`,
        hasData: true,
      };
    }
    return {
      title: isCurrentDay ? 'Top Tag Today' : 'Top Tag For Day',
      value: 'N/A',
      subtext: isCurrentDay ? 'No coffee logged today' : 'No coffee logged for day',
      hasData: false,
    };
  }

  // custom
  if (maxCups > 0) {
    const d = new Date(`${maxDayKey}T00:00:00.000`);
    return {
      title: 'Peak Coffee Day',
      value: `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`,
      subtext: `${maxCups} ${maxCups === 1 ? 'cup' : 'cups'} logged`,
      hasData: true,
    };
  }
  return {
    title: 'Peak Coffee Day',
    value: 'N/A',
    subtext: 'No coffee logged in range',
    hasData: false,
  };
}

/**
 * Computes all coffee statistics for the selected time window.
 */
export function computeCoffeeStats<T extends StatCoffeeCup>(params: {
  coffeeCups: T[];
  periodType: TimePeriodType;
  referenceDate: Date;
  startDate: Date;
  endDate: Date;
  sanitizedCustomRange: CustomDateRange;
  todayKey: string;
  tags: Tag[];
}): {
  filteredCoffee: T[];
  totalCoffeeCups: number;
  coffeeElapsedDays: number;
  coffeeDailyAverage: number;
  coffeePeakMetric: CoffeePeakMetric;
} {
  const {
    coffeeCups,
    periodType,
    referenceDate,
    startDate,
    endDate,
    sanitizedCustomRange,
    todayKey,
    tags,
  } = params;

  const filteredCoffee = filterPeriodCoffee(coffeeCups, startDate, endDate);
  const totalCoffeeCups = filteredCoffee.length;
  const coffeeElapsedDays = computeCoffeeElapsedDays(
    periodType,
    referenceDate,
    startDate,
    endDate,
    sanitizedCustomRange,
    todayKey,
    filteredCoffee
  );
  const coffeeDailyAverage = Number((totalCoffeeCups / coffeeElapsedDays).toFixed(1));
  const coffeePeakMetric = computeCoffeePeakMetric(
    filteredCoffee,
    periodType,
    referenceDate,
    todayKey,
    tags
  );

  return {
    filteredCoffee,
    totalCoffeeCups,
    coffeeElapsedDays,
    coffeeDailyAverage,
    coffeePeakMetric,
  };
}
