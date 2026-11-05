import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Tag, CreateTagInput, UpdateTagInput } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { CoffeeCup } from '../../types/coffee';
import {
  broadcastTags,
  subscribeTags,
  broadcastCoffeeCups,
} from '../../services/timer/TimerBroadcast';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
} from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';

interface UseTagsDataParams {
  isEffectiveAuthenticated: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  setSessions: React.Dispatch<React.SetStateAction<CompletedSession[]>>;
  setCoffeeCups: React.Dispatch<React.SetStateAction<CoffeeCup[]>>;
}

export function useTagsData({
  isEffectiveAuthenticated,
  convexSync,
  setSessions,
  setCoffeeCups,
}: UseTagsDataParams) {
  const { isConvexConfigured, convexUser, mutations: convexMutations } = convexSync;

  const [tags, setTags] = useState<Tag[]>([]);
  const tagsRef = useRef<Tag[]>(tags);
  tagsRef.current = tags;

  const [activeTagId, setActiveTagIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('active_tag_id_v1') || null;
    } catch {
      return null;
    }
  });
  const activeTagIdRef = useRef<string | null>(activeTagId);
  activeTagIdRef.current = activeTagId;

  const setActiveTagId = useCallback((id: string | null) => {
    activeTagIdRef.current = id;
    setActiveTagIdState(id);
    try {
      if (id) {
        localStorage.setItem('active_tag_id_v1', id);
      } else {
        localStorage.removeItem('active_tag_id_v1');
      }
    } catch {
      // Ignore storage error
    }
  }, []);

  // Initial load of tags from local storage
  useEffect(() => {
    async function initTags() {
      const loadedTags = await tagRepository.getAll();
      setTags(loadedTags);

      let storedTagId: string | null = null;
      try {
        storedTagId = localStorage.getItem('active_tag_id_v1');
      } catch {
        storedTagId = null;
      }

      if (storedTagId && loadedTags.some((t) => t.id === storedTagId && !t.isArchived)) {
        setActiveTagId(storedTagId);
      } else {
        const firstActive = loadedTags.find((t) => !t.isArchived);
        if (firstActive) {
          setActiveTagId(firstActive.id);
        }
      }
    }

    initTags();
  }, [setActiveTagId]);

  // Reactive adoption of Convex tags
  useEffect(() => {
    if (!isEffectiveAuthenticated || !convexUser) return;
    if (Array.isArray(convexUser.tags)) {
      const nextTags = convexUser.tags as Tag[];
      setTags((prev) => {
        if (
          prev.length === nextTags.length &&
          prev.every(
            (t, i) =>
              t.id === nextTags[i].id &&
              t.name === nextTags[i].name &&
              t.color === nextTags[i].color &&
              t.isArchived === nextTags[i].isArchived
          )
        ) {
          return prev;
        }
        tagRepository.saveAll(nextTags);
        return nextTags;
      });
    }
  }, [convexUser, isEffectiveAuthenticated]);

  // Multi-tab BroadcastChannel synchronization for tags
  useEffect(() => {
    const unsubTags = subscribeTags((incomingTags) => {
      tagRepository.saveAll(incomingTags);
      setTags(incomingTags);
    });
    return () => {
      unsubTags();
    };
  }, []);

  const createTag = useCallback(
    async (input: CreateTagInput): Promise<Tag> => {
      const created = await tagRepository.create(input);
      const updated = await tagRepository.getAll();
      setTags(updated);
      setActiveTagId(created.id);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .createTag({
            id: created.id,
            name: input.name,
            color: input.color,
          })
          .catch(console.warn);
      }
      return created;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations, setActiveTagId]
  );

  const updateTag = useCallback(
    async (id: string, updates: UpdateTagInput): Promise<Tag | null> => {
      const result = await tagRepository.update(id, updates);
      const updated = await tagRepository.getAll();
      setTags(updated);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .updateTag({
            id,
            name: updates.name,
            color: updates.color,
            isArchived: updates.isArchived,
          })
          .catch(console.warn);
      }
      return result;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const archiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      const result = await tagRepository.archive(id);
      const updated = await tagRepository.getAll();
      setTags(updated);
      if (activeTagId === id) {
        const nextActive = updated.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null);
      }
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations.updateTag({ id, isArchived: true }).catch(console.warn);
      }
      return result;
    },
    [activeTagId, setActiveTagId, isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const unarchiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      const result = await tagRepository.unarchive(id);
      const updated = await tagRepository.getAll();
      setTags(updated);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations.updateTag({ id, isArchived: false }).catch(console.warn);
      }
      return result;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const deleteTag = useCallback(
    async (id: string): Promise<boolean> => {
      const success = await tagRepository.delete(id);

      const currentSessions = await sessionRepository.getAll();
      const updatedSessions = currentSessions.map((s) =>
        s.tagId === id ? { ...s, tagId: null } : s
      );
      await sessionRepository.saveAll(updatedSessions);
      setSessions(updatedSessions);

      const currentCoffee = await coffeeRepository.getAll();
      const updatedCoffee = currentCoffee.map((cup) =>
        cup.tagId === id ? { ...cup, tagId: null } : cup
      );
      await coffeeRepository.saveAll(updatedCoffee);
      setCoffeeCups(updatedCoffee);
      broadcastCoffeeCups(updatedCoffee);

      const updatedTags = await tagRepository.getAll();
      setTags(updatedTags);
      if (activeTagId === id) {
        const nextActive = updatedTags.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null);
      }
      broadcastTags(updatedTags);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations.removeTag({ id }).catch(console.warn);
      }
      return success;
    },
    [
      activeTagId,
      setActiveTagId,
      isConvexConfigured,
      isEffectiveAuthenticated,
      convexMutations,
      setSessions,
      setCoffeeCups,
    ]
  );

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  return {
    tags,
    setTags,
    tagsRef,
    activeTags,
    activeTagId,
    setActiveTagId,
    activeTagIdRef,
    createTag,
    updateTag,
    archiveTag,
    unarchiveTag,
    deleteTag,
  };
}
