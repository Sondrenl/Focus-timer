import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TagFormModal } from '../tags/TagFormModal';
import { Modal } from '../ui/Modal';

export const TagSelector: React.FC = () => {
  const { activeTags, activeTagId, setActiveTagId } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close desktop dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentTag = activeTags.find((t) => t.id === activeTagId);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Trigger Button: Larger touch pill on mobile, original pill on desktop (md:) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 md:gap-2.5 min-h-[48px] md:min-h-0 px-5 py-2.5 md:px-4 md:py-2 rounded-2xl md:rounded-full bg-md-surface-container-high hover:bg-md-surface-container-highest transition-all duration-200 border border-md-outline-variant/40 md:border-md-outline-variant/30 text-sm font-semibold md:font-medium text-md-on-surface shadow-xs active:scale-95 md:active:scale-98"
      >
        {currentTag ? (
          <>
            <span
              className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 shadow-xs"
              style={{ backgroundColor: currentTag.color }}
            />
            <span className="font-bold md:font-semibold text-md-on-surface max-w-[200px] md:max-w-none truncate">
              {currentTag.name}
            </span>
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 md:w-3 md:h-3 rounded-full shrink-0 shadow-xs bg-[#8C8690]" />
            <span className="font-bold md:font-semibold text-md-on-surface">Unspecified</span>
          </>
        )}
        <ChevronDown
          className={`w-5 h-5 md:w-4 md:h-4 text-md-on-surface-variant md:text-md-outline transition-transform duration-200 ${
            isOpen ? 'md:rotate-180' : ''
          }`}
        />
      </button>

      {/* Desktop Dropdown Menu (md and up - identical to original desktop design) */}
      {isOpen && (
        <div className="hidden md:block absolute left-1/2 -translate-x-1/2 mt-2 w-64 bg-md-surface-container-high border border-md-outline-variant/40 rounded-2xl p-1.5 shadow-elevation-2 z-30 animate-in fade-in zoom-in-95 duration-150">
          <div className="text-xs font-semibold text-md-on-surface-variant px-3 py-1.5 uppercase tracking-wider">
            Tags
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1 py-1">
            {/* Unspecified (No Tag) option */}
            <button
              onClick={() => {
                setActiveTagId(null);
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTagId === null
                  ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                  : 'hover:bg-md-surface-container text-md-on-surface'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <span className="w-3 h-3 rounded-full shrink-0 bg-[#8C8690]" />
                <span className="truncate">Unspecified</span>
              </div>
              {activeTagId === null && (
                <span className="text-xs text-md-primary font-bold">Active</span>
              )}
            </button>

            {/* Active Tags */}
            {activeTags.map((tag) => {
              const isSelected = tag.id === activeTagId;
              return (
                <button
                  key={tag.id}
                  onClick={() => {
                    setActiveTagId(tag.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors text-left ${
                    isSelected
                      ? 'bg-md-primary-container text-md-on-primary-container font-semibold'
                      : 'hover:bg-md-surface-container text-md-on-surface'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </div>
                  {isSelected && (
                    <span className="text-xs text-md-primary font-bold">Active</span>
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
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-md-primary hover:bg-md-primary/10 transition-colors text-left"
            >
              <Plus className="w-4 h-4" />
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
          title="Select Focus Tag"
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-2 max-h-[52dvh] overflow-y-auto pr-0.5">
              {/* Unspecified (No Tag) Option */}
              <button
                type="button"
                onClick={() => {
                  setActiveTagId(null);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between min-h-[52px] px-4 py-3 rounded-2xl text-sm font-semibold transition-all text-left border ${
                  activeTagId === null
                    ? 'bg-md-primary-container text-md-on-primary-container border-md-primary/40 shadow-xs'
                    : 'bg-md-surface-container hover:bg-md-surface-container-highest text-md-on-surface border-md-outline-variant/25'
                }`}
              >
                <div className="flex items-center gap-3.5 truncate">
                  <span className="w-4 h-4 rounded-full shrink-0 bg-[#8C8690]" />
                  <div className="flex flex-col">
                    <span className="truncate">Unspecified</span>
                    <span className="text-xs font-normal opacity-75">Focus without a specific tag</span>
                  </div>
                </div>
                {activeTagId === null && (
                  <div className="w-7 h-7 rounded-full bg-md-primary text-md-on-primary flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 stroke-[2.5]" />
                  </div>
                )}
              </button>

              {/* Active Tags */}
              {activeTags.map((tag) => {
                const isSelected = tag.id === activeTagId;
                return (
                  <button
                    type="button"
                    key={tag.id}
                    onClick={() => {
                      setActiveTagId(tag.id);
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
        onTagSaved={(newTag) => setActiveTagId(newTag.id)}
      />
    </div>
  );
};
