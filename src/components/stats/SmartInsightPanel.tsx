import React, { useState, useEffect } from 'react';
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
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  LucideIcon,
} from 'lucide-react';

interface SmartInsightPanelProps {
  insights: InterestingStat[];
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

export const SmartInsightPanel: React.FC<SmartInsightPanelProps> = ({ insights }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Reset index to top insight whenever the insights collection changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [insights]);

  if (!insights || insights.length === 0) return null;

  const safeIndex = Math.min(currentIndex, insights.length - 1);
  const currentInsight = insights[safeIndex];

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : insights.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < insights.length - 1 ? prev + 1 : 0));
  };

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

        {/* Navigation controls: always in layout to preserve exact height, invisible when only 1 insight */}
        <div
          className={`flex items-center gap-1.5 text-xs text-md-on-surface-variant font-medium transition-opacity ${
            insights.length > 1
              ? 'visible opacity-100'
              : 'invisible pointer-events-none opacity-0 select-none'
          }`}
          aria-hidden={insights.length <= 1}
        >
          <span>
            {safeIndex + 1} of {Math.max(1, insights.length)}
          </span>
          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={handlePrev}
              disabled={insights.length <= 1}
              aria-label="Previous insight"
              className="w-7 h-7 rounded-full flex items-center justify-center bg-md-surface-container hover:bg-md-surface-container-high active:scale-95 transition-all text-md-on-surface-variant hover:text-md-on-surface disabled:opacity-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={insights.length <= 1}
              aria-label="Next insight"
              className="w-7 h-7 rounded-full flex items-center justify-center bg-md-surface-container hover:bg-md-surface-container-high active:scale-95 transition-all text-md-on-surface-variant hover:text-md-on-surface disabled:opacity-0"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
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

        {/* Carousel dot indicators for quick visual glance */}
        {insights.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 pt-3 mt-3 border-t border-md-outline-variant/15">
            {insights.slice(0, 8).map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  idx === safeIndex
                    ? 'w-5 bg-md-primary'
                    : 'w-1.5 bg-md-outline-variant/50 hover:bg-md-outline-variant'
                }`}
                aria-label={`Jump to insight ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
