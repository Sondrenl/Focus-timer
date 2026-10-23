import React, { useState, useMemo } from 'react';
import { Coffee, Plus, Minus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CoffeeTagSelector } from './CoffeeTagSelector';
import { toDateKey, formatFriendlyDate } from '../../utils/dates';

export const CoffeeWorkspace: React.FC = () => {
  const { coffeeCups, addCoffeeCup, removeCoffeeCup, activeTags, tags } = useApp();
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState<Date>(() => new Date());

  const viewDateKey = toDateKey(viewDate);
  const isToday = viewDateKey === toDateKey(new Date());

  // Filter cups for the selected date
  const cupsForDate = useMemo(() => {
    return coffeeCups.filter((c) => c.date === viewDateKey);
  }, [coffeeCups, viewDateKey]);

  const totalCount = cupsForDate.length;

  const currentTag = activeTags.find((t) => t.id === selectedTagId);
  const currentTagColor = currentTag ? currentTag.color : '#8D6E63';
  const currentTagName = currentTag ? currentTag.name : 'No Tag';

  // Compute breakdown of cups by tag for this date
  const tagBreakdown = useMemo(() => {
    const counts = new Map<string | null, number>();
    cupsForDate.forEach((c) => {
      const tid = c.tagId || null;
      counts.set(tid, (counts.get(tid) || 0) + 1);
    });

    const list: { tagId: string | null; name: string; color: string; count: number }[] = [];
    counts.forEach((count, tid) => {
      if (tid === null) {
        list.push({ tagId: null, name: 'No Tag', color: '#8D6E63', count });
      } else {
        const found = tags.find((t) => t.id === tid);
        list.push({
          tagId: tid,
          name: found ? found.name : 'Unknown Tag',
          color: found ? found.color : '#9E9E9E',
          count,
        });
      }
    });

    return list.sort((a, b) => b.count - a.count);
  }, [cupsForDate, tags]);

  const handleAdd = async () => {
    await addCoffeeCup(selectedTagId, viewDateKey);
  };

  const handleRemove = async () => {
    if (totalCount <= 0) return;

    // Prioritize removing cup of the selected tag if one exists on this date
    const cupsOfSelectedTag = cupsForDate.filter((c) => (selectedTagId ? c.tagId === selectedTagId : !c.tagId));
    const targetCup =
      cupsOfSelectedTag.length > 0
        ? cupsOfSelectedTag[cupsOfSelectedTag.length - 1]
        : cupsForDate[cupsForDate.length - 1];

    if (!targetCup) return;

    await removeCoffeeCup(viewDateKey, targetCup.tagId, targetCup.id);
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
      {/* 1. Top Tag Selector for Next Cup */}
      <div className="w-full flex flex-col items-center mb-5 md:mb-4">
        <CoffeeTagSelector
          selectedTagId={selectedTagId}
          onSelectTagId={setSelectedTagId}
        />
      </div>

      {/* 2. Date Switcher (Desktop only - hidden on mobile as requested) */}
      <div className="hidden md:flex items-center gap-2 mb-4 bg-md-surface-container rounded-2xl p-1 border border-md-outline-variant/30 text-xs font-semibold shadow-xs">
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

      {/* 3. Central Coffee Hero Circle (Permanent Coffee Theme - does not change to tag color) */}
      <div className="relative flex flex-col items-center justify-center my-2 select-none">
        <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
          {/* Subtle Neutral Coffee Outer Track Ring */}
          <div className="w-full h-full rounded-full border-[10px] border-[#795548]/25 bg-[#795548]/05 flex items-center justify-center transition-all duration-300 shadow-sm">
            {/* Center Content Stack */}
            <div className="flex flex-col items-center justify-center text-center px-4">
              {/* Coffee Icon */}
              <div className="w-14 h-14 rounded-2xl bg-[#795548]/15 text-[#795548] flex items-center justify-center mb-1.5 shadow-xs">
                <Coffee className="w-7 h-7" />
              </div>

              {/* Total Cups Number */}
              <div className="text-6xl md:text-7xl font-extrabold text-md-on-surface tracking-tighter tabular-nums font-mono drop-shadow-xs">
                {totalCount}
              </div>

              <div className="text-xs font-bold text-md-on-surface-variant mt-0.5 uppercase tracking-wider">
                {totalCount === 1 ? 'Cup Total' : 'Cups Total'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Controls */}
      <div className="flex items-center justify-center gap-6 mt-4 mb-4">
        {/* Left: Minus Button */}
        <button
          onClick={handleRemove}
          disabled={totalCount <= 0}
          title="Remove cup"
          className={`flex items-center justify-center w-16 h-16 md:w-14 md:h-14 rounded-full transition-all duration-200 active:scale-95 shadow-xs ${
            totalCount <= 0
              ? 'bg-md-surface-container text-md-outline/40 cursor-not-allowed'
              : 'bg-md-surface-container-high hover:bg-md-surface-container-highest text-md-on-surface-variant hover:text-md-on-surface'
          }`}
          aria-label="Remove cup of coffee"
        >
          <Minus className="w-7 h-7 md:w-6 md:h-6" />
        </button>

        {/* Center: Add Button (Hero FAB showing next cup tag indicator) */}
        <button
          onClick={handleAdd}
          className="flex items-center justify-center w-20 h-20 rounded-full text-white shadow-elevation-2 hover:shadow-elevation-3 transition-all duration-200 active:scale-95 group relative"
          style={{ backgroundColor: currentTagColor }}
          aria-label={`Add cup of coffee with tag ${currentTagName}`}
          title={`Add cup (${currentTagName})`}
        >
          <Plus className="w-9 h-9 stroke-[2.5]" />
        </button>
      </div>

      {/* 5. Visual Cup Tray (Color-coded cups logged today - below controls) */}
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 md:gap-1.5 max-w-sm mb-3 px-3 py-2 md:px-2 md:py-1.5 rounded-2xl bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
          {cupsForDate.map((cup, idx) => {
            const cupTag = tags.find((t) => t.id === cup.tagId);
            const cupColor = cupTag ? cupTag.color : '#8D6E63';
            const cupName = cupTag ? cupTag.name : 'No Tag';

            return (
              <div
                key={cup.id}
                className="flex items-center justify-center w-8 h-8 md:w-7 md:h-7 rounded-xl transition-transform hover:scale-115 cursor-help"
                style={{ backgroundColor: `${cupColor}20` }}
                title={`Cup #${idx + 1}: ${cupName}`}
              >
                <Coffee className="w-4 h-4" style={{ color: cupColor }} />
              </div>
            );
          })}
        </div>
      )}

      {/* 6. Tag Breakdown Chips for Today */}
      <div className="w-full flex flex-col items-center mb-2">
        {tagBreakdown.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
            {tagBreakdown.map((item) => {
              const isSelected = selectedTagId === item.tagId;
              return (
                <button
                  key={item.name}
                  onClick={() => setSelectedTagId(item.tagId)}
                  className={`flex items-center gap-2 md:gap-1.5 min-h-[40px] md:min-h-0 px-3.5 py-1.5 md:px-2.5 md:py-1 rounded-full text-xs font-semibold transition-all border ${
                    isSelected
                      ? 'border-md-primary bg-md-primary/10 shadow-xs'
                      : 'border-md-outline-variant/30 bg-md-surface-container hover:bg-md-surface-container-high'
                  }`}
                  title={`Click to set next cup tag to ${item.name}`}
                >
                  <span
                    className="w-2.5 h-2.5 md:w-2 md:h-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-md-on-surface">{item.name}:</span>
                  <span className="font-bold text-md-on-surface">{item.count}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-md-outline">
            No coffee logged for this day yet.
          </span>
        )}
      </div>

      {/* Bottom Cue */}
      <div className="text-[11px] text-md-outline mt-5 select-none text-center">
        Tapping <kbd className="font-mono px-1 py-0.5 rounded bg-md-surface-container border border-md-outline-variant/30 text-md-on-surface">+</kbd> logs a cup with <span className="font-bold text-md-on-surface">{currentTagName}</span>
      </div>
    </div>
  );
};
