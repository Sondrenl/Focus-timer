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
  unassignedLabel = variant === 'coffee' ? 'No Tag' : 'Unspecified',
  unassignedIcon = variant === 'coffee' ? 'tag' : 'dot',
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
  const isCoffee = variant === 'coffee';

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex items-center gap-3 md:gap-2.5 min-h-[48px] md:min-h-0 rounded-2xl md:rounded-full transition-colors duration-150 border text-sm font-semibold text-md-on-surface shadow-xs select-none touch-manipulation',
          isCoffee
            ? 'px-5 py-2.5 md:px-3.5 md:py-1.5 md:text-xs'
            : 'px-5 py-2.5 md:px-4 md:py-2 md:font-medium',
          isOpen
            ? 'bg-md-surface-container-highest border-md-primary/40'
            : isCoffee
            ? 'bg-md-surface-container-high md:bg-md-surface-container md:hover:bg-md-surface-container-high active:bg-md-surface-container-highest border-md-outline-variant/40 md:border-md-outline-variant/30'
            : 'bg-md-surface-container-high md:hover:bg-md-surface-container-highest active:bg-md-surface-container-highest border-md-outline-variant/40 md:border-md-outline-variant/30'
        )}
      >
        {currentTag ? (
          <>
            <span
              className={clsx(
                'rounded-full shrink-0 shadow-xs',
                isCoffee ? 'w-3.5 h-3.5 md:w-2.5 md:h-2.5' : 'w-3.5 h-3.5 md:w-3 md:h-3'
              )}
              style={{ backgroundColor: currentTag.color }}
            />
            <span
              className={clsx(
                'font-bold text-md-on-surface truncate',
                isCoffee ? 'max-w-[200px] md:max-w-[120px]' : 'md:font-semibold max-w-[200px] md:max-w-none'
              )}
            >
              {currentTag.name}
            </span>
          </>
        ) : (
          <>
            {unassignedIcon === 'tag' ? (
              <TagIcon className="w-4 h-4 md:w-3 md:h-3 text-md-outline shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 shadow-xs bg-[#8C8690]" />
            )}
            <span className={clsx('font-bold text-md-on-surface', !isCoffee && 'md:font-semibold')}>
              {unassignedLabel}
            </span>
          </>
        )}
        <ChevronDown
          className={clsx(
            'text-md-on-surface-variant md:text-md-outline transition-transform duration-200',
            isCoffee ? 'w-5 h-5 md:w-3.5 md:h-3.5' : 'w-5 h-5 md:w-4 md:h-4',
            isOpen ? 'rotate-180' : ''
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={clsx(
            'absolute left-1/2 -translate-x-1/2 mt-2 bg-md-surface-container-high border border-md-outline-variant/40 rounded-2xl p-2 md:p-1.5 shadow-elevation-2 z-30',
            isCoffee
              ? 'w-[min(calc(100vw-32px),19rem)] md:w-60'
              : 'w-[min(calc(100vw-32px),20rem)] md:w-64'
          )}
        >
          <div
            className={clsx(
              'font-semibold text-md-on-surface-variant uppercase tracking-wider',
              isCoffee ? 'text-xs md:text-[11px] px-3 py-2 md:py-1' : 'text-xs px-3 py-2 md:py-1.5'
            )}
          >
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
                'w-full flex items-center justify-between min-h-[48px] md:min-h-0 px-3.5 py-3 md:px-3 md:py-2 rounded-xl font-medium transition-colors text-left touch-manipulation select-none',
                isCoffee ? 'text-sm md:text-xs' : 'text-sm',
                selectedTagId === null
                  ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                  : 'hover:bg-md-surface-container text-md-on-surface active:bg-md-surface-container'
              )}
            >
              <div className={clsx('flex items-center truncate', isCoffee ? 'gap-2.5 md:gap-2' : 'gap-3 md:gap-2.5')}>
                {unassignedIcon === 'tag' ? (
                  <TagIcon className="w-4 h-4 md:w-3.5 md:h-3.5 text-md-outline shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 bg-[#8C8690]" />
                )}
                <span className="truncate">{unassignedLabel}</span>
              </div>
              {selectedTagId === null && (
                <span className={clsx('text-md-primary font-bold', isCoffee ? 'text-xs md:text-[10px]' : 'text-xs')}>
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
                    'w-full flex items-center justify-between min-h-[48px] md:min-h-0 px-3.5 py-3 md:px-3 md:py-2 rounded-xl font-medium transition-colors text-left touch-manipulation select-none',
                    isCoffee ? 'text-sm md:text-xs' : 'text-sm',
                    isSelected
                      ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                      : 'hover:bg-md-surface-container text-md-on-surface active:bg-md-surface-container'
                  )}
                >
                  <div className={clsx('flex items-center truncate', isCoffee ? 'gap-2.5 md:gap-2' : 'gap-3 md:gap-2.5')}>
                    <span
                      className={clsx(
                        'rounded-full shrink-0 shadow-xs',
                        isCoffee ? 'w-3.5 h-3.5 md:w-2.5 md:h-2.5' : 'w-3.5 h-3.5 md:w-3 md:h-3'
                      )}
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </div>
                  {isSelected && (
                    <span className={clsx('text-md-primary font-bold', isCoffee ? 'text-xs md:text-[10px]' : 'text-xs')}>
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
              className={clsx(
                'w-full flex items-center min-h-[44px] md:min-h-0 font-semibold text-md-primary hover:bg-md-primary/10 active:bg-md-primary/15 transition-colors text-left touch-manipulation select-none',
                isCoffee
                  ? 'gap-2 md:gap-1.5 px-3.5 py-2.5 md:px-3 md:py-1.5 text-sm md:text-xs'
                  : 'gap-2.5 md:gap-2 px-3.5 py-2.5 md:px-3 md:py-2 text-sm md:text-xs'
              )}
            >
              <Plus className={clsx(isCoffee ? 'w-4 h-4 md:w-3.5 md:h-3.5' : 'w-4 h-4')} />
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
