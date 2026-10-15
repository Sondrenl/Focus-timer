import React, { useState, useMemo } from 'react';
import { Coffee, Plus, Minus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CoffeeTagSelector } from './CoffeeTagSelector';
import { toDateKey, formatFriendlyDate } from '../../utils/dates';

export const CoffeeWorkspace: React.FC = () => {
  const { coffeeCups, addCoffeeCup, removeCoffeeCup, activeTags } = useApp();
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState<Date>(() => new Date());

  const viewDateKey = toDateKey(viewDate);
  const isToday = viewDateKey === toDateKey(new Date());

  // Filter cups for the selected date
  const cupsForDate = useMemo(() => {
    return coffeeCups.filter((c) => c.date === viewDateKey);
  }, [coffeeCups, viewDateKey]);

  const count = cupsForDate.length;

  const currentTag = activeTags.find((t) => t.id === selectedTagId);
  const accentColor = currentTag ? currentTag.color : '#8D6E63'; // Warm coffee tone by default

  const handleAdd = async () => {
    await addCoffeeCup(selectedTagId, viewDateKey);
  };

  const handleRemove = async () => {
    if (count <= 0) return;
    await removeCoffeeCup(viewDateKey, selectedTagId);
  };

  const goToPrevDay = () => {
    setViewDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  };

  const goToNextDay = () => {
    setViewDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  };

  const goToToday = () => {
    setViewDate(new Date());
  };

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center justify-center py-6 px-4">
      {/* Top Tag Selector for Coffee */}
      <div className="w-full flex flex-col items-center mb-4">
        <CoffeeTagSelector
          selectedTagId={selectedTagId}
          onSelectTagId={setSelectedTagId}
        />
      </div>

      {/* Date Switcher */}
      <div className="flex items-center gap-2 mb-4 bg-md-surface-container rounded-2xl p-1 border border-md-outline-variant/30 text-xs font-semibold shadow-xs">
        <button
          onClick={goToPrevDay}
          className="p-1.5 rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high transition-colors"
          title="Previous day"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          onClick={goToToday}
          className="px-3 py-1 rounded-xl text-md-on-surface hover:text-md-primary transition-colors text-center"
        >
          {isToday ? 'Today, ' : ''}
          {formatFriendlyDate(viewDate, true)}
        </button>

        <button
          onClick={goToNextDay}
          disabled={isToday}
          className={`p-1.5 rounded-xl transition-colors ${
            isToday
              ? 'text-md-outline/40 cursor-not-allowed'
              : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high'
          }`}
          title="Next day"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Central Coffee Hero Circle (matches TimerDisplay layout) */}
      <div className="relative flex flex-col items-center justify-center my-4 select-none">
        <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
          {/* Subtle Outer Track Ring */}
          <div
            className="w-full h-full rounded-full border-[10px] flex items-center justify-center transition-all duration-300 shadow-sm"
            style={{
              borderColor: `${accentColor}30`,
              backgroundColor: `${accentColor}08`,
            }}
          >
            {/* Center Content Stack */}
            <div className="flex flex-col items-center justify-center text-center">
              {/* Coffee Icon */}
              <div
                className="w-16 h-16 rounded-3xl flex items-center justify-center mb-2 shadow-xs transition-transform duration-300 hover:scale-105"
                style={{
                  backgroundColor: `${accentColor}20`,
                  color: accentColor,
                }}
              >
                <Coffee className="w-8 h-8" />
              </div>

              {/* Number of Cups */}
              <div className="text-6xl md:text-7xl font-extrabold text-md-on-surface tracking-tighter tabular-nums font-mono drop-shadow-xs">
                {count}
              </div>

              <div className="text-sm font-bold text-md-on-surface-variant mt-1">
                {count === 1 ? 'cup' : 'cups'} {isToday ? 'today' : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Coffee Controls (matches TimerControls layout) */}
      <div className="flex items-center justify-center gap-6 mt-4">
        {/* Left: Minus Button */}
        <button
          onClick={handleRemove}
          disabled={count <= 0}
          title="Remove a cup"
          className={`flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200 active:scale-95 shadow-xs ${
            count <= 0
              ? 'bg-md-surface-container text-md-outline/40 cursor-not-allowed'
              : 'bg-md-surface-container-high hover:bg-md-surface-container-highest text-md-on-surface-variant hover:text-md-on-surface'
          }`}
          aria-label="Remove a cup of coffee"
        >
          <Minus className="w-6 h-6" />
        </button>

        {/* Center: Add Button (Large Hero M3 FAB) */}
        <button
          onClick={handleAdd}
          className="flex items-center justify-center w-20 h-20 rounded-full text-white shadow-elevation-2 hover:shadow-elevation-3 transition-all duration-200 active:scale-95 text-lg group"
          style={{ backgroundColor: accentColor }}
          aria-label="Add a cup of coffee"
        >
          <Plus className="w-9 h-9 stroke-[2.5]" />
        </button>
      </div>

      {/* Helpful Hint */}
      <div className="text-xs text-md-outline mt-6 select-none text-center">
        {currentTag ? (
          <span>
            Logging for <span className="font-semibold text-md-on-surface">{currentTag.name}</span>
          </span>
        ) : (
          <span>Logging without a tag</span>
        )}
      </div>
    </div>
  );
};
