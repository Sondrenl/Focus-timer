import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { TagSelectDropdown } from '../tags/TagSelectDropdown';

export interface CoffeeTagSelectorProps {
  selectedTagId?: string | null;
  onSelectTagId?: (tagId: string | null) => void;
}

export const CoffeeTagSelector: React.FC<CoffeeTagSelectorProps> = ({
  selectedTagId: controlledSelectedTagId,
  onSelectTagId: controlledOnSelectTagId,
}) => {
  const { activeTagId } = useApp();
  const [internalTagId, setInternalTagId] = useState<string | null>(activeTagId);

  // Keep internal state synchronized with timer activeTagId
  useEffect(() => {
    setInternalTagId(activeTagId);
  }, [activeTagId]);

  const selectedTagId =
    controlledSelectedTagId !== undefined ? controlledSelectedTagId : internalTagId;
  const onSelectTagId = controlledOnSelectTagId || setInternalTagId;

  return (
    <div className="flex flex-col md:flex-row items-center gap-1.5 md:gap-2">
      <span className="text-xs font-semibold text-md-on-surface-variant select-none max-md:uppercase max-md:tracking-wider">
        <span className="md:hidden">Tag Next Cup</span>
        <span className="hidden md:inline">Tag next cup:</span>
      </span>

      <TagSelectDropdown
        selectedTagId={selectedTagId}
        onSelectTagId={onSelectTagId}
        variant="coffee"
      />
    </div>
  );
};
