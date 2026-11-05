import React from 'react';
import { InterestingStat } from '../../utils/insights';
import { Card } from '../ui/Card';
import {
  Coffee,
  Zap,
  Sparkles,
  Target,
  Clock,
  Flame,
  TrendingUp,
  Layers,
  Calendar,
  Award,
  BatteryCharging,
  Lightbulb,
  LucideIcon,
} from 'lucide-react';

interface SmartInsightPanelProps {
  insight?: InterestingStat | null;
  insights?: InterestingStat[];
}

const INSIGHT_ICONS: Record<
  NonNullable<InterestingStat['iconName']>,
  { Icon: LucideIcon; color: string; bg: string }
> = {
  coffee: { Icon: Coffee, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-700/10' },
  zap: { Icon: Zap, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-600/10' },
  'trending-up': { Icon: TrendingUp, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-600/10' },
  target: { Icon: Target, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-600/10' },
  clock: { Icon: Clock, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-600/10' },
  flame: { Icon: Flame, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-600/10' },
  layers: { Icon: Layers, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-600/10' },
  sparkles: { Icon: Sparkles, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-600/10' },
  calendar: { Icon: Calendar, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-600/10' },
  award: { Icon: Award, color: 'text-amber-500 dark:text-amber-300', bg: 'bg-amber-500/10' },
  'battery-charging': { Icon: BatteryCharging, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-600/10' },
};

export const SmartInsightPanel: React.FC<SmartInsightPanelProps> = ({ insight, insights }) => {
  const currentInsight = insight ?? insights?.[0] ?? null;

  if (!currentInsight) return null;

  const iconConfig = (currentInsight.iconName && INSIGHT_ICONS[currentInsight.iconName]) || INSIGHT_ICONS.sparkles;
  const { Icon: InsightIcon, color, bg } = iconConfig;

  return (
    <div className="flex flex-col gap-2">
      {/* Header with invariant height to prevent layout shifts when navigating between periods */}
      <div className="flex items-center justify-between h-7">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-bold text-md-on-surface tracking-wide uppercase">
            Insight
          </h3>
        </div>
      </div>

      <Card
        variant="filled"
        className="p-5 bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs relative overflow-hidden transition-all duration-200"
      >
        <div className="flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${bg}`}
          >
            <InsightIcon className={`w-5 h-5 ${color}`} />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-base sm:text-lg font-bold text-md-on-surface tracking-tight leading-snug">
              {currentInsight.headline}
            </h4>

            <p className="text-xs sm:text-sm text-md-on-surface-variant leading-relaxed mt-1">
              {currentInsight.description}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

