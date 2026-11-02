import React from 'react';
import { useApp } from '../../context/AppContext';
import { TagSelectDropdown } from '../tags/TagSelectDropdown';

export const TagSelector: React.FC = () => {
  const { activeTagId, setActiveTagId } = useApp();

  return (
    <TagSelectDropdown
      selectedTagId={activeTagId}
      onSelectTagId={setActiveTagId}
      variant="timer"
    />
  );
};
