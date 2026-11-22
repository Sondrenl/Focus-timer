import { useState, useMemo, useEffect, useRef } from 'react';
import { useData } from '../context/DataContext';
import { useAuthProfile } from '../context/AuthProfileContext';
import { isProduction } from '../utils/environment';
import { toDateKey } from '../utils/dates';
import { isSampleSessionId } from '../services/repository/SessionRepository';
import { useTodayKey } from './useTodayKey';
import {
  generateAllPeriodInsights,
  selectTieredInsight,
  InterestingStat,
} from '../utils/insights';
import {
  TimePeriodType,
  TagStat,
  ActivityBarStat,
  ProductiveMetric,
  CoffeePeakMetric,
  CustomDateRange,
} from '../utils/stats/types';
import {
  getAdjacentReferenceDate,
  checkIsCurrentPeriod,
  checkCanGoNext,
  computePeriodBounds,
} from '../utils/stats/periodBounds';
import {
  filterPeriodSessions,
  computeFocusTotals,
  computeTagDistribution,
  computeActivityBars,
  computeProductiveMetric,
} from '../utils/stats/focusStats';
import { computeCoffeeStats } from '../utils/stats/coffeeStats';

export type {
  InterestingStat,
  TimePeriodType,
  TagStat,
  ActivityBarStat,
  ProductiveMetric,
  CoffeePeakMetric,
};

export function useStatistics() {
  const { sessions, tags, coffeeCups } = useData();
  const { isEffectiveAuthenticated } = useAuthProfile();

  const [periodType, setPeriodType] = useState<TimePeriodType>('week');
  const [referenceDate, setReferenceDate] = useState<Date>(() => new Date());

  // Default custom range: last 14 days up to today
  const [customRange, setCustomRange] = useState<CustomDateRange>(() => {
    const today = new Date();
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(today.getDate() - 13);
    return {
      start: toDateKey(twoWeeksAgo),
      end: toDateKey(today),
    };
  });

  const todayKey = useTodayKey();
  const prevTodayKeyRef = useRef(todayKey);

  // If the user is viewing the current day/week/month/year when local midnight passes,
  // automatically advance referenceDate so stats roll over live overnight.
  useEffect(() => {
    const prevTodayKey = prevTodayKeyRef.current;
    if (prevTodayKey === todayKey) return;
    prevTodayKeyRef.current = todayKey;

    if (checkIsCurrentPeriod(periodType, referenceDate, prevTodayKey)) {
      setReferenceDate(new Date());
    }
  }, [todayKey, periodType, referenceDate]);

  const goToPrev = () => {
    setReferenceDate((prev) => getAdjacentReferenceDate(prev, periodType, 'prev'));
  };

  const goToNext = () => {
    setReferenceDate((prev) => getAdjacentReferenceDate(prev, periodType, 'next'));
  };

  const goToToday = () => {
    setReferenceDate(new Date());
  };

  const isCurrentPeriod = useMemo(
    () => checkIsCurrentPeriod(periodType, referenceDate, todayKey),
    [periodType, referenceDate, todayKey]
  );

  const canGoNext = useMemo(
    () => checkCanGoNext(periodType, referenceDate, todayKey),
    [periodType, referenceDate, todayKey]
  );

  const stats = useMemo(() => {
    const { startDate, endDate, periodLabel, sanitizedCustomRange } = computePeriodBounds(
      periodType,
      referenceDate,
      customRange
    );

    const shouldExcludeSample = isProduction() || isEffectiveAuthenticated;
    const { periodAllSessions, filteredSessions } = filterPeriodSessions(
      sessions,
      startDate,
      endDate,
      shouldExcludeSample
    );

    const { totalFocusSeconds, totalWorkCount } =
      computeFocusTotals(filteredSessions);

    const tagDistribution = computeTagDistribution(filteredSessions, tags, totalFocusSeconds);

    const dayOverlapCandidates =
      periodType === 'day'
        ? sessions.filter(
            (s) => s.sessionType === 'WORK' && (!shouldExcludeSample || !isSampleSessionId(s.id))
          )
        : undefined;

    const activityBars = computeActivityBars(
      filteredSessions,
      periodType,
      referenceDate,
      startDate,
      sanitizedCustomRange,
      dayOverlapCandidates
    );

    const productiveMetric = computeProductiveMetric(
      filteredSessions,
      activityBars,
      periodType,
      referenceDate,
      isCurrentPeriod
    );

    const {
      filteredCoffee,
      totalCoffeeCups,
      coffeeDailyAverage,
      coffeePeakMetric,
    } = computeCoffeeStats({
      coffeeCups,
      periodType,
      referenceDate,
      startDate,
      endDate,
      sanitizedCustomRange,
      todayKey,
      tags,
      shouldExcludeSample,
    });

    const candidateInsights = generateAllPeriodInsights({
      sessions: filteredSessions,
      coffeeCups: filteredCoffee,
      tags,
      periodType,
      totalFocusSeconds,
      allSessions: periodAllSessions,
    });

    const insightsSignature = `${periodType}:${periodLabel}:${candidateInsights
      .map((i) => `${i.id}:${i.tier}:${i.headline}:${i.description}`)
      .join('|')}`;

    return {
      periodLabel,
      totalFocusSeconds,
      totalWorkCount,
      totalCoffeeCups,
      coffeeDailyAverage,
      coffeePeakMetric,
      tagDistribution,
      activityBars,
      productiveMetric,
      candidateInsights,
      insightsSignature,
      filteredSessions,
    };
  }, [
    sessions,
    tags,
    coffeeCups,
    periodType,
    referenceDate,
    customRange,
    isCurrentPeriod,
    todayKey,
    isEffectiveAuthenticated,
  ]);

  const topInsight = useMemo(() => {
    return selectTieredInsight(stats.candidateInsights);
  }, [stats.insightsSignature]);

  return {
    periodType,
    setPeriodType,
    periodLabel: stats.periodLabel,
    customRange,
    setCustomRange,
    goToPrev,
    goToNext,
    goToToday,
    canGoNext,
    isCurrentPeriod,
    totalFocusSeconds: stats.totalFocusSeconds,
    totalWorkCount: stats.totalWorkCount,
    totalCoffeeCups: stats.totalCoffeeCups,
    coffeeDailyAverage: stats.coffeeDailyAverage,
    coffeePeakMetric: stats.coffeePeakMetric,
    tagDistribution: stats.tagDistribution,
    activityBars: stats.activityBars,
    productiveMetric: stats.productiveMetric,
    filteredSessions: stats.filteredSessions,
    topInsight,
  };
}
