import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Tag as TagIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TagFormModal } from './TagFormModal';
import { clsx } from 'clsx';

export interface TagSelectDropdownProps {
  selectedTagId: string | null;
  onSelectTagId: (tagId: string | null) => void;
  variant?: 'timer' | 'coffee';
  unassignedLabel?: string;
  unassignedIcon?: 'dot' | 'tag';
  menuTitle?: string;
}

export const TagSelectDropdown: React.FC<TagSelectDropdownProps> = ({
  selectedTagId,
  onSelectTagId,
  variant = 'timer',
  unassignedLabel = 'No Tag',
  unassignedIcon = 'tag',
  menuTitle = variant === 'coffee' ? 'Choose Tag for Cup' : 'Tags',
}) => {
  const { activeTags } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent | PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const currentTag = activeTags.find((t) => t.id === selectedTagId);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex items-center gap-3 md:gap-2.5 min-h-[48px] md:min-h-0 px-5 py-2.5 md:px-4 md:py-2 rounded-2xl md:rounded-full transition-colors duration-150 border text-sm font-semibold md:font-medium text-md-on-surface shadow-xs select-none touch-manipulation',
          isOpen
            ? 'bg-md-surface-container-highest border-md-primary/40'
            : 'bg-md-surface-container-high md:hover:bg-md-surface-container-highest active:bg-md-surface-container-highest border-md-outline-variant/40 md:border-md-outline-variant/30'
        )}
      >
        {currentTag ? (
          <>
            <span
              className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 shadow-xs"
              style={{ backgroundColor: currentTag.color }}
            />
            <span className="font-bold md:font-semibold text-md-on-surface truncate max-w-[200px] md:max-w-none">
              {currentTag.name}
            </span>
          </>
        ) : (
          <>
            {unassignedIcon === 'tag' ? (
              <TagIcon className="w-4 h-4 md:w-3.5 md:h-3.5 text-md-outline shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 shadow-xs bg-[#8C8690]" />
            )}
            <span className="font-bold md:font-semibold text-md-on-surface">
              {unassignedLabel}
            </span>
          </>
        )}
        <ChevronDown
          className={clsx(
            'w-5 h-5 md:w-4 md:h-4 text-md-on-surface-variant md:text-md-outline transition-transform duration-200',
            isOpen ? 'rotate-180' : ''
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-[min(calc(100vw-32px),20rem)] md:w-64 bg-md-surface-container-high border border-md-outline-variant/40 rounded-2xl p-2 md:p-1.5 shadow-elevation-2 z-30">
          <div className="text-xs font-semibold text-md-on-surface-variant uppercase tracking-wider px-3 py-2 md:py-1.5">
            {menuTitle}
          </div>

          <div className="max-h-64 md:max-h-56 overflow-y-auto space-y-1 py-1">
            {/* Unassigned / No Tag Option */}
            <button
              type="button"
              onClick={() => {
                onSelectTagId(null);
                setIsOpen(false);
              }}
              className={clsx(
                'w-full flex items-center justify-between min-h-[48px] md:min-h-0 px-3.5 py-3 md:px-3 md:py-2 rounded-xl text-sm font-medium transition-colors text-left touch-manipulation select-none',
                selectedTagId === null
                  ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                  : 'hover:bg-md-surface-container text-md-on-surface active:bg-md-surface-container'
              )}
            >
              <div className="flex items-center gap-3 md:gap-2.5 truncate">
                {unassignedIcon === 'tag' ? (
                  <TagIcon className="w-4 h-4 md:w-3.5 md:h-3.5 text-md-outline shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 bg-[#8C8690]" />
                )}
                <span className="truncate">{unassignedLabel}</span>
              </div>
              {selectedTagId === null && (
                <span className="text-xs text-md-primary font-bold">
                  Active
                </span>
              )}
            </button>

            {/* Active Tags */}
            {activeTags.map((tag) => {
              const isSelected = tag.id === selectedTagId;
              return (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => {
                    onSelectTagId(tag.id);
                    setIsOpen(false);
                  }}
                  className={clsx(
                    'w-full flex items-center justify-between min-h-[48px] md:min-h-0 px-3.5 py-3 md:px-3 md:py-2 rounded-xl text-sm font-medium transition-colors text-left touch-manipulation select-none',
                    isSelected
                      ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                      : 'hover:bg-md-surface-container text-md-on-surface active:bg-md-surface-container'
                  )}
                >
                  <div className="flex items-center gap-3 md:gap-2.5 truncate">
                    <span
                      className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </div>
                  {isSelected && (
                    <span className="text-xs text-md-primary font-bold">
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-md-outline-variant/30 pt-1.5 md:pt-1 mt-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setIsModalOpen(true);
              }}
              className="w-full flex items-center gap-2.5 md:gap-2 min-h-[44px] md:min-h-0 px-3.5 py-2.5 md:px-3 md:py-2 rounded-xl text-sm md:text-xs font-semibold text-md-primary hover:bg-md-primary/10 active:bg-md-primary/15 transition-colors text-left touch-manipulation select-none"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Tag...</span>
            </button>
          </div>
        </div>
      )}

      {/* Quick Tag Creation Modal */}
      <TagFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onTagSaved={(newTag) => onSelectTagId(newTag.id)}
      />
    </div>
  );
};
