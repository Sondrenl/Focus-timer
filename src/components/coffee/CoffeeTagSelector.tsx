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
    <TagSelectDropdown
      selectedTagId={selectedTagId}
      onSelectTagId={onSelectTagId}
      variant="coffee"
    />
  );
};
