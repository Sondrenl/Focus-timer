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
} from 'lucide-react';

interface SmartInsightPanelProps {
  insights: InterestingStat[];
}

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

  const renderIcon = (name: InterestingStat['iconName']) => {
    switch (name) {
      case 'coffee':
        return <Coffee className="w-5 h-5 text-amber-700" />;
      case 'zap':
        return <Zap className="w-5 h-5 text-amber-600" />;
      case 'trending-up':
        return <TrendingUp className="w-5 h-5 text-emerald-600" />;
      case 'target':
        return <Target className="w-5 h-5 text-blue-600" />;
      case 'clock':
        return <Clock className="w-5 h-5 text-indigo-600" />;
      case 'flame':
        return <Flame className="w-5 h-5 text-orange-600" />;
      case 'layers':
        return <Layers className="w-5 h-5 text-purple-600" />;
      case 'sparkles':
      default:
        return <Sparkles className="w-5 h-5 text-emerald-600" />;
    }
  };

  const getIconBg = (name: InterestingStat['iconName']) => {
    switch (name) {
      case 'coffee':
        return 'bg-amber-700/10';
      case 'zap':
        return 'bg-amber-600/10';
      case 'trending-up':
        return 'bg-emerald-600/10';
      case 'target':
        return 'bg-blue-600/10';
      case 'clock':
        return 'bg-indigo-600/10';
      case 'flame':
        return 'bg-orange-600/10';
      case 'layers':
        return 'bg-purple-600/10';
      case 'sparkles':
      default:
        return 'bg-emerald-600/10';
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-bold text-md-on-surface tracking-wide uppercase">
            Insight
          </h3>
        </div>

        {insights.length > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-md-on-surface-variant font-medium">
            <span>
              {safeIndex + 1} of {insights.length}
            </span>
            <div className="flex items-center gap-1 ml-1">
              <button
                type="button"
                onClick={handlePrev}
                aria-label="Previous insight"
                className="w-7 h-7 rounded-full flex items-center justify-center bg-md-surface-container hover:bg-md-surface-container-high active:scale-95 transition-all text-md-on-surface-variant hover:text-md-on-surface"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                aria-label="Next insight"
                className="w-7 h-7 rounded-full flex items-center justify-center bg-md-surface-container hover:bg-md-surface-container-high active:scale-95 transition-all text-md-on-surface-variant hover:text-md-on-surface"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Card
        variant="filled"
        className="p-5 bg-gradient-to-br from-md-surface-container-low via-md-surface-container-low to-md-surface-container/60 border border-md-outline-variant/30 shadow-xs relative overflow-hidden transition-all duration-200"
      >
        <div className="flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${getIconBg(
              currentInsight.iconName
            )}`}
          >
            {renderIcon(currentInsight.iconName)}
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
