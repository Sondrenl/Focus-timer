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
  coffee: { Icon: Coffee, color: 'text-amber-700', bg: 'bg-amber-700/10' },
  zap: { Icon: Zap, color: 'text-amber-600', bg: 'bg-amber-600/10' },
  'trending-up': { Icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-600/10' },
  target: { Icon: Target, color: 'text-blue-600', bg: 'bg-blue-600/10' },
  clock: { Icon: Clock, color: 'text-indigo-600', bg: 'bg-indigo-600/10' },
  flame: { Icon: Flame, color: 'text-orange-600', bg: 'bg-orange-600/10' },
  layers: { Icon: Layers, color: 'text-purple-600', bg: 'bg-purple-600/10' },
  sparkles: { Icon: Sparkles, color: 'text-emerald-600', bg: 'bg-emerald-600/10' },
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
        className="p-5 bg-gradient-to-br from-md-surface-container-low via-md-surface-container-low to-md-surface-container/60 border border-md-outline-variant/30 shadow-xs relative overflow-hidden transition-all duration-200"
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
