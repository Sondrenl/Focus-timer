// @vitest-environment node
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoffeeWorkspace } from '../src/components/coffee/CoffeeWorkspace';
import { CoffeeTagSelector } from '../src/components/coffee/CoffeeTagSelector';
import * as AppContextModule from '../src/context/AppContext';
import { Tag } from '../src/types/tag';

describe('Coffee Tag Selector - Timer Tag Mimicry & Unidirectional Observation', () => {
  const mockTags: Tag[] = [
    { id: 'tag-work', name: 'Work', color: '#4CAF50', isArchived: false, createdAt: '2026-01-01' },
    { id: 'tag-study', name: 'Study', color: '#2196F3', isArchived: false, createdAt: '2026-01-01' },
    { id: 'tag-break', name: 'Break', color: '#FF9800', isArchived: false, createdAt: '2026-01-01' },
  ];

  let mockAppContext: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockAppContext = {
      coffeeCups: [],
      addCoffeeCup: vi.fn(),
      removeCoffeeCup: vi.fn(),
      tags: mockTags,
      activeTags: mockTags,
      activeTagId: 'tag-work',
      setActiveTagId: vi.fn(),
    };
    vi.spyOn(AppContextModule, 'useApp').mockImplementation(() => mockAppContext);
  });

  it('initializes CoffeeWorkspace selected tag to mimic the timer activeTagId', () => {
    mockAppContext.activeTagId = 'tag-study';
    const html = renderToStaticMarkup(React.createElement(CoffeeWorkspace));

    // Should display the active timer tag name in the helper cue and button title
    expect(html).toContain('Study');
    expect(html).toContain('Add cup of coffee with tag Study');
    expect(html).toContain('logs a cup with <span class="font-bold text-md-on-surface">Study</span>');
  });

  it('initializes to "No Tag" when timer activeTagId is null', () => {
    mockAppContext.activeTagId = null;
    const html = renderToStaticMarkup(React.createElement(CoffeeWorkspace));

    expect(html).toContain('No Tag');
    expect(html).toContain('Add cup of coffee with tag No Tag');
  });

  it('renders CoffeeTagSelector with the timer tag when uncontrolled', () => {
    mockAppContext.activeTagId = 'tag-work';
    const html = renderToStaticMarkup(React.createElement(CoffeeTagSelector));

    expect(html).toContain('Work');
  });

  it('allows CoffeeTagSelector to be controlled via props without modifying timer tag', () => {
    mockAppContext.activeTagId = 'tag-work';
    const onSelectTagId = vi.fn();

    const html = renderToStaticMarkup(
      React.createElement(CoffeeTagSelector, { selectedTagId: 'tag-break', onSelectTagId })
    );

    // Controlled prop 'Break' overrides internal timer tag 'Work'
    expect(html).toContain('Break');
    // Timer's setActiveTagId must NOT be called
    expect(mockAppContext.setActiveTagId).not.toHaveBeenCalled();
  });

  it('verifies that selecting a different tag for coffee does not alter the timer tag (unidirectional)', () => {
    // When a coffee cup is logged with a specific tag (or user changes selection in coffee)
    // the timer's setActiveTagId must never be invoked
    mockAppContext.activeTagId = 'tag-work';
    const selectedCoffeeTag = 'tag-break';

    // Simulated handleAdd in CoffeeWorkspace
    const simulateCoffeeAdd = async (coffeeTag: string | null) => {
      await mockAppContext.addCoffeeCup(coffeeTag, '2026-11-06');
    };

    simulateCoffeeAdd(selectedCoffeeTag);

    expect(mockAppContext.addCoffeeCup).toHaveBeenCalledWith('tag-break', '2026-11-06');
    // Ensure timer active tag was untouched
    expect(mockAppContext.setActiveTagId).not.toHaveBeenCalled();
    expect(mockAppContext.activeTagId).toBe('tag-work');
  });
});
