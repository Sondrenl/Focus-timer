import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Check, Tag as TagIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TagFormModal } from '../tags/TagFormModal';
import { Modal } from '../ui/Modal';

interface CoffeeTagSelectorProps {
  selectedTagId: string | null;
  onSelectTagId: (tagId: string | null) => void;
}

export const CoffeeTagSelector: React.FC<CoffeeTagSelectorProps> = ({
  selectedTagId,
  onSelectTagId,
}) => {
  const { activeTags } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentTag = activeTags.find((t) => t.id === selectedTagId);

  return (
    <div className="flex flex-col md:flex-row items-center gap-1.5 md:gap-2" ref={dropdownRef}>
      <span className="text-xs font-semibold text-md-on-surface-variant select-none max-md:uppercase max-md:tracking-wider">
        <span className="md:hidden">Tag Next Cup</span>
        <span className="hidden md:inline">Tag next cup:</span>
      </span>

      <div className="relative inline-block">
        {/* Trigger Button: Large touch pill on mobile, original compact pill on desktop (md:) */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-3 md:gap-2.5 min-h-[48px] md:min-h-0 px-5 py-2.5 md:px-3.5 md:py-1.5 rounded-2xl md:rounded-full bg-md-surface-container-high md:bg-md-surface-container hover:bg-md-surface-container-highest md:hover:bg-md-surface-container-high transition-all duration-200 border border-md-outline-variant/40 md:border-md-outline-variant/30 text-sm md:text-xs font-semibold text-md-on-surface shadow-xs active:scale-95 md:active:scale-98"
        >
          {currentTag ? (
            <>
              <span
                className="w-3.5 h-3.5 md:w-2.5 md:h-2.5 rounded-full shrink-0 shadow-xs"
                style={{ backgroundColor: currentTag.color }}
              />
              <span className="font-bold text-md-on-surface truncate max-w-[200px] md:max-w-[120px]">
                {currentTag.name}
              </span>
            </>
          ) : (
            <>
              <TagIcon className="w-4 h-4 md:w-3 md:h-3 text-md-outline shrink-0" />
              <span className="font-bold text-md-on-surface">No Tag</span>
            </>
          )}
          <ChevronDown
            className={`w-5 h-5 md:w-3.5 md:h-3.5 text-md-on-surface-variant md:text-md-outline transition-transform duration-200 ${
              isOpen ? 'md:rotate-180' : ''
            }`}
          />
        </button>

        {/* Desktop Dropdown Menu (md and up - identical to original desktop design) */}
        {isOpen && (
          <div className="hidden md:block absolute left-1/2 -translate-x-1/2 mt-2 w-60 bg-md-surface-container-high border border-md-outline-variant/40 rounded-2xl p-1.5 shadow-elevation-2 z-30 animate-in fade-in zoom-in-95 duration-150">
            <div className="text-[11px] font-semibold text-md-on-surface-variant px-3 py-1 uppercase tracking-wider">
              Choose Tag for Cup
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1 py-1">
              {/* No Tag Option */}
              <button
                onClick={() => {
                  onSelectTagId(null);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                  selectedTagId === null
                    ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                    : 'hover:bg-md-surface-container text-md-on-surface'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <TagIcon className="w-3.5 h-3.5 text-md-outline shrink-0" />
                  <span className="truncate">No Tag</span>
                </div>
                {selectedTagId === null && (
                  <span className="text-[10px] text-md-primary font-bold">Active</span>
                )}
              </button>

              {/* Active User Tags */}
              {activeTags.map((tag) => {
                const isSelected = tag.id === selectedTagId;
                return (
                  <button
                    key={tag.id}
                    onClick={() => {
                      onSelectTagId(tag.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                      isSelected
                        ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                        : 'hover:bg-md-surface-container text-md-on-surface'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="truncate">{tag.name}</span>
                    </div>
                    {isSelected && (
                      <span className="text-[10px] text-md-primary font-bold">Active</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="border-t border-md-outline-variant/30 pt-1 mt-1">
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsModalOpen(true);
                }}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-md-primary hover:bg-md-primary/10 transition-colors text-left"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Tag...</span>
              </button>
            </div>
          </div>
        )}

        {/* Mobile Tag Picker Modal (< md only) */}
        <div className="md:hidden">
          <Modal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title="Choose Tag for Cup"
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-2 max-h-[52dvh] overflow-y-auto pr-0.5">
                {/* No Tag Option */}
                <button
                  type="button"
                  onClick={() => {
                    onSelectTagId(null);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between min-h-[52px] px-4 py-3 rounded-2xl text-sm font-semibold transition-all text-left border ${
                    selectedTagId === null
                      ? 'bg-md-primary-container text-md-on-primary-container border-md-primary/40 shadow-xs'
                      : 'bg-md-surface-container hover:bg-md-surface-container-highest text-md-on-surface border-md-outline-variant/25'
                  }`}
                >
                  <div className="flex items-center gap-3.5 truncate">
                    <TagIcon className="w-4 h-4 text-md-outline shrink-0" />
                    <div className="flex flex-col">
                      <span className="truncate">No Tag</span>
                      <span className="text-xs font-normal opacity-75">Log coffee without a tag</span>
                    </div>
                  </div>
                  {selectedTagId === null && (
                    <div className="w-7 h-7 rounded-full bg-md-primary text-md-on-primary flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 stroke-[2.5]" />
                    </div>
                  )}
                </button>

                {/* Active User Tags */}
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
                      className={`w-full flex items-center justify-between min-h-[52px] px-4 py-3 rounded-2xl text-sm font-semibold transition-all text-left border ${
                        isSelected
                          ? 'bg-md-primary-container text-md-on-primary-container border-md-primary/40 shadow-xs'
                          : 'bg-md-surface-container hover:bg-md-surface-container-highest text-md-on-surface border-md-outline-variant/25'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 truncate">
                        <span
                          className="w-4 h-4 rounded-full shrink-0 shadow-xs"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="truncate">{tag.name}</span>
                      </div>
                      {isSelected && (
                        <div className="w-7 h-7 rounded-full bg-md-primary text-md-on-primary flex items-center justify-center shrink-0">
                          <Check className="w-4 h-4 stroke-[2.5]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Prominent Create New Tag Action */}
              <div className="border-t border-md-outline-variant/30 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setIsModalOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2.5 min-h-[48px] px-4 py-3 rounded-2xl text-sm font-bold text-md-primary bg-md-primary/10 hover:bg-md-primary/15 active:scale-98 transition-all"
                >
                  <Plus className="w-5 h-5" />
                  <span>Create New Tag</span>
                </button>
              </div>
            </div>
          </Modal>
        </div>

        {/* Quick Tag Creation Modal */}
        <TagFormModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onTagSaved={(newTag) => onSelectTagId(newTag.id)}
        />
      </div>
    </div>
  );
};
