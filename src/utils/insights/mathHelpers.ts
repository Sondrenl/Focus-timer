import { Tag } from '../../types/tag';
import { toDateKey } from '../dates';
import { DailyFocusStat, GenerateInsightsParams, InsightContext } from './types';

/**
 * Builds the pre-processed maps and helper lookups used across all insight generators.
 */
export function buildInsightContext(params: GenerateInsightsParams): InsightContext {
  const {
    sessions,
    coffeeCups,
    tags,
    periodType,
    totalFocusSeconds,
    totalCoffeeCups,
    allSessions,
  } = params;

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
  const dateFocusMap = new Map<string, DailyFocusStat>();
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
  const allActiveDates = Array.from(
    new Set([...activeFocusDates, ...dateCoffeeMap.keys()])
  ).sort();
  const activeFocusDays = activeFocusDates.length;

  return {
    sessions,
    coffeeCups,
    tags,
    periodType,
    totalFocusSeconds,
    totalCoffeeCups,
    allSessions,
    tagMap,
    resolveValidTagId,
    getTagName,
    dateFocusMap,
    dateCoffeeMap,
    activeFocusDates,
    allActiveDates,
    activeFocusDays,
  };
}
