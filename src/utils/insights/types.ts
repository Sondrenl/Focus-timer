import { CompletedSession } from '../../types/session';
import { CoffeeCup } from '../../types/coffee';
import { Tag } from '../../types/tag';

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

export type RawInsight = Omit<InterestingStat, 'tier'>;

export interface GenerateInsightsParams {
  sessions: CompletedSession[];
  coffeeCups: CoffeeCup[];
  tags: Tag[];
  periodType: string;
  totalFocusSeconds: number;
  totalCoffeeCups: number;
  allSessions?: CompletedSession[];
}

export interface DailyFocusStat {
  seconds: number;
  count: number;
}

export interface InsightContext {
  sessions: CompletedSession[];
  coffeeCups: CoffeeCup[];
  tags: Tag[];
  periodType: string;
  totalFocusSeconds: number;
  totalCoffeeCups: number;
  allSessions?: CompletedSession[];
  tagMap: Map<string, Tag>;
  resolveValidTagId: (tagId: string | null | undefined) => string | null;
  getTagName: (tagId: string | null | undefined) => string;
  dateFocusMap: Map<string, DailyFocusStat>;
  dateCoffeeMap: Map<string, number>;
  activeFocusDates: string[];
  allActiveDates: string[];
  activeFocusDays: number;
}
