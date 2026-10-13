import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TagFormModal } from '../tags/TagFormModal';

export const TagSelector: React.FC = () => {
  const { activeTags, activeTagId, setActiveTagId } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
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
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-md-surface-container-high hover:bg-md-surface-container-highest transition-all duration-200 border border-md-outline-variant/30 text-sm font-medium text-md-on-surface shadow-xs active:scale-98"
      >
        {currentTag ? (
          <>
            <span
              className="w-3 h-3 rounded-full shrink-0 shadow-xs"
              style={{ backgroundColor: currentTag.color }}
            />
            <span className="font-semibold text-md-on-surface">{currentTag.name}</span>
          </>
        ) : (
          <>
            <span className="w-3 h-3 rounded-full shrink-0 shadow-xs bg-[#8C8690]" />
            <span className="font-semibold text-md-on-surface">Unspecified</span>
          </>
        )}
        <ChevronDown
          className={`w-4 h-4 text-md-outline transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-64 bg-md-surface-container-high border border-md-outline-variant/40 rounded-2xl p-1.5 shadow-elevation-2 z-30 animate-in fade-in zoom-in-95 duration-150">
          <div className="text-xs font-semibold text-md-on-surface-variant px-3 py-1.5 uppercase tracking-wider">
            Focus Category
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

      {/* Quick Tag Creation Modal */}
      <TagFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
};
