import { generateCoffeeInsights } from './coffeeGenerators';
import {
  generateCoreFocusInsights,
  generateSummaryAndTagInsights,
} from './focusGenerators';
import { buildInsightContext } from './mathHelpers';
import {
  GenerateInsightsParams,
  INSIGHT_TIERS,
  InterestingStat,
  RawInsight,
} from './types';

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
export function generateAllPeriodInsights(params: GenerateInsightsParams): InterestingStat[] {
  const rawInsights: RawInsight[] = [];
  const insights = {
    push: (stat: RawInsight) => {
      rawInsights.push(stat);
    },
    get length() {
      return rawInsights.length;
    },
  };

  const ctx = buildInsightContext(params);

  // Categories 1–5: Focus windows, breaks/fatigue, day-of-week, streaks/milestones, context-switching
  generateCoreFocusInsights(ctx, insights);

  // Categories 6–11: Coffee affinity, coffee vs zero-coffee, sweet spot, ritual, fuel efficiency, clean energy
  generateCoffeeInsights(ctx, insights);

  // Categories 12–16: Tag dominance/diversity, focus momentum, daily summary, fallback
  generateSummaryAndTagInsights(ctx, insights);

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
