import React from 'react';
import { useData } from '../../context/DataContext';
import { TagSelectDropdown } from '../tags/TagSelectDropdown';

export const TagSelector: React.FC = () => {
  const { activeTagId, setActiveTagId } = useData();

  return (
    <TagSelectDropdown
      selectedTagId={activeTagId}
      onSelectTagId={setActiveTagId}
      variant="timer"
    />
  );
};
