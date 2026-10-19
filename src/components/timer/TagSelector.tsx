import React, { useState } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TagFormModal } from '../tags/TagFormModal';
import { Modal } from '../ui/Modal';

export const TagSelector: React.FC = () => {
  const { activeTags, activeTagId, setActiveTagId } = useApp();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const currentTag = activeTags.find((t) => t.id === activeTagId);

  return (
    <div className="inline-flex flex-col items-center">
      {/* Large Mobile-Friendly Trigger Pill */}
      <button
        type="button"
        onClick={() => setIsPickerOpen(true)}
        className="flex items-center gap-3 min-h-[48px] px-5 py-2.5 rounded-2xl bg-md-surface-container-high hover:bg-md-surface-container-highest transition-all duration-200 border border-md-outline-variant/40 text-sm sm:text-base font-semibold text-md-on-surface shadow-xs active:scale-95"
      >
        {currentTag ? (
          <>
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs"
              style={{ backgroundColor: currentTag.color }}
            />
            <span className="font-bold text-md-on-surface max-w-[200px] truncate">
              {currentTag.name}
            </span>
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs bg-[#8C8690]" />
            <span className="font-bold text-md-on-surface">Unspecified</span>
          </>
        )}
        <ChevronDown className="w-5 h-5 text-md-on-surface-variant ml-0.5 shrink-0" />
      </button>

      {/* Mobile-Friendly Tag Picker Modal */}
      <Modal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        title="Select Focus Tag"
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 max-h-[52dvh] overflow-y-auto pr-0.5">
            {/* Unspecified (No Tag) Option */}
            <button
              type="button"
              onClick={() => {
                setActiveTagId(null);
                setIsPickerOpen(false);
              }}
              className={`w-full flex items-center justify-between min-h-[52px] px-4 py-3 rounded-2xl text-sm sm:text-base font-semibold transition-all text-left border ${
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
                    setIsPickerOpen(false);
                  }}
                  className={`w-full flex items-center justify-between min-h-[52px] px-4 py-3 rounded-2xl text-sm sm:text-base font-semibold transition-all text-left border ${
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
                setIsPickerOpen(false);
                setIsCreateModalOpen(true);
              }}
              className="w-full flex items-center justify-center gap-2.5 min-h-[48px] px-4 py-3 rounded-2xl text-sm sm:text-base font-bold text-md-primary bg-md-primary/10 hover:bg-md-primary/15 active:scale-98 transition-all"
            >
              <Plus className="w-5 h-5" />
              <span>Create New Tag</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Quick Tag Creation Modal */}
      <TagFormModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onTagSaved={(newTag) => setActiveTagId(newTag.id)}
      />
    </div>
  );
};
