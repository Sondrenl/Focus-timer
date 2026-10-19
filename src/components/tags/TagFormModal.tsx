import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Tag } from '../../types/tag';
import { useApp } from '../../context/AppContext';

// Curated pastel Material Design 3 palette
const PASTEL_PALETTE = [
  '#7E57C2', // Pastel Deep Purple
  '#5C6BC0', // Pastel Indigo
  '#42A5F5', // Pastel Sky Blue
  '#00897B', // Pastel Teal
  '#66BB6A', // Pastel Green
  '#FFA726', // Pastel Amber / Orange
  '#EC407A', // Pastel Pink / Rose
  '#AB47BC', // Pastel Magenta
  '#7D5260', // Pastel Mauve (M3 Tertiary)
  '#78909C', // Pastel Slate Blue
];

interface TagFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  tagToEdit?: Tag | null;
  onTagSaved?: (tag: Tag) => void;
}

export const TagFormModal: React.FC<TagFormModalProps> = ({
  isOpen,
  onClose,
  tagToEdit,
  onTagSaved,
}) => {
  const { createTag, updateTag } = useApp();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PASTEL_PALETTE[0]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tagToEdit) {
      setName(tagToEdit.name);
      setColor(tagToEdit.color);
    } else {
      setName('');
      setColor(PASTEL_PALETTE[Math.floor(Math.random() * PASTEL_PALETTE.length)]);
    }
    setError('');
  }, [tagToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Tag name is required');
      return;
    }

    try {
      let savedTag: Tag | null;
      if (tagToEdit) {
        savedTag = await updateTag(tagToEdit.id, { name: name.trim(), color });
      } else {
        savedTag = await createTag({ name: name.trim(), color });
      }
      if (savedTag) {
        onTagSaved?.(savedTag);
      }
      onClose();
    } catch (err) {
      console.error('Error saving tag:', err);
      setError('Failed to save tag');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tagToEdit ? 'Edit Focus Tag' : 'Create New Focus Tag'}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 md:gap-5">
        <Input
          label="Tag Name"
          placeholder="e.g. Deep Work, Study, Writing"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          error={error}
          autoFocus
        />

        {/* Color Palette Picker */}
        <div className="flex flex-col gap-1.5 md:gap-2">
          <label className="text-xs font-semibold text-md-on-surface-variant px-1">
            Tag Theme Color
          </label>
          <div className="grid grid-cols-5 gap-2.5 md:gap-3 p-2.5 md:p-3 bg-md-surface-container rounded-2xl border border-md-outline-variant/30 max-md:place-items-center">
            {PASTEL_PALETTE.map((c) => {
              const isSelected = color.toLowerCase() === c.toLowerCase();
              return (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-10 h-10 rounded-full transition-transform duration-150 flex items-center justify-center ${
                    isSelected ? 'scale-110 ring-3 ring-md-primary ring-offset-2 ring-offset-md-surface-container' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                >
                  {isSelected && (
                    <span className="w-2.5 h-2.5 rounded-full bg-white shadow-xs" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 md:gap-3 pt-2.5 md:pt-3 border-t border-md-outline-variant/20">
          <Button type="button" variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="filled">
            {tagToEdit ? 'Save Changes' : 'Create Tag'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
